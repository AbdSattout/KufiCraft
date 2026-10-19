"use client";

/**
 * KufiCraft — gesture overlay.
 *
 * A second SVG sharing the artwork's `viewBox`, stacked exactly on top of
 * the read-only preview: selection rings, the ghost of a move, the items a
 * marquee touches, the eraser's hit list and the marquee box itself. It is
 * `pointer-events-none` and independent of the item layer, so pointer-move
 * only ever re-renders this small node.
 *
 * Selected items are ringed in the theme's `--ring` colour (the artwork itself
 * is painted by the layer underneath), the armed start point of a click
 * sequence and the point the next click would store are both drawn as the same
 * small snap dot, and the eraser's sweep is ringed in `--destructive`.
 */

import { memo } from "react";
import { CanvasItemShape } from "@/components/canvas/canvas-preview";
import { VIEWBOX_SIZE } from "@/lib/canvas/model";
import type { CanvasItem, LinePoint, ProjectConfig } from "@/lib/canvas/model";
import { inkUnit } from "@/lib/canvas/geometry";
import type { Rect } from "@/lib/canvas/geometry";
import { linePointPosition } from "@/lib/canvas/grid";
import { itemOf } from "@/lib/canvas/items";

interface RingProps {
  config: ProjectConfig;
  item: CanvasItem;
  stroke: string;
  width: number;
  dashed?: boolean;
}

const Outline = memo(function Outline({
  config,
  item,
  stroke,
  width,
  dashed,
}: RingProps) {
  const { path } = itemOf(item).render(config);
  return (
    <path
      d={path}
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeDasharray={dashed ? "4 3" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );
});

/**
 * The snap dot: the exact anchored point the armed start or the pending click
 * occupies. `r` is an eighth of the ink extent — small enough to leave the ink
 * it sits on readable — and `non-scaling-stroke` keeps the ring 1.5 screen px
 * at every zoom, so the dot stays crisp and never swells into the cell.
 */
const SnapDot = memo(function SnapDot({
  config,
  point,
}: {
  config: ProjectConfig;
  point: LinePoint;
}) {
  const { x, y } = linePointPosition(config, point);
  return (
    <circle
      cx={x}
      cy={y}
      r={inkUnit(config) / 8}
      fill="var(--background)"
      stroke="var(--primary)"
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
    />
  );
});

export interface CanvasOverlayProps {
  config: ProjectConfig;
  /** Items of the current selection (already resolved from keys). */
  selectionItems: readonly CanvasItem[];
  /** Items the in-flight gesture would create or move. */
  previewItems: readonly CanvasItem[];
  /** Items the eraser has swept. */
  eraseItems: readonly CanvasItem[];
  marquee: Rect | null;
  /** The armed start point of a click sequence, drawn as a snap dot. */
  marker: LinePoint | null;
  /**
   * The point the next click would store, drawn as the same snap dot on top of
   * the marker and the ghost so it is always visible.
   */
  dot: LinePoint | null;
  /** How the preview is painted: `solid` (the pen) or `ghost`. */
  previewMode: "solid" | "ghost";
}

export const CanvasOverlay = memo(function CanvasOverlay({
  config,
  selectionItems,
  previewItems,
  eraseItems,
  marquee,
  marker,
  dot,
  previewMode,
}: CanvasOverlayProps) {
  const ghost = previewMode === "ghost";

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {marquee ? (
        <rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.w}
          height={marquee.h}
          fill="var(--primary)"
          fillOpacity={0.08}
          stroke="var(--primary)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}

      {marker ? (
        // The armed start point: the same dot the hover shows, on its own
        // exact point (never a whole-cell square).
        <SnapDot config={config} point={marker} />
      ) : null}

      {ghost
        ? previewItems.map((item) => (
            <CanvasItemShape
              key={`ghost-${item.key}`}
              config={config}
              item={item}
              opacity={0.5}
            />
          ))
        : null}

      {selectionItems.map((item) => (
        <Outline
          key={`sel-${item.key}`}
          config={config}
          item={item}
          stroke="var(--ring)"
          width={2}
        />
      ))}

      {!ghost
        ? previewItems.map((item) => (
            <CanvasItemShape
              key={`live-${item.key}`}
              config={config}
              item={item}
              opacity={0.9}
            />
          ))
        : null}

      {eraseItems.map((item) => (
        <Outline
          key={`erase-${item.key}`}
          config={config}
          item={item}
          stroke="var(--destructive)"
          width={2.5}
        />
      ))}

      {dot ? (
        // The point under the cursor: exactly what the next click stores,
        // painted last so the marker and the ghost stay behind it.
        <SnapDot config={config} point={dot} />
      ) : null}
    </svg>
  );
});
