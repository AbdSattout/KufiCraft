/**
 * KufiCraft — shared canvas data model.
 *
 * This module is the single source of truth for the drawing document shape.
 * It is imported BOTH by the client engine and by Convex functions, so it
 * must stay pure TypeScript with no DOM or server-only dependencies
 * (the `convex/values` import is isomorphic and safe on both sides).
 *
 * Coordinate system (square grid):
 *   - The SVG has a fixed viewBox of `0 0 1000 1000`.
 *   - The plane is divided into `gridCount` square cells of `cellSize` units.
 *     `config.base` is the **stored** size; the last cell's trailing space is
 *     cropped, so the drawn cell fills the viewBox and the board ends with ink
 *     exactly on its edge (`cellSize` below, `docs/CANVAS.md` §1).
 *   - Within each cell, each axis is split into two zones at `config.ratio`:
 *       ink zone   = [0, ratio)        → fragment size = ratio · cellSize
 *       space zone = [ratio, 1)        → fragment size = (1 − ratio) · cellSize
 *   - A click inside a cell picks the zone of each axis independently,
 *     yielding a fragment of (w, h) ∈ {ink, space}² — the classic square-kufi
 *     «قلم / فراغ» subdivision. The ink part is at the **start** (top-left) of
 *     the cell, exactly like the old app's `rectFromPoint`.
 *   - Every preset keeps `0 < ratio < 1`, so the four fragments of a cell have
 *     positive area and tile it exactly; the ratio never decides whether two
 *     fragments touch (`docs/CANVAS.md` §2).
 *
 * Coordinate system (circular grid):
 *   - Same viewBox; the circle is centered at (500, 500).
 *   - Radially divided into `gridCount` bands of `cellSize` units from the
 *     center — the same crop, so the design circle ends on the last band's ink.
 *   - Angularly divided into `config.circularSectors` sectors (default 36 →
 *     10°), bounded by `MIN_CIRCULAR_SECTORS`…`MAX_CIRCULAR_SECTORS`.
 *   - The same zone logic applies per axis: radial zone and angular zone.
 *
 * Field names are spelled out (`column`, not `i`): the JSON is read by people
 * and by `.kuficraft` files, and the old one-letter names (`t/k/i/j/q/s/c/r`)
 * were unreadable. Item **keys** stay compact strings — they are identity, not
 * data, and `docs/CANVAS.md` §3 defines them.
 *
 * Anchors:
 *   tile    — `column`, `row`, `zone`: one fragment of one cell.
 *   line    — `from`/`to` (`FragmentPoint`): the fragments its two ends were
 *             placed on (zone absent = the ink fragment).
 *   arc     — `from`/`to` (`FragmentPoint`): the fragments its springs attach
 *             to (zone absent = the ink fragment).
 *   stroke  — `points` (`LinePoint[]`): fragments, each with an optional
 *             `anchor`, a position inside its **own** fragment
 *             (`docs/CANVAS.md` §3).
 */

import { v } from "convex/values";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Fixed SVG viewBox edge length. */
export const VIEWBOX_SIZE = 1000;

/** Default cell / radial-band size in viewBox units. */
export const DEFAULT_BASE = 50;

/** One of the five ratios a square-kufi designer works in, as `space:ink`. */
export interface RatioPreset {
  /** Parts of space — never `0`: every preset has a real gap. */
  space: number;
  /** Parts of ink. */
  ink: number;
  /** Ink fraction of a cell: `ink / (space + ink)`. */
  ratio: number;
  /** Label as designers write it. */
  label: string;
}

/**
 * The ratio axis is **not** continuous: kufi is drawn in `1:1 … 1:5`
 * (space:ink), and every entry is the honest `ink / (space + ink)` split of a
 * cell — `1:1` is half ink beside half space, `1:5` is five parts ink beside
 * one. **No preset is space-less**: at a ratio of `1` the ink fragment became
 * the whole cell and the three space fragments collapsed to zero width, so a
 * tile's zone was invisible until the ratio moved and then reappeared as a
 * different shape (`docs/CANVAS.md` §2 states the invariant that replaces it).
 */
export const RATIO_PRESETS: readonly RatioPreset[] = [
  { space: 1, ink: 1, ratio: 1 / 2, label: "1:1" },
  { space: 1, ink: 2, ratio: 2 / 3, label: "1:2" },
  { space: 1, ink: 3, ratio: 3 / 4, label: "1:3" },
  { space: 1, ink: 4, ratio: 4 / 5, label: "1:4" },
  { space: 1, ink: 5, ratio: 5 / 6, label: "1:5" },
];

/** Default ink fraction of each cell — 1:3 (the old app's «1/4 : 3/4»). */
export const DEFAULT_RATIO = 3 / 4;

/**
 * The ends of the axis as numbers. The presets are ordered by *label*, so the
 * bounds are the numeric extremes rather than the first and last entries:
 * `1:1` is the lightest cell of the scale and `1:5` the densest, and no preset
 * ever reaches the degenerate space-less cell. Every stored ratio is one of the
 * five.
 */
export const MIN_RATIO = Math.min(...RATIO_PRESETS.map((preset) => preset.ratio));
export const MAX_RATIO = Math.max(...RATIO_PRESETS.map((preset) => preset.ratio));

/** Nearest preset to `value` — the only legal values on the ratio axis. */
export function snapRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RATIO;
  let best = RATIO_PRESETS[0].ratio;
  for (const preset of RATIO_PRESETS) {
    if (Math.abs(preset.ratio - value) < Math.abs(best - value)) {
      best = preset.ratio;
    }
  }
  return best;
}

/** Label of the preset a value snaps to, written the way designers do (`1:3`). */
export function ratioLabel(value: number): string {
  const wanted = snapRatio(value);
  for (const preset of RATIO_PRESETS) {
    if (preset.ratio === wanted) return preset.label;
  }
  return RATIO_PRESETS[0].label;
}

/** Default angular divisions of the circular grid — 36 sectors of 10°. */
export const CIRCULAR_SECTORS = 36;
/** The default sector in radians (the angular unit of a board that sets none). */
export const CIRCULAR_ANGULAR_UNIT = (2 * Math.PI) / CIRCULAR_SECTORS;

/**
 * Bounds of the per-board angular division, in sectors. Below 6 (60°) the
 * sectors are wider than the board's own bands so the ring stops reading as a
 * division; above 72 (5°) the spokes crowd the bands they cut.
 */
export const MIN_CIRCULAR_SECTORS = 6;
export const MAX_CIRCULAR_SECTORS = 72;

/**
 * Angular divisions of the board. A document written before the field existed
 * — or a config object that skipped sanitising — stays at 36 (10°).
 */
export function circularSectors(config: ProjectConfig): number {
  return config.circularSectors ?? CIRCULAR_SECTORS;
}

/** One sector of the board in radians — the circular grid's angular unit. */
export function circularAngularUnit(config: ProjectConfig): number {
  return (2 * Math.PI) / circularSectors(config);
}

/**
 * Hard limits enforced by the backend.
 *
 * Convex caps **every** array value at 8192 elements (values in documents,
 * function arguments and return values alike), so `items` cannot hold more
 * than that no matter what the handler allows — a larger cap would fail
 * mid-write with a raw system error instead of an Arabic message.
 */
export const MAX_ITEMS = 8192;
export const MAX_NAME_LENGTH = 120;
export const MAX_THUMBNAIL_LENGTH = 24_000;
/** Colours are stored as CSS strings (`oklch(…)`, `#rrggbb`, `transparent`); anything longer is truncated. */
export const MAX_COLOR_LENGTH = 32;
/**
 * Item keys are identity: two items with the same `key` are the same item. An
 * oversized key is **rejected** on write (not truncated — truncation would
 * silently merge distinct items). The longest generated key is an arc's,
 * `arc:250:250>250:250|counterclockwise|threeQuarter` = 48 characters.
 */
export const MAX_KEY_LENGTH = 64;

/**
 * Largest legal grid index for a cell size `base`, in viewBox units.
 *
 * Indices are cell (square) or band (circular) numbers: a point inside the
 * `VIEWBOX_SIZE` square never needs an index above `VIEWBOX_SIZE / base`.
 * Because `base ∈ [4, 100]` the universal ceiling is `VIEWBOX_SIZE / 4 = 250`.
 * A non-finite / non-positive `base` falls back to that ceiling.
 */
export function maxGridIndex(base: number): number {
  if (!Number.isFinite(base) || base <= 0) {
    return Math.floor(VIEWBOX_SIZE / 4);
  }
  return Math.floor(VIEWBOX_SIZE / base);
}

/**
 * Extent the grid is laid out over, in viewBox units: the viewBox edge on the
 * square grid, the radius on the circular one (the circular design is the
 * inscribed circle, so its outermost ring ends on it).
 */
function gridExtent(config: ProjectConfig): number {
  return config.gridType === "circular" ? VIEWBOX_SIZE / 2 : VIEWBOX_SIZE;
}

/**
 * Whole number of cells / radial bands the board shows along its extent. On
 * the square grid this is exactly the `round(VIEWBOX_SIZE / base)` the
 * settings panel announces for `config.base`, so caption and canvas cannot
 * disagree; the circular grid lays the same rounding over its radius. A
 * non-finite / non-positive `base` cannot come from a stored document
 * (`sanitizeConfig` clamps it to `[4, 100]`); the fallback only keeps a
 * degenerate in-memory config finite.
 */
export function gridCount(config: ProjectConfig): number {
  const base = config.base;
  const safe = Number.isFinite(base) && base > 0 ? base : DEFAULT_BASE;
  return Math.max(1, Math.round(gridExtent(config) / safe));
}

/**
 * Effective drawn cell / band size — what every renderer and every
 * interaction uses. `config.base` is the **stored** size; the board is laid
 * out so that it ends with ink, not with a leftover space strip: `gridCount`
 * whole cells of `base` units would leave the last cell's space inside the
 * extent (base `75` → 13 cells + a 25-unit sliver), so the drawn size is
 * `extent / (gridCount − 1 + ratio)`: the last cell contributes only its ink
 * and meets the extent exactly (`docs/CANVAS.md` §1).
 */
export function cellSize(config: ProjectConfig): number {
  const ratio = config.ratio;
  const safe =
    Number.isFinite(ratio) && ratio > 0 ? Math.min(ratio, 1) : DEFAULT_RATIO;
  return gridExtent(config) / (gridCount(config) - 1 + safe);
}

/**
 * Corner bits of a rounding mask. The names are the corners of the **shape's
 * box as it is seen on screen** — top/right/bottom/left are physical, not
 * writing-direction dependent, so «top right» is the same corner in Arabic and
 * in English. `CORNER_ALL` is the default whenever a mask is missing.
 */
export const CORNER_TOP_LEFT = 1;
export const CORNER_TOP_RIGHT = 2;
export const CORNER_BOTTOM_RIGHT = 4;
export const CORNER_BOTTOM_LEFT = 8;
export const CORNER_ALL =
  CORNER_TOP_LEFT | CORNER_TOP_RIGHT | CORNER_BOTTOM_RIGHT | CORNER_BOTTOM_LEFT;

/**
 * Rounding radius as a fraction of the **shorter side of the item's box**: the
 * unit is relative so a radius survives a change of cell size, and it is capped
 * at half the shorter side because a larger radius would have two corners meet.
 * The editor's slider works in 5 % steps (`0…0.5`); the format accepts any
 * value in the range.
 */
export const MAX_ROUNDING_RADIUS = 0.5;

/**
 * Side bits of a border mask — the sides of the item's box as seen on screen.
 * Absent means all four sides, so a pre-sides border paints exactly as it did
 * before the mask existed. `BORDER_ALL` is the canonical "whole border" mask
 * and is never stored.
 */
export const BORDER_TOP = 1;
export const BORDER_RIGHT = 2;
export const BORDER_BOTTOM = 4;
export const BORDER_LEFT = 8;
export const BORDER_ALL =
  BORDER_TOP | BORDER_RIGHT | BORDER_BOTTOM | BORDER_LEFT;

/**
 * Border band width in viewBox units. The width is the switch: `0` means no
 * border, anything above it paints the selected sides (all four by default).
 */
export const MIN_BORDER_WIDTH = 0;
export const MAX_BORDER_WIDTH = 12;
export const DEFAULT_BORDER_WIDTH = 0;

/** A border's colour until the user picks another. */
export const DEFAULT_BORDER_COLOR = "#000000";

/**
 * Stroke ends and joins for the stroked items (a diagonal `line`, a `stroke`
 * polyline and an `arc`). They are the SVG vocabulary, so a renderer can pass
 * them straight through.
 */
export const STROKE_CAPS = ["butt", "round", "square"] as const;
export type StrokeCap = (typeof STROKE_CAPS)[number];

export const STROKE_JOINS = ["miter", "round", "bevel"] as const;
export type StrokeJoin = (typeof STROKE_JOINS)[number];

/** Fresh strokes end flush and meet at a mitre — the pre-option rendering. */
export const DEFAULT_STROKE_CAP: StrokeCap = "butt";
export const DEFAULT_STROKE_JOIN: StrokeJoin = "miter";

/**
 * NaN-safe clamp of a rounding radius. A missing / broken value is `0` — the
 * safe end: there is no rounding at all.
 */
export function clampRoundingRadius(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_ROUNDING_RADIUS, Math.max(0, value));
}

/** A corner mask with only the four real corners set (unknown bits dropped). */
export function clampCornerMask(value: number): number {
  if (!Number.isFinite(value)) return CORNER_ALL;
  return Math.trunc(value) & CORNER_ALL;
}

/** A side mask with only the four real sides set (unknown bits dropped). */
export function clampBorderSides(value: number): number {
  if (!Number.isFinite(value)) return BORDER_ALL;
  return Math.trunc(value) & BORDER_ALL;
}

/** NaN-safe clamp of a border width: `[0, MAX_BORDER_WIDTH]`. */
export function clampBorderWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BORDER_WIDTH;
  return Math.min(MAX_BORDER_WIDTH, Math.max(MIN_BORDER_WIDTH, value));
}

/**
 * Normalises a stored rounding: the radius clamped, the corner mask masked to
 * the four real corners. Returns `undefined` when the radius is `0` — the
 * **absent** state, which renders exactly like a document without rounding.
 */
export function sanitizeRounding(
  rounding: ItemRounding,
): ItemRounding | undefined {
  const radius = clampRoundingRadius(rounding.radius);
  if (radius <= 0) return undefined;
  return { radius, corners: clampCornerMask(rounding.corners) };
}

/**
 * Normalises a stored border: the width is clamped, the side mask is masked to
 * the four real sides and an empty colour falls back to black. Returns
 * `undefined` when the width is zero (or broken) or no side is on — the
 * **absent** state, which renders exactly like an item without a border.
 * All four sides are the default and are omitted, so width/colour-only borders
 * from before the mask existed round-trip byte-stably; only a subset is stored.
 */
export function sanitizeBorder(border: ItemBorder): ItemBorder | undefined {
  const width = clampBorderWidth(border.width);
  const sides =
    border.sides === undefined ? BORDER_ALL : clampBorderSides(border.sides);
  if (width <= 0 || sides === 0) return undefined;
  const color =
    typeof border.color === "string" && border.color.length > 0
      ? border.color.slice(0, MAX_COLOR_LENGTH)
      : DEFAULT_BORDER_COLOR;
  const next: ItemBorder = { width, color };
  if (sides !== BORDER_ALL) next.sides = sides;
  return next;
}

/**
 * The whole-border form of a stored border. Sides are meaningful for tiles
 * only (the editor hides the side map for line/arc targets), so every other
 * item type drops the mask before storing its border. An absent mask is
 * already whole and keeps the object identity.
 */
export function wholeBorder(border: ItemBorder): ItemBorder {
  return border.sides === undefined
    ? border
    : { width: border.width, color: border.color };
}

/** A stored stroke cap, falling back to the flush default when unrecognised. */
export function normalizeStrokeCap(value: unknown): StrokeCap {
  return (STROKE_CAPS as readonly unknown[]).includes(value)
    ? (value as StrokeCap)
    : DEFAULT_STROKE_CAP;
}

/** A stored stroke join, falling back to the mitre default when unrecognised. */
export function normalizeStrokeJoin(value: unknown): StrokeJoin {
  return (STROKE_JOINS as readonly unknown[]).includes(value)
    ? (value as StrokeJoin)
    : DEFAULT_STROKE_JOIN;
}

/**
 * Normalises a stored cap: the default is the absent state, exactly like a
 * zero rounding radius or border width, so documents drawn before the option
 * existed round-trip without new fields.
 */
export function sanitizeStrokeCap(value: unknown): StrokeCap | undefined {
  const cap = normalizeStrokeCap(value);
  return cap === DEFAULT_STROKE_CAP ? undefined : cap;
}

/** Normalises a stored join; the default (`miter`) is the absent state. */
export function sanitizeStrokeJoin(value: unknown): StrokeJoin | undefined {
  const join = normalizeStrokeJoin(value);
  return join === DEFAULT_STROKE_JOIN ? undefined : join;
}

/** Default palette. */
export const DEFAULT_INK = "#1a1a2e";
export const DEFAULT_BACKGROUND = "#ffffff";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type GridType = "square" | "circular";

/**
 * Zone quadrant of a cell / circular slice.
 * bit0 (1) → x (square) / radial (circular) axis is in the space zone.
 * bit1 (2) → y (square) / angular (circular) axis is in the space zone.
 * 0 = the ink square of the cell (the old app's `isMainRect`), 3 = the
 * fragment in the space-space corner. Every preset leaves all four fragments
 * with a positive area, and at the equal `1:1` the four are congruent.
 */
export type Zone = 0 | 1 | 2 | 3;

/** Quarter turns clockwise (0…3). */
export type Rotation = 0 | 1 | 2 | 3;

/**
 * The pen's shape palette — the ten entries of the old app's `#submenu`, in
 * its order. `pentagon` is the old `semi-hexagone` (a typo *and* a misnomer:
 * the glyph is a house-shaped pentagon); `curve` is the old `arc` (renamed so
 * it cannot be confused with the `arc` *tool*); `comb` is the old untitled
 * tenth entry (`title=""`), a three-toothed comb.
 */
export type ShapeId =
  | "square"
  | "circle"
  | "triangle"
  | "quarterCircle"
  | "semiCircle"
  | "pentagon"
  | "curve"
  | "hamza1"
  | "hamza2"
  | "comb";

/** Palette order; digits `1…9` pick by index (see `shortcuts.ts`). */
export const SHAPE_IDS: readonly ShapeId[] = [
  "square",
  "circle",
  "triangle",
  "quarterCircle",
  "semiCircle",
  "pentagon",
  "curve",
  "hamza1",
  "hamza2",
  "comb",
];

/**
 * SVG sweep direction of an arc. `clockwise` is the old app's «الاتجاه الموجب»
 * (`#overclockwise`, `archDir = 1`), `counterclockwise` its «الاتجاه السالب».
 * The value is *literally* the SVG sweep flag (1 / 0) in `arcPath`.
 */
export type ArcDirection = "clockwise" | "counterclockwise";

/**
 * Arc extent, always measured on the chord between the two endpoints:
 * `quarter` = 90° (the angle the reference app's diagonal auto-switch
 * produced), `half` = a semicircle (the old app's normal case),
 * `threeQuarter` = 270°.
 */
export type ArcSize = "quarter" | "half" | "threeQuarter";

export const ARC_DIRECTIONS: readonly ArcDirection[] = [
  "clockwise",
  "counterclockwise",
];

export const ARC_SIZES: readonly ArcSize[] = ["quarter", "half", "threeQuarter"];

/** A whole cell: the anchor every line / arc / polyline point uses. */
export interface Cell {
  column: number;
  row: number;
}

/** A cell fragment: cell + which of the four sub-squares (see `Zone`). */
export interface Anchor extends Cell {
  zone: Zone;
}

/**
 * Corner rounding: the radius (a fraction of the shorter side of the item's
 * box, `0…MAX_ROUNDING_RADIUS`) and which of the box's four corners are rounded
 * (`CORNER_*` bits). Tiles and line bars round the box's own corners; a
 * stroke's interior turns always round. Absent means square corners — exactly
 * the old rendering.
 */
export interface ItemRounding {
  radius: number;
  corners: number;
}

/**
 * A border drawn around the item's shape: `width` is the visible band in
 * viewBox units on each painted side (`0` means no border), `color` is the
 * border colour, and the optional `sides` mask selects which sides of the box
 * paint (`BORDER_*` bits). Absent `sides` means all four — exactly the border
 * of a document written before the mask existed. The mask belongs to tiles;
 * line, polyline and arc borders are always whole.
 */
export interface ItemBorder {
  width: number;
  color: string;
  sides?: number;
}

/** The draw style's border before the user raises its width: off, black. */
export const DEFAULT_BORDER: ItemBorder = {
  width: 0,
  color: DEFAULT_BORDER_COLOR,
};

/**
 * A position inside one **fragment**, as fractions of that fragment's extent
 * on each axis: `{x: 0, y: 0}` is the fragment's origin, `{x: 1, y: 1}` its
 * opposite corner, `{x: 0.5, y: 0.5}` its centre. On the ink fragment (zone 0,
 * the default) that region is the cell's ink square, exactly as before zones
 * existed; on a space fragment it is that space square. The editor snaps the
 * pointer to the nine `ANCHOR_GRID` positions of the fragment under the
 * cursor; the format itself accepts any fraction in `[0, 1]`, so free
 * positioning needs no format change later.
 */
export interface InkPoint {
  x: number;
  y: number;
}

/**
 * A cell plus the fragment of it a stored point addresses. `zone` is absent
 * for the ink fragment (0) — the only fragment the model had before space
 * points existed — so every line, arc and stroke written by an earlier
 * version round-trips byte-identically (`docs/CANVAS.md` §3).
 */
export interface FragmentPoint extends Cell {
  zone?: Zone;
}

/**
 * A line point: a fragment plus where inside it the point sits. Absent
 * `anchor` means the fragment's centre — the point every pre-anchor line point
 * used — and the centre is **never stored** (`linePoint` drops it), so
 * documents, files and keys written before anchors existed round-trip
 * byte-identically.
 */
export interface LinePoint extends FragmentPoint {
  anchor?: InkPoint;
}

/**
 * An **arc endpoint**: the same point type as a line point (a fragment plus an
 * optional anchor), read the other way round. An absent `anchor` does **not**
 * mean the centre here: it means the reference app's spring point for that
 * endpoint (`docs/CANVAS.md` §5), which is what keeps every stored pre-anchor
 * arc drawing exactly as it did. The centre is therefore a real, storable
 * choice for an arc endpoint, and the arc tool always writes the anchor it
 * clicked. The type is an alias — lines, strokes and arcs share one point
 * model, so a zone and an anchor travel together everywhere.
 */
export type ArcPoint = LinePoint;

/** The centre of a fragment: what an absent anchor normalises to. */
export const CENTRE_ANCHOR: InkPoint = { x: 0.5, y: 0.5 };

/**
 * The nine positions the line tool snaps to, row-major (`docs/CANVAS.md` §3):
 * `(0,0)`, `(0.5,0)`, `(1,0)`, `(0,0.5)`, …, `(1,1)`. Their order here is also
 * their index order in the documentation.
 */
export const ANCHOR_GRID: readonly InkPoint[] = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: 1, y: 0.5 },
  { x: 0, y: 1 },
  { x: 0.5, y: 1 },
  { x: 1, y: 1 },
];

/** One zone fragment, painted with one shape. */
export interface TileItem {
  type: "tile";
  key: string;
  column: number;
  row: number;
  zone: Zone;
  /** Shape variant; absent means `square`. */
  shape?: ShapeId;
  /** Rotation in quarter turns; absent means 0. */
  rotation?: Rotation;
  /** Corner rounding; absent means square corners. */
  rounding?: ItemRounding;
  /** Border duplicates; absent means none. */
  border?: ItemBorder;
  /** Colour override; absent means `config.ink`. */
  color?: string;
}

/**
 * An axis-aligned run of fragments drawn as one continuous bar — exactly the
 * old line tool's two-point case (`line()` in the reference app, which emitted
 * the bar as a run of ink/space fragments). The bar's cross-section is the
 * canonical first end's stripe; its length runs from that fragment's start to
 * the second fragment's end. `from`/`to` are canonicalised by
 * `compareFragments` (column, then row, then zone).
 */
export interface LineItem {
  type: "line";
  key: string;
  from: FragmentPoint;
  to: FragmentPoint;
  /** Corner rounding of the bar's box; absent means square corners. */
  rounding?: ItemRounding;
  border?: ItemBorder;
  /** End shape when the pair falls back to a stroke; absent means butt. */
  cap?: StrokeCap;
  /** Turn shape when the pair falls back to a stroke; absent means miter. */
  join?: StrokeJoin;
  color?: string;
}

/**
 * A multi-point polyline — the old line tool's diagonal case and any run of
 * three or more points. Drawn as a **stroked** path through the points, stroke
 * width = ink thickness, like the reference app.
 */
export interface StrokeItem {
  type: "stroke";
  key: string;
  points: LinePoint[];
  /** Closed polyline (`Z` in the path); absent means open. */
  closed?: boolean;
  /** Rounding of the polyline's turns; absent means sharp corners. */
  rounding?: ItemRounding;
  border?: ItemBorder;
  /** End shape of an open polyline; absent means butt. */
  cap?: StrokeCap;
  /** Shape of the polyline's turns; absent means miter. */
  join?: StrokeJoin;
  color?: string;
}

/**
 * A rib (قوس) between two fragments on the same row, the same column or a
 * 45° diagonal. Rendered as a stroked arc of ink thickness between its two
 * endpoints; `from`/`to` carry the fragment and the anchor the user picked
 * inside it (an `ArcPoint`; an absent anchor means the reference app's spring
 * point — see `docs/CANVAS.md` §5).
 */
export interface ArcItem {
  type: "arc";
  key: string;
  from: ArcPoint;
  to: ArcPoint;
  direction: ArcDirection;
  size: ArcSize;
  border?: ItemBorder;
  /** End shape; absent means butt. */
  cap?: StrokeCap;
  /** Turn shape carried with the stroke style; absent means miter. */
  join?: StrokeJoin;
  color?: string;
}

export type CanvasItem = TileItem | LineItem | StrokeItem | ArcItem;

export type CanvasItemType = CanvasItem["type"];

export interface ProjectConfig {
  gridType: GridType;
  /**
   * Ink fraction per cell — one of `RATIO_PRESETS` (`1:1` … `1:5`), always
   * below the space-less `1`; anything else is snapped by `snapRatio`.
   */
  ratio: number;
  /** Cell size in viewBox units. */
  base: number;
  /**
   * Angular divisions of the circular grid, in sectors. Sanitisers fill
   * `CIRCULAR_SECTORS` (36 → 10°) when absent, so documents written before the
   * field existed keep their exact old geometry.
   */
  circularSectors: number;
  /** Default ink color. */
  ink: string;
  /** Canvas background (hex or "transparent"). */
  background: string;
  /** Show the construction grid. */
  showGrid: boolean;
  /**
   * Draw a straight run with the line tool as one square per cell (the
   * reference app) instead of one solid `line` bar.
   */
  straightLinesAsSquares: boolean;
}

/* ------------------------------------------------------------------ */
/* Defaults + keys                                                     */
/* ------------------------------------------------------------------ */

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  gridType: "square",
  ratio: DEFAULT_RATIO,
  base: DEFAULT_BASE,
  circularSectors: CIRCULAR_SECTORS,
  ink: DEFAULT_INK,
  background: DEFAULT_BACKGROUND,
  showGrid: false,
  straightLinesAsSquares: true,
};

/** Canonical cell order: by column, then row. */
export function compareCells(a: Cell, b: Cell): number {
  return a.column - b.column || a.row - b.row;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.column === b.column && a.row === b.row;
}

/* ------------------------------------------------------------------ */
/* Line points                                                         */
/* ------------------------------------------------------------------ */

/** Whether `anchor` is the ink centre — the one anchor never stored. */
export function isCentreAnchor(anchor: InkPoint): boolean {
  return anchor.x === CENTRE_ANCHOR.x && anchor.y === CENTRE_ANCHOR.y;
}

/** The fragment a stored point addresses; absent means the ink fragment. */
export function zoneOf(point: FragmentPoint): Zone {
  return point.zone ?? 0;
}

/**
 * Builds a fragment point, canonicalising the zone: **the ink zone is
 * dropped**, so `zone: 0`, no zone at all and every document written before
 * space points existed produce the same value, key and JSON.
 */
export function fragmentPoint(
  column: number,
  row: number,
  zone?: Zone,
): FragmentPoint {
  if (zone === undefined || zone === 0) return { column, row };
  return { column, row, zone };
}

/** The anchor a point draws at: its own, or its fragment's centre when absent. */
export function anchorOf(point: LinePoint): InkPoint {
  return point.anchor ?? CENTRE_ANCHOR;
}

/** Whether a point carries its own (non-centre) anchor. */
export function hasAnchor(point: LinePoint): boolean {
  return !isCentreAnchor(anchorOf(point));
}

/**
 * Builds a line point, canonicalising both optionals: the ink zone and the
 * centre anchor are **dropped**, so every way of naming the same point
 * produces the same value, key and JSON as the pre-fragment model did.
 */
export function linePoint(
  column: number,
  row: number,
  zone?: Zone,
  anchor?: InkPoint,
): LinePoint {
  const point: LinePoint = fragmentPoint(column, row, zone);
  if (anchor !== undefined && !isCentreAnchor(anchor)) {
    point.anchor = { x: anchor.x, y: anchor.y };
  }
  return point;
}

/**
 * Tolerant read of a stored anchor: a record with two finite numbers is
 * clamped to the ink region and returned, except the centre, which is
 * canonical storage of nothing and comes back as `undefined`. Anything else —
 * absent, a wrong shape, `NaN` — is `undefined` too, so every reader (the
 * `.kuficraft` file, the backend sanitiser) repairs a damaged anchor into the
 * cell centre instead of throwing the point away.
 */
export function normalizeAnchor(value: unknown): InkPoint | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const anchor = value as Record<string, unknown>;
  const x = fraction(anchor.x);
  const y = fraction(anchor.y);
  if (x === undefined || y === undefined || isCentreAnchor({ x, y })) {
    return undefined;
  }
  return { x, y };
}

/** A number clamped into the ink region, or `undefined` when not a number. */
function fraction(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

/** Whether two points are the same cell, zone *and* anchor. */
export function sameLinePoint(a: LinePoint, b: LinePoint): boolean {
  const anchorA = anchorOf(a);
  const anchorB = anchorOf(b);
  return (
    a.column === b.column &&
    a.row === b.row &&
    zoneOf(a) === zoneOf(b) &&
    anchorA.x === anchorB.x &&
    anchorA.y === anchorB.y
  );
}

/**
 * Builds an arc endpoint, keeping the anchor verbatim — including the centre.
 * The counterpart of `linePoint`, which drops the centre; for an arc endpoint
 * an absent anchor carries the legacy spring point instead (see `ArcPoint`),
 * so nothing may be dropped here. The zone is canonicalised like every other
 * fragment point (`zone: 0` is dropped).
 */
export function arcPoint(
  column: number,
  row: number,
  zone?: Zone,
  anchor?: InkPoint,
): ArcPoint {
  const point: ArcPoint = fragmentPoint(column, row, zone);
  if (anchor !== undefined) point.anchor = { x: anchor.x, y: anchor.y };
  return point;
}

/**
 * Tolerant read of a stored **arc** anchor: a record with two finite numbers is
 * clamped to the ink region and returned — **the centre included**, which for
 * an arc endpoint is a value like any other. Absent or damaged input is
 * `undefined`, which an arc reads as its legacy spring point, so every reader
 * repairs instead of rejecting.
 */
export function normalizeArcAnchor(value: unknown): InkPoint | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const anchor = value as Record<string, unknown>;
  const x = fraction(anchor.x);
  const y = fraction(anchor.y);
  if (x === undefined || y === undefined) return undefined;
  return { x, y };
}

/** `"column:row"` — the compact cell notation the keys are built from. */
function cellKey(cell: Cell): string {
  return `${cell.column}:${cell.row}`;
}

/**
 * Compact notation of a fragment point: the cell plus `#zone`, which is
 * omitted for the ink fragment so pre-fragment points key exactly as before.
 */
function fragmentKey(point: FragmentPoint): string {
  const zone = zoneOf(point);
  return zone === 0 ? cellKey(point) : `${cellKey(point)}#${zone}`;
}

/** Canonical fragment order: by column, then row, then zone. */
export function compareFragments(a: FragmentPoint, b: FragmentPoint): number {
  return compareCells(a, b) || zoneOf(a) - zoneOf(b);
}

export function tileKey(column: number, row: number, zone: Zone): string {
  return `tile:${column}:${row}:${zone}`;
}

/** Identity of a line: its two fragments, canonicalised. */
export function lineKey(from: FragmentPoint, to: FragmentPoint): string {
  const [a, b] =
    compareFragments(from, to) <= 0 ? [from, to] : [to, from];
  return `line:${fragmentKey(a)}>${fragmentKey(b)}`;
}

/**
 * Compact notation of one line point: the fragment, and the anchor only when
 * it is not the centre (which is absent by construction) — `"2:3"`,
 * `"2:3#1@0,0.5"`, `"2:3@0,0.5"`.
 */
function linePointKey(point: LinePoint): string {
  const anchor = anchorOf(point);
  if (isCentreAnchor(anchor)) return fragmentKey(point);
  return `${fragmentKey(point)}@${anchor.x},${anchor.y}`;
}

/**
 * Identity of a polyline: a digest of its point list, because a stroke's
 * point list is unbounded and a key must stay inside `MAX_KEY_LENGTH`.
 * Anchor-less points key exactly as they did before anchors existed.
 */
export function strokeKey(points: readonly LinePoint[], closed: boolean): string {
  const payload = `${points.map(linePointKey).join(";")}|${closed ? "closed" : "open"}`;
  return `stroke:${digest(payload)}`;
}

/**
 * Compact notation of one arc endpoint: the fragment plus the anchor
 * **exactly as stored** — `linePointKey` without the centre-dropping, because
 * for an arc endpoint the centre is a real value (an absent anchor means the
 * legacy spring point).
 */
function arcPointKey(point: ArcPoint): string {
  const anchor = point.anchor;
  if (anchor === undefined) return fragmentKey(point);
  return `${fragmentKey(point)}@${anchor.x},${anchor.y}`;
}

/**
 * Tolerant read of a stored arc size: `quarter` and `threeQuarter` pass
 * through, anything else — absent or unrecognised — means the old app's
 * `half`.
 */
export function normalizeArcSize(value: unknown): ArcSize {
  return value === "quarter" || value === "threeQuarter" ? value : "half";
}

/**
 * The size a stored arc really means. A legacy **anchor-less diagonal** `half`
 * was drawn at `chord/√2` by the reference app's auto-switch — exactly a
 * quarter — so a reader upgrades it to the size that draws the same arc
 * (`docs/CANVAS.md` §5). Any other arc keeps its size: an anchored diagonal
 * `half` is a true semicircle.
 */
export function repairArcSize(
  from: ArcPoint,
  to: ArcPoint,
  size: ArcSize,
): ArcSize {
  if (size !== "half") return size;
  if (from.anchor !== undefined || to.anchor !== undefined) return size;
  if (from.column === to.column || from.row === to.row) return size;
  return "quarter";
}

/**
 * Identity of a rib: its two fragments (canonicalised by column, row, then
 * zone) plus the controls. An anchor-less arc keys exactly as it did before
 * anchors and zones existed (`#zone` appears only for a space fragment); an arc
 * with anchors appends a **digest** of its endpoints, because a stored anchor
 * may be any fraction in `[0, 1]` and the key must stay inside
 * `MAX_KEY_LENGTH` whatever it carries.
 */
export function arcKey(
  from: ArcPoint,
  to: ArcPoint,
  direction: ArcDirection,
  size: ArcSize,
): string {
  const [a, b] =
    compareFragments(from, to) <= 0 ? [from, to] : [to, from];
  const base = `arc:${fragmentKey(a)}>${fragmentKey(b)}|${direction}|${size}`;
  if (a.anchor === undefined && b.anchor === undefined) return base;
  return `${base}|${digest(`${arcPointKey(a)}>${arcPointKey(b)}`)}`;
}

/**
 * FNV-1a (32-bit) rendered in base-36 — short, deterministic and stable
 * across runs. Used only for polyline identity, never for security.
 */
export function digest(payload: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index++) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Stable projection of an item, used for change detection and for the
 * server reconciliation in `use-editor.ts`. Two items with the same
 * signature paint the same thing.
 */
export function itemSignature(item: CanvasItem): string {
  switch (item.type) {
    case "tile":
      return [
        item.key,
        item.column,
        item.row,
        item.zone,
        item.shape ?? "square",
        item.rotation ?? 0,
        item.color ?? "",
        roundingField(item.rounding),
        borderField(item.border),
      ].join("|");
    case "line":
      return [
        item.key,
        fragmentKey(item.from),
        fragmentKey(item.to),
        item.color ?? "",
        roundingField(item.rounding),
        borderField(item.border),
        strokeField(item.cap, item.join),
      ].join("|");
    case "stroke":
      return [
        item.key,
        item.points.map(linePointKey).join(";"),
        item.closed ? 1 : 0,
        item.color ?? "",
        roundingField(item.rounding),
        borderField(item.border),
        strokeField(item.cap, item.join),
      ].join("|");
    case "arc":
      return [
        item.key,
        arcPointKey(item.from),
        arcPointKey(item.to),
        item.direction,
        item.size,
        item.color ?? "",
        borderField(item.border),
        strokeField(item.cap, item.join),
      ].join("|");
  }
}

/** Rounding as one signature field (`""` when there is none). */
function roundingField(rounding: ItemRounding | undefined): string {
  return rounding === undefined ? "" : `r${rounding.radius}:${rounding.corners}`;
}

/** Border as one signature field (`""` when there is none). */
function borderField(border: ItemBorder | undefined): string {
  if (border === undefined) return "";
  const sides =
    border.sides === undefined ? BORDER_ALL : clampBorderSides(border.sides);
  // A whole border keeps the pre-sides signature; only a subset adds a field.
  const mask = sides === BORDER_ALL ? "" : `:${sides}`;
  return `b${border.width}:${border.color}${mask}`;
}

/** Stroke ends and joins as one signature field (`""` at their defaults). */
function strokeField(cap: StrokeCap | undefined, join: StrokeJoin | undefined): string {
  const normalizedCap = normalizeStrokeCap(cap);
  const normalizedJoin = normalizeStrokeJoin(join);
  if (
    normalizedCap === DEFAULT_STROKE_CAP &&
    normalizedJoin === DEFAULT_STROKE_JOIN
  ) {
    return "";
  }
  return `s${normalizedCap}:${normalizedJoin}`;
}

/* ------------------------------------------------------------------ */
/* Convex validators                                                   */
/* ------------------------------------------------------------------ */

export const gridTypeValidator = v.union(
  v.literal("square"),
  v.literal("circular"),
);

export const zoneValidator = v.union(
  v.literal(0),
  v.literal(1),
  v.literal(2),
  v.literal(3),
);

export const rotationValidator = v.union(
  v.literal(0),
  v.literal(1),
  v.literal(2),
  v.literal(3),
);

export const shapeValidator = v.union(
  v.literal("square"),
  v.literal("circle"),
  v.literal("triangle"),
  v.literal("quarterCircle"),
  v.literal("semiCircle"),
  v.literal("pentagon"),
  v.literal("curve"),
  v.literal("hamza1"),
  v.literal("hamza2"),
  v.literal("comb"),
);

export const arcDirectionValidator = v.union(
  v.literal("clockwise"),
  v.literal("counterclockwise"),
);

export const arcSizeValidator = v.union(
  v.literal("quarter"),
  v.literal("half"),
  v.literal("threeQuarter"),
);

export const strokeCapValidator = v.union(
  v.literal("butt"),
  v.literal("round"),
  v.literal("square"),
);

export const strokeJoinValidator = v.union(
  v.literal("miter"),
  v.literal("round"),
  v.literal("bevel"),
);

export const cellValidator = v.object({
  column: v.number(),
  row: v.number(),
});

/**
 * Rounding + border. The fields are **required** and clamped by
 * `sanitizeRounding` / `sanitizeBorder` on every write, so a document can
 * never carry a radius or a border width outside the model's range.
 */
export const roundingValidator = v.object({
  radius: v.number(),
  corners: v.number(),
});

export const borderValidator = v.object({
  width: v.number(),
  color: v.string(),
  /** Optional side mask; absent means all four sides (a whole border). */
  sides: v.optional(v.number()),
});

/**
 * A stored fragment point: a cell plus the optional zone (absent = ink). A
 * stored zone is structural — the sanitiser drops an item whose zone is not
 * `0…3` rather than moving the point to another square.
 */
export const fragmentValidator = v.object({
  column: v.number(),
  row: v.number(),
  zone: v.optional(zoneValidator),
});

/**
 * A point's anchor, shared by a line/arc point (and a stroke point). The
 * anchor is structurally checked only — the two numbers are unbounded here on
 * purpose: the tools emit the nine `ANCHOR_GRID` positions, but a stored
 * anchor is **repaired** (clamped to `[0, 1]`; the centre dropped for a line
 * point, kept for an arc endpoint) by `sanitizeItem` on the way in rather than
 * rejected at the door, so a write that was valid before anchors existed is
 * still valid, whatever it carries.
 */
export const linePointValidator = v.object({
  column: v.number(),
  row: v.number(),
  zone: v.optional(zoneValidator),
  anchor: v.optional(v.object({ x: v.number(), y: v.number() })),
});

export const canvasItemValidator = v.union(
  v.object({
    type: v.literal("tile"),
    key: v.string(),
    column: v.number(),
    row: v.number(),
    zone: zoneValidator,
    shape: v.optional(shapeValidator),
    rotation: v.optional(rotationValidator),
    rounding: v.optional(roundingValidator),
    border: v.optional(borderValidator),
    color: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("line"),
    key: v.string(),
    from: fragmentValidator,
    to: fragmentValidator,
    rounding: v.optional(roundingValidator),
    border: v.optional(borderValidator),
    cap: v.optional(strokeCapValidator),
    join: v.optional(strokeJoinValidator),
    color: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("stroke"),
    key: v.string(),
    points: v.array(linePointValidator),
    closed: v.optional(v.boolean()),
    rounding: v.optional(roundingValidator),
    border: v.optional(borderValidator),
    cap: v.optional(strokeCapValidator),
    join: v.optional(strokeJoinValidator),
    color: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("arc"),
    key: v.string(),
    from: linePointValidator,
    to: linePointValidator,
    direction: arcDirectionValidator,
    size: arcSizeValidator,
    border: v.optional(borderValidator),
    cap: v.optional(strokeCapValidator),
    join: v.optional(strokeJoinValidator),
    color: v.optional(v.string()),
  }),
);

export const projectConfigValidator = v.object({
  gridType: gridTypeValidator,
  ratio: v.number(),
  base: v.number(),
  /**
   * Optional so a document written before the field was introduced — or a
   * client tab that predates it — still validates; `sanitizeConfig` fills
   * `CIRCULAR_SECTORS` (36) and clamps it into
   * `[MIN_CIRCULAR_SECTORS, MAX_CIRCULAR_SECTORS]`.
   */
  circularSectors: v.optional(v.number()),
  ink: v.string(),
  background: v.string(),
  showGrid: v.boolean(),
  /**
   * Optional so a document written before the field was introduced — or a
   * client tab that predates it — still validates; `sanitizeConfig` fills the
   * default and drops the legacy `mergeLines` flag.
   */
  straightLinesAsSquares: v.optional(v.boolean()),
  /** Legacy (removed): merged a straight pen stroke into one `line` item. */
  mergeLines: v.optional(v.boolean()),
});
