"use client";

/**
 * KufiCraft — the drawing half of the sidebar, in three sections.
 *
 * `ShapePalette` feeds the next drawn tiles *and* reshapes the current
 * selection (docs/UI.md §Editor) — rotation cycles `r` in quarter turns (`R`
 * on the keyboard too). `SelectionActions` is the contextual block: it exists
 * only while a selection is live, between the fill control and the style
 * blocks. `ShapeStylePanel` owns the rest: the rounding block sets the corners
 * of tiles, the stroke block sets the cap and join of stroked items, and the
 * border block sets the band width and colour around the whole shape.
 *
 * Rounding, stroke ends/joins and the border work like the shape buttons: they
 * set the **draw style** (what the pen paints next) and, when a selection is
 * live, re-style it in the same click. The displayed values follow the
 * selection — the first selected item's own rounding, border, cap and join
 * while one is active, the draw style otherwise (initially: no rounding, no
 * border, butt/miter). The rounding slider is a per-item fraction of the
 * shorter side, so the panel shows it as a percentage of the model's `0…0.5`.
 *
 * The corner map is hidden for the line and arc targets: a selection made only
 * of lines/arcs, or the line/arc tool with nothing selected. The radius slider
 * stays; only the corner map is conditional. The stroke block is absent unless
 * a line, polyline or arc is selected (or the line/arc tool is active). The
 * border applies to every item and is always shown. The selection actions are
 * revealed by the selection itself: with nothing selected there is no
 * “التحديد” block and no disabled buttons.
 */

import {
  BringToFront,
  ChevronDown,
  ChevronUp,
  Copy,
  Layers,
  PaintBucket,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { tileIconPath } from "@/lib/canvas/items";
import {
  CORNER_BOTTOM_LEFT,
  CORNER_BOTTOM_RIGHT,
  CORNER_TOP_LEFT,
  CORNER_TOP_RIGHT,
  MAX_BORDER_WIDTH,
  MAX_ROUNDING_RADIUS,
  MIN_BORDER_WIDTH,
  STROKE_CAPS,
  STROKE_JOINS,
} from "@/lib/canvas/model";
import type {
  ItemBorder,
  ItemRounding,
  Rotation,
  ShapeId,
  StrokeCap,
  StrokeJoin,
} from "@/lib/canvas/model";
import type { ArrangeAction } from "@/lib/canvas/ops";
import { MESSAGES } from "./messages";
import { INK_SWATCHES, formatCount, mergedSwatches, swatchLabel } from "./editor-palette";
import { ColourField, PanelSection, SliderField } from "./editor-controls";
import { SHAPE_LABELS, SHAPE_ORDER } from "./interaction";
import type { DrawStyle } from "./interaction";
import { shapeDigit, shortcutAriaLabel } from "./shortcut-hints";
import { ShortcutTooltip } from "./shortcut-tooltip";
import { usePrimaryModifier } from "./use-primary-modifier";

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
    <ShortcutTooltip
      label={label}
      trigger={
        <Button
          variant={pressed ? "secondary" : "outline"}
          size="icon"
          className={position}
          aria-pressed={pressed}
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      }
    />
  );
}

const CAP_LABELS: Record<StrokeCap, string> = {
  butt: MESSAGES.strokeCapButt,
  round: MESSAGES.strokeCapRound,
  square: MESSAGES.strokeCapSquare,
};

const JOIN_LABELS: Record<StrokeJoin, string> = {
  miter: MESSAGES.strokeJoinMiter,
  round: MESSAGES.strokeJoinRound,
  bevel: MESSAGES.strokeJoinBevel,
};

/** The arrange commands in Illustrator/Figma order; the keys come from the hint layer. */
const ARRANGE_ITEMS = [
  {
    action: "front",
    label: MESSAGES.bringToFront,
    Icon: BringToFront,
  },
  {
    action: "forward",
    label: MESSAGES.bringForward,
    Icon: ChevronUp,
  },
  {
    action: "backward",
    label: MESSAGES.sendBackward,
    Icon: ChevronDown,
  },
  {
    action: "back",
    label: MESSAGES.sendToBack,
    Icon: SendToBack,
  },
] as const;

export interface ShapePaletteProps {
  style: DrawStyle;
  selectShape: (shape: ShapeId) => void;
  rotateShape: () => void;
}

/**
 * The ten glyphs wrap like the colour swatches — side by side, never a rigid
 * five-column grid — and the single rotation button stays under them.
 */
export function ShapePalette({
  style,
  selectShape,
  rotateShape,
}: ShapePaletteProps) {
  // The platform only names the primary modifier; the palette accepts both.
  const primary = usePrimaryModifier();

  return (
    <PanelSection title={MESSAGES.shapes}>
      <div className="flex flex-wrap gap-1">
        {SHAPE_ORDER.map((shape) => {
          // The tenth glyph has no digit (only `1…9` are mapped), so its
          // tooltip names it without a key — the surface never promises a dead
          // key. Every other button says “name + digit” on hover/focus; the
          // visible label and the accessible name stay the name alone.
          const digit = shapeDigit(shape);
          return (
            <ShortcutTooltip
              key={shape}
              label={SHAPE_LABELS[shape]}
              shortcut={{ kind: "shape", shape }}
              trigger={
                <Button
                  variant={style.shape === shape ? "secondary" : "outline"}
                  size="icon"
                  aria-pressed={style.shape === shape}
                  aria-label={SHAPE_LABELS[shape]}
                  aria-keyshortcuts={digit ?? undefined}
                  onClick={() => selectShape(shape)}
                >
                  <ShapeGlyph shape={shape} rotation={style.rotation} />
                </Button>
              }
            />
          );
        })}
      </div>

      <ShortcutTooltip
        label={MESSAGES.rotate}
        shortcut={{ kind: "rotate" }}
        trigger={
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            aria-label={`${MESSAGES.rotate} ${style.rotation * 90}°`}
            aria-keyshortcuts={shortcutAriaLabel({ kind: "rotate" }, primary)}
            onClick={rotateShape}
          >
            <RotateCw />
            {MESSAGES.rotate}
            <span className="tabular-nums text-muted-foreground">
              {style.rotation * 90}°
            </span>
          </Button>
        }
      />
    </PanelSection>
  );
}

export interface SelectionActionsProps {
  /** The ink colour, used by “تلوين بلون الحبر”. */
  inkColor: string;
  selectionCount: number;
  recolourSelection: (color: string) => void;
  duplicateSelection: () => void;
  deleteSelection: () => void;
  /** Moves the selection in the render order. */
  arrange: (action: ArrangeAction) => void;
  /** Per-action no-op detection (disabled menu items). */
  canArrange: (action: ArrangeAction) => boolean;
}

/**
 * The contextual block: it exists only while something is selected, and it
 * sits between the fill control and the style blocks so the eye reaches the
 * actions that belong to the selection before the next-shape style.
 */
export function SelectionActions({
  inkColor,
  selectionCount,
  recolourSelection,
  duplicateSelection,
  deleteSelection,
  arrange,
  canArrange,
}: SelectionActionsProps) {
  const primary = usePrimaryModifier();

  if (selectionCount === 0) return null;

  return (
    <PanelSection
      title={`${MESSAGES.selection} · ${MESSAGES.selectedCount} ${formatCount(selectionCount)}`}
    >
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => recolourSelection(inkColor)}
        >
          <PaintBucket />
          {MESSAGES.recolourSelection}
        </Button>
        <ShortcutTooltip
          label={MESSAGES.duplicateSelection}
          shortcut={{ kind: "duplicate" }}
          trigger={
            <Button
              variant="outline"
              size="sm"
              aria-keyshortcuts={shortcutAriaLabel({ kind: "duplicate" }, primary)}
              onClick={duplicateSelection}
            >
              <Copy />
              {MESSAGES.duplicateSelection}
            </Button>
          }
        />
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
            trigger is small, so the labels would wrap. Fit the rows instead,
            bounded by the viewport (Base UI's `--available-width`).
          */}
          <DropdownMenuContent
            align="start"
            className="w-auto max-w-(--available-width)"
          >
            {/*
              The row itself is the tooltip trigger: hovering or focusing an
              enabled row reveals its key, while the row text stays key-free.
              A disabled row does not advertise an action that cannot run.
            */}
            {ARRANGE_ITEMS.map(({ action, label, Icon }) => (
              <ShortcutTooltip
                key={action}
                label={label}
                shortcut={{ kind: "arrange", action }}
                trigger={
                  <DropdownMenuItem
                    disabled={!canArrange(action)}
                    aria-keyshortcuts={shortcutAriaLabel(
                      { kind: "arrange", action },
                      primary,
                    )}
                    onClick={() => arrange(action)}
                  >
                    <Icon />
                    {label}
                  </DropdownMenuItem>
                }
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <ShortcutTooltip
          label={MESSAGES.deleteSelection}
          shortcut={{ kind: "delete" }}
          trigger={
            <Button
              variant="outline"
              size="sm"
              aria-keyshortcuts={shortcutAriaLabel({ kind: "delete" }, primary)}
              onClick={deleteSelection}
            >
              <Trash2 />
              {MESSAGES.deleteSelection}
            </Button>
          }
        />
      </div>
    </PanelSection>
  );
}

export interface ShapeStylePanelProps {
  style: DrawStyle;
  /** Whether the 2×2 corner map can affect the current tool or selection. */
  showRoundingCorners: boolean;
  /** Whether the cap/join block can affect the current tool or selection. */
  showStrokeStyle: boolean;
  /** Recent ink colours, offered by the border colour field. */
  inkSwatches: readonly string[];
  /** Corner rounding of the next items (and of the selection, when there is one). */
  setRounding: (rounding: ItemRounding) => void;
  /** Live radius while the slider is dragged (style only, no write). */
  previewRounding: (radius: number) => void;
  /** Border of the next items (and of the selection). */
  setBorder: (border: ItemBorder) => void;
  /** Live width while the slider is dragged (style only, no write). */
  previewBorderWidth: (width: number) => void;
  /** End shape of the next stroked item (and of the selection). */
  setStrokeCap: (cap: StrokeCap) => void;
  /** Turn shape of the next stroked item (and of the selection). */
  setStrokeJoin: (join: StrokeJoin) => void;
}

/**
 * The style half of the drawing controls: rounding (the radius slider for
 * every target, the corner map only where corners exist), stroke ends and
 * joins (lines and arcs only), and the border (every item). The corner map
 * and the stroke block drop out when the current target cannot take them, so
 * a line or arc tool never offers a dead corner map and a tiles-only selection
 * never offers caps. The radius slider stays; only the four corner toggles are
 * conditional.
 */
export function ShapeStylePanel({
  style,
  showRoundingCorners,
  showStrokeStyle,
  inkSwatches,
  setRounding,
  previewRounding,
  setBorder,
  previewBorderWidth,
  setStrokeCap,
  setStrokeJoin,
}: ShapeStylePanelProps) {
  const { radius, corners } = style.rounding;
  const { width, color } = style.border;
  const swatches = useMemo(
    () => mergedSwatches(inkSwatches, INK_SWATCHES),
    [inkSwatches],
  );

  /** Percent of the shorter side — the slider's unit, and what it prints. */
  const percent = Math.round(radius * 100);

  const toggleCorner = (corner: number) => {
    setRounding({ ...style.rounding, corners: corners ^ corner });
  };

  return (
    <>
      <PanelSection title={MESSAGES.rounding}>
        <SliderField
          label={MESSAGES.roundingRadius}
          value={percent}
          min={0}
          max={Math.round(MAX_ROUNDING_RADIUS * 100)}
          step={5}
          suffix="٪"
          onPreview={(value) => previewRounding(value / 100)}
          onCommit={(value) =>
            setRounding({ ...style.rounding, radius: value / 100 })
          }
        />
        {showRoundingCorners && (
          <>
            {/* `dir="ltr"` keeps the 2×2 map physical: in RTL, grid line 1 is
                the right edge, which would silently mirror the four corners. */}
            <div
              className="mx-auto grid w-fit grid-cols-2 gap-1"
              dir="ltr"
              role="group"
              aria-label={MESSAGES.roundingCorners}
            >
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
          </>
        )}
        <p className="text-xs text-muted-foreground/80">
          {MESSAGES.roundingHint}
        </p>
      </PanelSection>

      {showStrokeStyle && (
        <PanelSection title={MESSAGES.strokeStyle}>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {MESSAGES.strokeCap}
            </span>
            <div
              role="group"
              aria-label={MESSAGES.strokeCap}
              className="grid grid-cols-3 gap-1"
            >
              {STROKE_CAPS.map((cap) => (
                <ShortcutTooltip
                  key={cap}
                  label={CAP_LABELS[cap]}
                  trigger={
                    <Button
                      variant={style.cap === cap ? "secondary" : "outline"}
                      size="sm"
                      aria-pressed={style.cap === cap}
                      onClick={() => setStrokeCap(cap)}
                    >
                      {CAP_LABELS[cap]}
                    </Button>
                  }
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {MESSAGES.strokeJoin}
            </span>
            <div
              role="group"
              aria-label={MESSAGES.strokeJoin}
              className="grid grid-cols-3 gap-1"
            >
              {STROKE_JOINS.map((join) => (
                <ShortcutTooltip
                  key={join}
                  label={JOIN_LABELS[join]}
                  trigger={
                    <Button
                      variant={style.join === join ? "secondary" : "outline"}
                      size="sm"
                      aria-pressed={style.join === join}
                      onClick={() => setStrokeJoin(join)}
                    >
                      {JOIN_LABELS[join]}
                    </Button>
                  }
                />
              ))}
            </div>
          </div>
        </PanelSection>
      )}

      <PanelSection title={MESSAGES.borders}>
        <SliderField
          label={MESSAGES.borderWidth}
          value={width}
          min={MIN_BORDER_WIDTH}
          max={MAX_BORDER_WIDTH}
          step={1}
          onPreview={previewBorderWidth}
          onCommit={(value) => setBorder({ ...style.border, width: value })}
        />
        <ColourField
          label={MESSAGES.borderColor}
          value={color}
          colors={swatches}
          onPick={(next) => setBorder({ ...style.border, color: next })}
          labelFor={(next) => swatchLabel(MESSAGES.borderColor, next)}
          hideLabel
        />
      </PanelSection>
    </>
  );
}
