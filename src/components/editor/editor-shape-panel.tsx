"use client";

/**
 * KufiCraft — shape palette (and the selection it acts on).
 *
 * One section, two jobs: the palette feeds the next drawn tiles *and* reshapes
 * the current selection (docs/UI.md §Editor) — rotation cycles `r` in quarter
 * turns (`R` on the keyboard too), and picking a shape is the way back to the
 * plain square, so the panel carries no separate reset button.
 *
 * The selection actions are revealed by the selection itself: with nothing
 * selected there is no “التحديد” block and no disabled buttons.
 */

import { Copy, PaintBucket, RotateCw, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { tileIconPath } from "@/lib/canvas/items";
import type { Rotation, ShapeId } from "@/lib/canvas/model";
import { MESSAGES } from "./messages";
import { formatCount } from "./editor-palette";
import { PanelSection } from "./editor-controls";
import { SHAPE_LABELS, SHAPE_ORDER } from "./interaction";
import type { DrawStyle } from "./interaction";

/**
 * The palette glyph is the pen's own path — `tileIconPath` runs the very same
 * `Tile.render` the canvas uses — so the icons follow the current rotation and
 * can never show a shape the pen would not paint.
 */
function ShapeGlyph({
  shape,
  rotation,
}: {
  shape: ShapeId;
  rotation: Rotation;
}) {
  const d = useMemo(() => tileIconPath(shape, rotation, 24), [shape, rotation]);
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

export interface ShapePanelProps {
  style: DrawStyle;
  /** The ink colour, used by “تلوين التحديد”. */
  inkColor: string;
  selectionCount: number;
  selectShape: (shape: ShapeId) => void;
  rotateShape: () => void;
  recolourSelection: (color: string) => void;
  duplicateSelection: () => void;
  deleteSelection: () => void;
}

export function ShapePanel({
  style,
  inkColor,
  selectionCount,
  selectShape,
  rotateShape,
  recolourSelection,
  duplicateSelection,
  deleteSelection,
}: ShapePanelProps) {
  return (
    <PanelSection title={MESSAGES.shapes}>
      <div className="grid grid-cols-5 gap-1">
        {SHAPE_ORDER.map((shape, index) => (
          <Button
            key={shape}
            variant={style.shape === shape ? "secondary" : "outline"}
            size="icon"
            aria-pressed={style.shape === shape}
            aria-label={`${SHAPE_LABELS[shape]} (${index + 1})`}
            title={`${SHAPE_LABELS[shape]} (${index + 1})`}
            onClick={() => selectShape(shape)}
          >
            <ShapeGlyph shape={shape} rotation={style.rotation} />
          </Button>
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        aria-label={`${MESSAGES.rotate} ${style.rotation * 90}°`}
        onClick={rotateShape}
      >
        <RotateCw />
        {MESSAGES.rotate}
        <span className="tabular-nums text-muted-foreground">
          {style.rotation * 90}°
        </span>
      </Button>

      {selectionCount > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-2">
          <p className="text-xs text-muted-foreground">
            {`${MESSAGES.selection} · ${MESSAGES.selectedCount} ${formatCount(selectionCount)}`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => recolourSelection(inkColor)}
            >
              <PaintBucket />
              {MESSAGES.recolourSelection}
            </Button>
            <Button variant="outline" size="sm" onClick={duplicateSelection}>
              <Copy />
              {MESSAGES.duplicateSelection}
            </Button>
            <Button variant="outline" size="sm" onClick={deleteSelection}>
              <Trash2 />
              {MESSAGES.deleteSelection}
              <kbd className="ms-1 rounded border border-border/70 px-1 text-[0.65rem] text-muted-foreground">
                Del
              </kbd>
            </Button>
          </div>
        </div>
      ) : null}
    </PanelSection>
  );
}
