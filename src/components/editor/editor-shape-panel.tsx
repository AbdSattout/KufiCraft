"use client";

/**
 * KufiCraft — shape / colour / selection panel.
 *
 * The shape palette feeds the next drawn tiles *and* reshapes the current
 * selection (docs/UI.md §Editor); rotation cycles `r` in quarter turns and
 * the draw colour becomes the items' colour override.
 */

import { Copy, RotateCw, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { shapePath } from "@/lib/canvas/geometry";
import type { TileShape } from "@/lib/canvas/model";
import { MESSAGES } from "./messages";
import { INK_SWATCHES, formatCount, swatchLabel } from "./editor-palette";
import { ColourField, PanelSection } from "./editor-controls";
import { SHAPE_LABELS, SHAPE_ORDER } from "./interaction";
import type { DrawStyle } from "./interaction";

const GLYPH_BOX = { x: 3, y: 3, w: 18, h: 18 };

function ShapeGlyph({ shape }: { shape: TileShape }) {
  const d = useMemo(() => shapePath(shape, GLYPH_BOX, 0), [shape]);
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

export interface ShapePanelProps {
  style: DrawStyle;
  inkColor: string;
  selectionCount: number;
  selectShape: (shape: TileShape) => void;
  rotateShape: () => void;
  setDrawColor: (color: string) => void;
  resetDrawColor: () => void;
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
  setDrawColor,
  resetDrawColor,
  recolourSelection,
  duplicateSelection,
  deleteSelection,
}: ShapePanelProps) {
  const drawColor = style.color ?? inkColor;

  return (
    <>
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
              <ShapeGlyph shape={shape} />
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
          <Button
            variant="ghost"
            size="sm"
            aria-label={MESSAGES.resetShape}
            title={MESSAGES.resetShape}
            onClick={() => selectShape("square")}
          >
            {MESSAGES.gridSquare}
          </Button>
        </div>
      </PanelSection>

      <PanelSection title={MESSAGES.drawColor}>
        <p className="text-xs text-muted-foreground/80">
          {MESSAGES.drawColorHint}
        </p>
        <ColourField
          label={MESSAGES.drawColor}
          value={drawColor}
          colors={INK_SWATCHES}
          onPick={setDrawColor}
          labelFor={(color) => swatchLabel(MESSAGES.drawColor, color)}
          action={
            <Button
              variant="ghost"
              size="xs"
              aria-label={MESSAGES.inkColor}
              onClick={resetDrawColor}
            >
              {MESSAGES.inkColor}
            </Button>
          }
        />
        {selectionCount > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => recolourSelection(drawColor)}
          >
            {MESSAGES.applyToSelection}
            <span className="tabular-nums text-muted-foreground">
              {formatCount(selectionCount)}
            </span>
          </Button>
        ) : null}
      </PanelSection>

      <PanelSection title={MESSAGES.selection}>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {selectionCount > 0
              ? `${MESSAGES.selectedCount} ${formatCount(selectionCount)}`
              : "—"}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={selectionCount === 0}
            onClick={duplicateSelection}
          >
            <Copy />
            {MESSAGES.duplicateSelection}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={selectionCount === 0}
            onClick={deleteSelection}
          >
            <Trash2 />
            {MESSAGES.deleteSelection}
            <kbd className="ms-1 rounded border border-border/70 px-1 text-[0.65rem] text-muted-foreground">
              Del
            </kbd>
          </Button>
        </div>
      </PanelSection>
    </>
  );
}
