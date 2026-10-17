"use client";

/**
 * KufiCraft — shape palette (and the selection it acts on).
 *
 * One section, two jobs: the palette feeds the next drawn tiles *and* reshapes
 * the current selection (docs/UI.md §Editor) — rotation cycles `r` in quarter
 * turns, and “إعادة الشكل” only appears once the style differs from the plain
 * square so the panel never carries a button nobody can explain.
 *
 * The selection actions are revealed by the selection itself: with nothing
 * selected there is no “التحديد” block and no disabled buttons.
 */

import { Copy, PaintBucket, RotateCcw, RotateCw, Trash2 } from "lucide-react";
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
  resetShape: () => void;
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
  resetShape,
  recolourSelection,
  duplicateSelection,
  deleteSelection,
}: ShapePanelProps) {
  const customised = style.shape !== "square" || style.rotation !== 0;

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

      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          aria-label={`${MESSAGES.rotate} ${style.rotation * 90}°`}
          onClick={rotateShape}
        >
          <RotateCw />
          {MESSAGES.rotate}
          <span className="tabular-nums text-muted-foreground">
            {style.rotation * 90}°
          </span>
        </Button>
        {customised ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={MESSAGES.resetShape}
            title={MESSAGES.resetShapeHint}
            onClick={resetShape}
          >
            <RotateCcw />
            {MESSAGES.resetShape}
          </Button>
        ) : null}
      </div>

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
