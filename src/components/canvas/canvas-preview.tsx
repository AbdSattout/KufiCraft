"use client";

/**
 * KufiCraft — read-only canvas renderer (shared).
 *
 * `<CanvasPreview config items />` draws the document into a
 * `viewBox="0 0 1000 1000"` SVG: background, construction grid (only when
 * `config.showGrid`) and one element per item, each path coming from the
 * engine's `itemPath` — this component never hand-renders geometry
 * (docs/UI.md §Shared pieces).
 *
 * Performance: the component and every single path are memoised, and items
 * that a gesture did not touch keep their object identity across commits
 * (see `src/lib/canvas/ops.ts`), so dragging on a 2000-item board
 * re-renders only the overlay layer.
 */

import { memo, useMemo } from "react";
import {
  CIRCULAR_ANGULAR_UNIT,
  CIRCULAR_SECTORS,
  VIEWBOX_SIZE,
} from "@/lib/canvas/model";
import type { CanvasItem, ProjectConfig } from "@/lib/canvas/model";
import { itemPath } from "@/lib/canvas/geometry";
import { cn } from "@/lib/utils";

const CENTER = VIEWBOX_SIZE / 2;

/** Cell / ring construction lines — mirrors `render.ts` (editor only). */
function squareGridPath(base: number): string {
  let d = "";
  const lines = Math.floor(VIEWBOX_SIZE / base);
  for (let n = 0; n <= lines; n++) {
    const at = n * base;
    d += `${d === "" ? "" : " "}M ${at} 0 V ${VIEWBOX_SIZE} M 0 ${at} H ${VIEWBOX_SIZE}`;
  }
  return d;
}

function circularGridPath(base: number): string {
  let d = "";
  const rings = Math.floor(CENTER / base);
  for (let n = 1; n <= rings; n++) {
    const radius = n * base;
    d +=
      `${d === "" ? "" : " "}M ${CENTER + radius} ${CENTER}` +
      ` A ${radius} ${radius} 0 1 1 ${CENTER - radius} ${CENTER}` +
      ` A ${radius} ${radius} 0 1 1 ${CENTER + radius} ${CENTER}`;
  }
  for (let sector = 0; sector < CIRCULAR_SECTORS; sector++) {
    const angle = sector * CIRCULAR_ANGULAR_UNIT;
    d += ` M ${CENTER} ${CENTER} L ${CENTER + CENTER * Math.cos(angle)} ${
      CENTER + CENTER * Math.sin(angle)
    }`;
  }
  return d;
}

/** Construction grid of a config, as one path (no stroke attributes). */
export function canvasGridPath(config: ProjectConfig): string {
  return config.gridType === "circular"
    ? circularGridPath(config.base)
    : squareGridPath(config.base);
}

interface CanvasItemShapeProps {
  config: ProjectConfig;
  item: CanvasItem;
  /** Extra classes, used by the editor's overlay (outlines, ghosts). */
  className?: string;
  opacity?: number;
}

/**
 * One item as one SVG element. Arches are stroked (fill none), everything
 * else filled — the rendering contract in docs/CANVAS.md §5.
 */
export const CanvasItemShape = memo(function CanvasItemShape({
  config,
  item,
  className,
  opacity,
}: CanvasItemShapeProps) {
  const d = useMemo(() => itemPath(config, item), [config, item]);
  if (item.t === "arch") {
    return (
      <path
        data-k={item.k}
        d={d}
        fill="none"
        stroke={item.c ?? config.ink}
        strokeWidth={config.ratio * config.base}
        className={className}
        opacity={opacity}
      />
    );
  }
  return (
    <path
      data-k={item.k}
      d={d}
      fill={item.c ?? config.ink}
      className={className}
      opacity={opacity}
    />
  );
});

/** The item list of a document (without the SVG frame). */
export const CanvasItems = memo(function CanvasItems({
  config,
  items,
}: {
  config: ProjectConfig;
  items: readonly CanvasItem[];
}) {
  return (
    <>
      {items.map((item) => (
        <CanvasItemShape key={item.k} config={config} item={item} />
      ))}
    </>
  );
});

export interface CanvasPreviewProps {
  config: ProjectConfig;
  items: readonly CanvasItem[];
  /** Extra classes for the `<svg>` element. */
  className?: string;
  /** Accessible description; omit for decorative previews. */
  label?: string;
}

/**
 * Read-only artwork. `preserveAspectRatio` keeps the square canvas uniform
 * at any container size — the editor's pointer mapping relies on it.
 */
export const CanvasPreview = memo(function CanvasPreview({
  config,
  items,
  className,
  label,
}: CanvasPreviewProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
      preserveAspectRatio="xMidYMid meet"
      role={label ? "img" : "presentation"}
      aria-label={label}
      className={cn("block w-full", className)}
    >
      {config.background !== "transparent" ? (
        <rect
          width={VIEWBOX_SIZE}
          height={VIEWBOX_SIZE}
          fill={config.background}
        />
      ) : null}
      {config.showGrid ? (
        <path
          d={canvasGridPath(config)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          className="text-muted-foreground/40"
        />
      ) : null}
      <CanvasItems config={config} items={items} />
    </svg>
  );
});
