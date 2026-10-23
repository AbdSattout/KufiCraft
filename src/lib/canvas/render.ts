/**
 * KufiCraft — SVG string rendering (the only module allowed to emit markup).
 *
 * `renderSvg` produces a standalone document used by the editor, by exports
 * and by the landing page; `renderThumbnail` produces the compact version the
 * dashboard stores (no grid, fixed light background, reduced precision, and
 * guaranteed to stay within `MAX_THUMBNAIL_LENGTH`).
 *
 * Every path comes from the item classes (`items.ts` → `KufiItem.draw`), so
 * the string renderer and the React canvas can never drift apart.
 */

import { MAX_THUMBNAIL_LENGTH, VIEWBOX_SIZE, digest } from "./model";
import type { CanvasItem, ProjectConfig } from "./model";
import { itemOf } from "./items";
import { gridPaths } from "./grid";

const TRANSPARENT = "transparent";

/** Construction grid: neutral grey, subtle on light and dark backgrounds. */
const GRID_STROKE = "#8a8a8a";
const GRID_OPACITY = "0.28";
/** The inner (ink) lines are the ones that show «قلم / فراغ», so they read stronger. */
const INK_OPACITY = "0.55";
const GRID_WIDTH = 1;

/** Thumbnails use a fixed paper background so cards look uniform. */
const THUMBNAIL_BACKGROUND = "#ffffff";
const THUMBNAIL_PRECISION = 1;

export interface RenderOptions {
  /** Overrides `config.showGrid` (the grid is editor-only). */
  showGrid?: boolean;
  /** Overrides `config.background` (`"transparent"` → no background rect). */
  background?: string;
  /** Rendered width / height in px; defaults to the viewBox size. */
  size?: number;
  /** Decimal digits kept in path data; defaults to full precision. */
  precision?: number;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Compact number formatting for markup, not for path data. */
function num(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** Drops path-data precision (thumbnail size control). */
function roundPathNumbers(d: string, digits: number): string {
  return d.replace(/-?\d+(?:\.\d+)?/g, (match) => {
    const fixed = Number(match).toFixed(digits);
    return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
  });
}

interface SvgParts {
  showGrid: boolean;
  background: string;
  size: number;
  precision: number | undefined;
  includeKeys: boolean;
}

function renderSvgString(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  parts: SvgParts,
): string {
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}"` +
      ` width="${parts.size}" height="${parts.size}">`,
  ];
  if (parts.background !== TRANSPARENT) {
    out.push(
      `<rect width="${VIEWBOX_SIZE}" height="${VIEWBOX_SIZE}" fill="${escapeXml(parts.background)}"/>`,
    );
  }
  if (parts.showGrid) {
    const grid = gridPaths(config);
    out.push(
      `<path d="${grid.cellBorders}" fill="none" stroke="${GRID_STROKE}"` +
        ` stroke-opacity="${GRID_OPACITY}" stroke-width="${GRID_WIDTH}"/>`,
    );
    out.push(
      `<path d="${grid.inkLines}" fill="none" stroke="${GRID_STROKE}"` +
        ` stroke-opacity="${INK_OPACITY}" stroke-width="${GRID_WIDTH}"/>`,
    );
  }
  for (const [index, item] of items.entries()) {
    const rendered = itemOf(item).draw(config);
    const d =
      parts.precision === undefined
        ? rendered.path
        : roundPathNumbers(rendered.path, parts.precision);
    const color = escapeXml(itemOf(item).resolvedColor(config));
    const key = parts.includeKeys ? ` data-k="${escapeXml(item.key)}"` : "";
    // A partial tile border is clipped to the outside bands of its selected
    // sides. The id carries the index and a content digest, so it is
    // deterministic and, when several rendered SVGs are inlined in one page
    // (dashboard thumbnails), two documents share an id only when their clip
    // geometry is identical — the case where either reference clips the same.
    const clip = rendered.border?.clip;
    const clipRects =
      clip === undefined
        ? ""
        : clip
            .map(
              (rect) =>
                `<rect x="${num(rect.x)}" y="${num(rect.y)}"` +
                ` width="${num(rect.w)}" height="${num(rect.h)}"/>`,
            )
            .join("");
    const clipId = `kc-border-${index}-${digest(clipRects)}`;
    if (clip !== undefined) {
      out.push(
        `<defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${clipRects}</clipPath></defs>`,
      );
    }
    // The border is the item's own path stroked once, before the ink: a wider
    // copy of a stroked item, or a native outline under a filled one. The fill
    // (or the ink stroke) covers the inner half, leaving exactly the border
    // band outside. It inherits the item's cap and join, so a round end wraps
    // the border around the ink.
    if (rendered.border !== undefined) {
      out.push(
        `<path${key} d="${d}" fill="none" stroke="${escapeXml(rendered.border.color)}"` +
          ` stroke-width="${num(rendered.border.width)}"` +
          ` stroke-linecap="${rendered.cap}" stroke-linejoin="${rendered.join}"` +
          (clip !== undefined ? ` clip-path="url(#${clipId})"` : "") +
          `/>`,
      );
    }
    if (rendered.mode === "stroke") {
      out.push(
        `<path${key} d="${d}" fill="none" stroke="${color}"` +
          ` stroke-width="${num(rendered.width)}"` +
          ` stroke-linecap="${rendered.cap}" stroke-linejoin="${rendered.join}"/>`,
      );
    } else {
      out.push(`<path${key} d="${d}" fill="${color}"/>`);
    }
  }
  out.push("</svg>");
  return out.join("");
}

/**
 * Standalone SVG document for `config` + `items`. `data-k` attributes carry
 * the item key so the editor can map a clicked element back to its item.
 */
export function renderSvg(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  opts: RenderOptions = {},
): string {
  return renderSvgString(config, items, {
    showGrid: opts.showGrid ?? config.showGrid,
    background: opts.background ?? config.background,
    size: opts.size ?? VIEWBOX_SIZE,
    precision: opts.precision,
    includeKeys: true,
  });
}

function sample(items: readonly CanvasItem[], stride: number): readonly CanvasItem[] {
  if (stride <= 1) return items;
  const sampled: CanvasItem[] = [];
  for (let index = 0; index < items.length; index += stride) {
    sampled.push(items[index]);
  }
  return sampled;
}

/**
 * Compact SVG for `projects.thumbnail`: no grid, fixed light background,
 * reduced precision. Dense artworks are decimated uniformly until the string
 * fits `MAX_THUMBNAIL_LENGTH`, so a thumbnail is always storable.
 */
export function renderThumbnail(
  config: ProjectConfig,
  items: readonly CanvasItem[],
): string {
  const thumbnailConfig: ProjectConfig = {
    ...config,
    showGrid: false,
    background: THUMBNAIL_BACKGROUND,
  };
  let stride = 1;
  let svg = renderThumbnailAt(thumbnailConfig, items, stride);
  while (svg.length > MAX_THUMBNAIL_LENGTH && stride < items.length) {
    stride *= 2;
    svg = renderThumbnailAt(thumbnailConfig, items, stride);
  }
  return svg;
}

function renderThumbnailAt(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  stride: number,
): string {
  return renderSvgString(config, sample(items, stride), {
    showGrid: false,
    background: THUMBNAIL_BACKGROUND,
    size: VIEWBOX_SIZE,
    precision: THUMBNAIL_PRECISION,
    includeKeys: false,
  });
}
