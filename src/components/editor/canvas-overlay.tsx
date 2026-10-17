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
 * is painted by the layer underneath), the armed start cell of a click
 * sequence gets a plain filled highlight with no border, and the eraser's
 * sweep is ringed in `--destructive`.
 */

import { memo } from "react";
import { CanvasItemShape } from "@/components/canvas/canvas-preview";
import { VIEWBOX_SIZE } from "@/lib/canvas/model";
import type { Anchor, CanvasItem, ProjectConfig } from "@/lib/canvas/model";
import type { Rect } from "@/lib/canvas/geometry";
import { anchorPath } from "@/lib/canvas/grid";
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

export interface CanvasOverlayProps {
  config: ProjectConfig;
  /** Items of the current selection (already resolved from keys). */
  selectionItems: readonly CanvasItem[];
  /** Items the in-flight gesture would create or move. */
  previewItems: readonly CanvasItem[];
  /** Items the eraser has swept. */
  eraseItems: readonly CanvasItem[];
  marquee: Rect | null;
  /** The armed start anchor of a click sequence, ringed before the preview. */
  marker: Anchor | null;
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
        // The armed start cell: a plain, near-opaque highlight, no border.
        <path d={anchorPath(config, marker)} fill="var(--primary)" fillOpacity={0.9} />
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
    </svg>
  );
});
