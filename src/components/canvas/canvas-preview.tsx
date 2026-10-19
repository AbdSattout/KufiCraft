"use client";

/**
 * KufiCraft — read-only canvas renderer (shared).
 *
 * `<CanvasPreview config items />` draws the document into a
 * `viewBox="0 0 1000 1000"` SVG: background, construction grid (only when
 * `config.showGrid`) and one element per item. Every path comes from the item
 * class (`itemOf(item).render(config)`), exactly like the string renderer in
 * `@/lib/canvas/render`, so the React canvas and exports can never drift.
 *
 * The grid has two families (`gridPaths` in `@/lib/canvas/grid`): the cell
 * borders, and the inner ink lines that separate the ink square from the
 * space around it. Both are drawn here so the editor shows what the engine
 * means by «قلم / فراغ».
 *
 * Performance: the component and every single path are memoised, and items
 * that a gesture did not touch keep their object identity across commits
 * (see `src/lib/canvas/ops.ts`), so dragging on a 2000-item board
 * re-renders only the overlay layer.
 */

import { memo, useMemo } from "react";
import { VIEWBOX_SIZE } from "@/lib/canvas/model";
import type { CanvasItem, ProjectConfig } from "@/lib/canvas/model";
import { gridPaths } from "@/lib/canvas/grid";
import { itemOf } from "@/lib/canvas/items";
import { cn } from "@/lib/utils";

interface CanvasItemShapeProps {
  config: ProjectConfig;
  item: CanvasItem;
  /** Extra classes, used by the editor's overlay (outlines, ghosts). */
  className?: string;
  opacity?: number;
}

/**
 * One item as SVG: the class decides the paths and whether the item is stroked
 * (lines, polylines, arcs) or filled (tiles). An item with a border gets one
 * translated duplicate per enabled side, drawn first, so the ink always wins.
 */
export const CanvasItemShape = memo(function CanvasItemShape({
  config,
  item,
  className,
  opacity,
}: CanvasItemShapeProps) {
  const { path, mode, width, borders } = useMemo(
    () => itemOf(item).draw(config),
    [config, item],
  );
  const color = useMemo(() => itemOf(item).resolvedColor(config), [config, item]);
  return (
    <>
      {borders?.map((copy, index) =>
        mode === "stroke" ? (
          <path
            key={`${item.key}:border:${index}`}
            data-key={`${item.key}:border:${index}`}
            d={path}
            transform={`translate(${copy.dx} ${copy.dy})`}
            fill="none"
            stroke={copy.color}
            strokeWidth={width}
            strokeLinecap="butt"
            strokeLinejoin="miter"
            className={className}
            opacity={opacity}
          />
        ) : (
          <path
            key={`${item.key}:border:${index}`}
            data-key={`${item.key}:border:${index}`}
            d={path}
            transform={`translate(${copy.dx} ${copy.dy})`}
            fill={copy.color}
            className={className}
            opacity={opacity}
          />
        ),
      )}
      {mode === "stroke" ? (
        <path
          data-key={item.key}
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="butt"
          strokeLinejoin="miter"
          className={className}
          opacity={opacity}
        />
      ) : (
        <path
          data-key={item.key}
          d={path}
          fill={color}
          className={className}
          opacity={opacity}
        />
      )}
    </>
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
        <CanvasItemShape key={item.key} config={config} item={item} />
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
  const grid = useMemo(
    () => (config.showGrid ? gridPaths(config) : null),
    [config],
  );

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
      {grid ? (
        <>
          <path
            d={grid.cellBorders}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeOpacity={0.28}
            vectorEffect="non-scaling-stroke"
            className="text-muted-foreground"
          />
          <path
            d={grid.inkLines}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeOpacity={0.55}
            vectorEffect="non-scaling-stroke"
            className="text-muted-foreground"
          />
        </>
      ) : null}
      <CanvasItems config={config} items={items} />
    </svg>
  );
});
