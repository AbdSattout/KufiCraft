"use client";

/**
 * KufiCraft — gesture overlay.
 *
 * A second SVG sharing the artwork's `viewBox`, stacked exactly on top of
 * the read-only preview: selection rings, the ghost of a move, the items a
 * marquee touches, the eraser's hit list and the marquee box itself. It is
 * `pointer-events-none` and independent of the item layer, so pointer-move
 * only ever re-renders this small node.
 */

import { memo } from "react";
import { CanvasItemShape } from "@/components/canvas/canvas-preview";
import { VIEWBOX_SIZE } from "@/lib/canvas/model";
import type { CanvasItem, ProjectConfig } from "@/lib/canvas/model";
import { itemPath } from "@/lib/canvas/geometry";
import type { Rect } from "@/lib/canvas/geometry";

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
  return (
    <path
      d={itemPath(config, item)}
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
  /** `true` while dragging a selection (preview is a ghost). */
  ghost: boolean;
}

export const CanvasOverlay = memo(function CanvasOverlay({
  config,
  selectionItems,
  previewItems,
  eraseItems,
  marquee,
  ghost,
}: CanvasOverlayProps) {
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

      {ghost
        ? previewItems.map((item) => (
            <CanvasItemShape
              key={`ghost-${item.k}`}
              config={config}
              item={item}
              opacity={0.5}
            />
          ))
        : null}

      {selectionItems.map((item) => (
        <Outline
          key={`sel-${item.k}`}
          config={config}
          item={item}
          stroke="var(--ring)"
          width={2}
        />
      ))}

      {!ghost
        ? previewItems.map((item) => (
            <Outline
              key={`hit-${item.k}`}
              config={config}
              item={item}
              stroke="var(--ring)"
              width={2}
              dashed
            />
          ))
        : null}

      {eraseItems.map((item) => (
        <Outline
          key={`erase-${item.k}`}
          config={config}
          item={item}
          stroke="var(--destructive)"
          width={2.5}
        />
      ))}
    </svg>
  );
});
