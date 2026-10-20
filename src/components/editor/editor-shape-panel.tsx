"use client";

/**
 * KufiCraft — shape palette (and the selection it acts on).
 *
 * One panel, four jobs: the palette feeds the next drawn tiles *and* reshapes
 * the current selection (docs/UI.md §Editor) — rotation cycles `r` in quarter
 * turns (`R` on the keyboard too), the rounding block sets the corners of
 * tiles, line bars and polyline turns, and the border block wraps the whole
 * shape (there is no per-side selection); picking a shape is
 * the way back to the plain square, so the panel carries no separate reset
 * button.
 *
 * Rounding and the border work like the shape buttons: they set the **draw
 * style** (what the pen paints next) and, when a selection is live, re-style it
 * in the same click. The displayed values follow the selection — the first
 * selected item's own rounding and border while one is active, the draw style
 * otherwise (initially: no rounding, no border). The rounding slider is a
 * per-item fraction of the shorter side, so the panel shows it as a percentage
 * of the model's `0…0.5`.
 *
 * The selection actions are revealed by the selection itself: with nothing
 * selected there is no “التحديد” block and no disabled buttons.
 */

import {
  BringToFront,
  ChevronDown,
  ChevronUp,
  Copy,
  Layers,
  PaintBucket,
  RotateCcw,
  RotateCw,
  SendToBack,
  Trash2,
} from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { tileIconPath } from "@/lib/canvas/items";
import {
  BORDER_ALL,
  CORNER_BOTTOM_LEFT,
  CORNER_BOTTOM_RIGHT,
  CORNER_TOP_LEFT,
  CORNER_TOP_RIGHT,
  MAX_BORDER_WIDTH,
  MAX_ROUNDING_RADIUS,
  MIN_BORDER_WIDTH,
} from "@/lib/canvas/model";
import type { ItemBorder, ItemRounding, Rotation, ShapeId } from "@/lib/canvas/model";
import type { ArrangeAction } from "@/lib/canvas/ops";
import { MESSAGES } from "./messages";
import { INK_SWATCHES, formatCount, mergedSwatches, swatchLabel } from "./editor-palette";
import { ColourField, PanelSection, SliderField } from "./editor-controls";
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

/* ------------------------------------------------------------------ */
/* Rounding + border glyphs                                            */
/* ------------------------------------------------------------------ */

/**
 * A square whose `corner` is drawn round. The four glyphs are the item's box as
 * it is seen on screen, so a toggle names the corner it touches and nothing
 * about it depends on the writing direction.
 */
const CORNER_GLYPHS: Record<number, string> = {
  [CORNER_TOP_LEFT]: "M10 2 L22 2 L22 22 L2 22 L2 10 A8 8 0 0 1 10 2 Z",
  [CORNER_TOP_RIGHT]: "M2 2 L14 2 A8 8 0 0 1 22 10 L22 22 L2 22 Z",
  [CORNER_BOTTOM_RIGHT]: "M2 2 L22 2 L22 14 A8 8 0 0 1 14 22 L2 22 Z",
  [CORNER_BOTTOM_LEFT]: "M2 2 L22 2 L22 22 L10 22 A8 8 0 0 1 2 14 Z",
};

function CornerGlyph({ corner }: { corner: number }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <path
        d={CORNER_GLYPHS[corner]}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The box the border wraps, with the whole outline drawn thick. */
function BorderGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <path
        d="M4 4 H20 V20 H4 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinejoin="miter"
      />
    </svg>
  );
}

/** One button of the physical 2×2 corner map. */
function GlyphToggle({
  pressed,
  label,
  position,
  onClick,
  children,
}: {
  pressed: boolean;
  label: string;
  /** Explicit grid placement: the map is physical, never mirrored. */
  position: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={pressed ? "secondary" : "outline"}
      size="icon"
      className={position}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export interface ShapePanelProps {
  style: DrawStyle;
  /** The ink colour, used by “تلوين التحديد” and as the border colour's default. */
  inkColor: string;
  /** Recent ink colours, offered by the border colour field. */
  inkSwatches: readonly string[];
  selectionCount: number;
  selectShape: (shape: ShapeId) => void;
  rotateShape: () => void;
  /** Corner rounding of the next items (and of the selection, when there is one). */
  setRounding: (rounding: ItemRounding) => void;
  /** Live radius while the slider is dragged (style only, no write). */
  previewRounding: (radius: number) => void;
  /** Border of the next items (and of the selection). */
  setBorder: (border: ItemBorder) => void;
  /** Live width while the slider is dragged (style only, no write). */
  previewBorderWidth: (width: number) => void;
  recolourSelection: (color: string) => void;
  duplicateSelection: () => void;
  deleteSelection: () => void;
  /** Moves the selection in the render order. */
  arrange: (action: ArrangeAction) => void;
  /** Per-action no-op detection (disabled menu items). */
  canArrange: (action: ArrangeAction) => boolean;
}

/** The arrange commands in Illustrator/Figma order, with their key hints. */
const ARRANGE_ITEMS = [
  {
    action: "front",
    label: MESSAGES.bringToFront,
    hint: "Ctrl+Shift+]",
    Icon: BringToFront,
  },
  {
    action: "forward",
    label: MESSAGES.bringForward,
    hint: "Ctrl+]",
    Icon: ChevronUp,
  },
  {
    action: "backward",
    label: MESSAGES.sendBackward,
    hint: "Ctrl+[",
    Icon: ChevronDown,
  },
  {
    action: "back",
    label: MESSAGES.sendToBack,
    hint: "Ctrl+Shift+[",
    Icon: SendToBack,
  },
] as const;

export function ShapePanel({
  style,
  inkColor,
  inkSwatches,
  selectionCount,
  selectShape,
  rotateShape,
  setRounding,
  previewRounding,
  setBorder,
  previewBorderWidth,
  recolourSelection,
  duplicateSelection,
  deleteSelection,
  arrange,
  canArrange,
}: ShapePanelProps) {
  const { radius, corners } = style.rounding;
  const { sides, width, color } = style.border;
  const swatches = useMemo(
    () => mergedSwatches(inkSwatches, INK_SWATCHES),
    [inkSwatches],
  );

  /** Percent of the shorter side — the slider's unit, and what it prints. */
  const percent = Math.round(radius * 100);

  const toggleCorner = (corner: number) => {
    setRounding({ ...style.rounding, corners: corners ^ corner });
  };

  const toggleBorder = () => {
    setBorder({ ...style.border, sides: sides === 0 ? BORDER_ALL : 0 });
  };

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

      <div className="flex flex-col gap-2 border-t border-border/60 pt-2">
        <p className="text-xs text-muted-foreground">{MESSAGES.rounding}</p>
        <SliderField
          label={MESSAGES.roundingRadius}
          value={percent}
          min={0}
          max={Math.round(MAX_ROUNDING_RADIUS * 100)}
          step={5}
          suffix="٪"
          onPreview={(value) => previewRounding(value / 100)}
          onCommit={(value) => setRounding({ ...style.rounding, radius: value / 100 })}
        />
        {/* `dir="ltr"` keeps the 2×2 map physical: in RTL, grid line 1 is the
            right edge, which would silently mirror the four corners. */}
        <div className="grid w-fit grid-cols-2 gap-1" dir="ltr" role="group" aria-label={MESSAGES.roundingCorners}>
          <GlyphToggle
            pressed={(corners & CORNER_TOP_LEFT) !== 0}
            label={MESSAGES.cornerTopLeft}
            position="col-start-1 row-start-1"
            onClick={() => toggleCorner(CORNER_TOP_LEFT)}
          >
            <CornerGlyph corner={CORNER_TOP_LEFT} />
          </GlyphToggle>
          <GlyphToggle
            pressed={(corners & CORNER_TOP_RIGHT) !== 0}
            label={MESSAGES.cornerTopRight}
            position="col-start-2 row-start-1"
            onClick={() => toggleCorner(CORNER_TOP_RIGHT)}
          >
            <CornerGlyph corner={CORNER_TOP_RIGHT} />
          </GlyphToggle>
          <GlyphToggle
            pressed={(corners & CORNER_BOTTOM_LEFT) !== 0}
            label={MESSAGES.cornerBottomLeft}
            position="col-start-1 row-start-2"
            onClick={() => toggleCorner(CORNER_BOTTOM_LEFT)}
          >
            <CornerGlyph corner={CORNER_BOTTOM_LEFT} />
          </GlyphToggle>
          <GlyphToggle
            pressed={(corners & CORNER_BOTTOM_RIGHT) !== 0}
            label={MESSAGES.cornerBottomRight}
            position="col-start-2 row-start-2"
            onClick={() => toggleCorner(CORNER_BOTTOM_RIGHT)}
          >
            <CornerGlyph corner={CORNER_BOTTOM_RIGHT} />
          </GlyphToggle>
        </div>
        <p className="text-xs text-muted-foreground/80">{MESSAGES.roundingHint}</p>
      </div>

      <div className="flex flex-col gap-2 border-t border-border/60 pt-2">
        <p className="text-xs text-muted-foreground">{MESSAGES.borders}</p>
        <Button
          variant={sides !== 0 ? "secondary" : "outline"}
          size="sm"
          className="w-full"
          aria-pressed={sides !== 0}
          aria-label={MESSAGES.borderToggle}
          title={MESSAGES.borderToggle}
          onClick={toggleBorder}
        >
          <BorderGlyph />
          {MESSAGES.borderToggle}
        </Button>
        <p className="text-xs text-muted-foreground/80">{MESSAGES.borderHint}</p>
        <SliderField
          label={MESSAGES.borderWidth}
          value={width}
          min={MIN_BORDER_WIDTH}
          max={MAX_BORDER_WIDTH}
          step={1}
          onPreview={previewBorderWidth}
          onCommit={(value) => setBorder({ ...style.border, width: value })}
        />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <ColourField
              label={MESSAGES.borderColor}
              value={color ?? inkColor}
              colors={swatches}
              onPick={(next) => setBorder({ ...style.border, color: next })}
              labelFor={(next) => swatchLabel(MESSAGES.borderColor, next)}
              hideLabel
            />
          </div>
          {color !== undefined ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={MESSAGES.borderUseInk}
              title={MESSAGES.borderUseInk}
              onClick={() => setBorder({ sides, width })}
            >
              <RotateCcw />
              {MESSAGES.borderUseInk}
            </Button>
          ) : null}
        </div>
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
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={
                  selectionCount === 0 ||
                  ARRANGE_ITEMS.every(({ action }) => !canArrange(action))
                }
                render={
                  <Button variant="outline" size="sm">
                    <Layers />
                    {MESSAGES.arrange}
                  </Button>
                }
              />
              {/*
                The vendored content defaults to `w-(--anchor-width)` — the
                trigger is small, so the labels would wrap. Fit the rows
                instead, bounded by the viewport (Base UI's `--available-width`).
              */}
              <DropdownMenuContent
                align="start"
                className="w-auto max-w-(--available-width)"
              >
                {ARRANGE_ITEMS.map(({ action, label, hint, Icon }) => (
                  <DropdownMenuItem
                    key={action}
                    disabled={!canArrange(action)}
                    onClick={() => arrange(action)}
                  >
                    <Icon />
                    {label}
                    <DropdownMenuShortcut dir="ltr">{hint}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
