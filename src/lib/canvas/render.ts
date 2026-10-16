/**
 * KufiCraft — SVG string rendering (the only module allowed to emit markup).
 *
 * `renderSvg` produces a standalone document used by the editor, by exports
 * and by the landing page; `renderThumbnail` produces the compact version the
 * dashboard stores (no grid, fixed light background, reduced precision, and
 * guaranteed to stay within `MAX_THUMBNAIL_LENGTH`).
 */

import {
  CIRCULAR_ANGULAR_UNIT,
  CIRCULAR_SECTORS,
  MAX_THUMBNAIL_LENGTH,
  VIEWBOX_SIZE,
} from "./model";
import type { CanvasItem, ProjectConfig } from "./model";
import { itemPath } from "./geometry";

const TRANSPARENT = "transparent";
const CENTER = VIEWBOX_SIZE / 2;

/** Construction grid: neutral grey, subtle on light and dark backgrounds. */
const GRID_STROKE = "#8a8a8a";
const GRID_OPACITY = "0.28";
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

function squareGridPath(base: number): string {
  let d = "";
  const lines = Math.floor(VIEWBOX_SIZE / base);
  for (let n = 0; n <= lines; n++) {
    const at = num(n * base);
    const size = num(VIEWBOX_SIZE);
    d += (d === "" ? "" : " ") + `M ${at} 0 V ${size} M 0 ${at} H ${size}`;
  }
  return d;
}

function circularGridPath(base: number): string {
  let d = "";
  const rings = Math.floor(CENTER / base);
  for (let n = 1; n <= rings; n++) {
    const r = num(n * base);
    d +=
      (d === "" ? "" : " ") +
      `M ${num(CENTER + n * base)} ${CENTER} ` +
      `A ${r} ${r} 0 1 1 ${num(CENTER - n * base)} ${CENTER} ` +
      `A ${r} ${r} 0 1 1 ${num(CENTER + n * base)} ${CENTER}`;
  }
  for (let sector = 0; sector < CIRCULAR_SECTORS; sector++) {
    const angle = sector * CIRCULAR_ANGULAR_UNIT;
    const x = num(CENTER + CENTER * Math.cos(angle));
    const y = num(CENTER + CENTER * Math.sin(angle));
    d += ` M ${CENTER} ${CENTER} L ${x} ${y}`;
  }
  return d;
}

function gridPath(config: ProjectConfig): string {
  return config.gridType === "circular"
    ? circularGridPath(config.base)
    : squareGridPath(config.base);
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
  const strokeWidth = num(config.ratio * config.base);
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
    out.push(
      `<path d="${gridPath(config)}" fill="none" stroke="${GRID_STROKE}"` +
        ` stroke-opacity="${GRID_OPACITY}" stroke-width="${GRID_WIDTH}"/>`,
    );
  }
  for (const item of items) {
    const raw = itemPath(config, item);
    const d =
      parts.precision === undefined
        ? raw
        : roundPathNumbers(raw, parts.precision);
    const color = escapeXml(item.c ?? config.ink);
    const key = parts.includeKeys ? ` data-k="${escapeXml(item.k)}"` : "";
    if (item.t === "arch") {
      out.push(
        `<path${key} d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>`,
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
