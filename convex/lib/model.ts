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
 *   - The plane is divided into square cells of `config.base` units.
 *   - Within each cell, each axis is split into two zones at `config.ratio`:
 *       ink zone   = [0, ratio)        → fragment size = ratio · base
 *       space zone = [ratio, 1)        → fragment size = (1 − ratio) · base
 *   - A click inside a cell picks the zone of each axis independently,
 *     yielding a fragment of (w, h) ∈ {ink, space}² — the classic square-kufi
 *     «قلم / فراغ» subdivision. The ink part is at the **start** (top-left) of
 *     the cell, exactly like the old app's `rectFromPoint`.
 *
 * Coordinate system (circular grid):
 *   - Same viewBox; the circle is centered at (500, 500).
 *   - Radially divided into bands of `config.base` units from the center.
 *   - Angularly divided into 36 sectors of 10° (2π/36) each.
 *   - The same zone logic applies per axis: radial zone and angular zone.
 *
 * Field names are spelled out (`column`, not `i`): the JSON is read by people
 * and by `.kuficraft` files, and the old one-letter names (`t/k/i/j/q/s/c/r`)
 * were unreadable. Item **keys** stay compact strings — they are identity, not
 * data, and `docs/CANVAS.md` §3 defines them.
 *
 * Anchors:
 *   tile    — `column`, `row`, `zone`: one fragment of one cell.
 *   others  — `from`/`to` (`Cell`) or `points` (`Cell[]`): whole ink cells.
 */

import { v } from "convex/values";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Fixed SVG viewBox edge length. */
export const VIEWBOX_SIZE = 1000;

/** Default cell / radial-band size in viewBox units. */
export const DEFAULT_BASE = 10;

/** One of the five ratios a square-kufi designer works in, as `space:ink`. */
export interface RatioPreset {
  /** Parts of space — `0` for the space-less `1:1` cell. */
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
 * (space:ink). `1:1` is the **space-less cell** — the ink fills the whole cell
 * (the old app's «mono» grid), so every square is a main rect and every tool
 * can start anywhere; `1:2 … 1:5` put 1 part of space beside N parts of ink.
 * `docs/CANVAS.md` §2.
 */
export const RATIO_PRESETS: readonly RatioPreset[] = [
  { space: 0, ink: 1, ratio: 1, label: "1:1" },
  { space: 1, ink: 2, ratio: 2 / 3, label: "1:2" },
  { space: 1, ink: 3, ratio: 3 / 4, label: "1:3" },
  { space: 1, ink: 4, ratio: 4 / 5, label: "1:4" },
  { space: 1, ink: 5, ratio: 5 / 6, label: "1:5" },
];

/** Default ink fraction of each cell — 1:3 (the old app's «1/4 : 3/4»). */
export const DEFAULT_RATIO = 3 / 4;

/**
 * The ends of the axis as numbers. The presets are ordered by *label*, and the
 * space-less `1:1` is the densest cell, so the bounds are the numeric extremes
 * rather than the first and last entries. Every stored ratio is one of the five.
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

/** Angular divisions of the circular grid (10° sectors). */
export const CIRCULAR_SECTORS = 36;
export const CIRCULAR_ANGULAR_UNIT = (2 * Math.PI) / CIRCULAR_SECTORS;

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
 * 0 = full ink fragment (the old app's `isMainRect`), 3 = the small fragment
 * in the space-space corner.
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

/** Arc extent: `half` = semicircle (the old app), `threeQuarter` = 270°. */
export type ArcSize = "half" | "threeQuarter";

export const ARC_DIRECTIONS: readonly ArcDirection[] = [
  "clockwise",
  "counterclockwise",
];

export const ARC_SIZES: readonly ArcSize[] = ["half", "threeQuarter"];

/** A whole cell: the anchor every line / arc / polyline point uses. */
export interface Cell {
  column: number;
  row: number;
}

/** A cell fragment: cell + which of the four sub-squares (see `Zone`). */
export interface Anchor extends Cell {
  zone: Zone;
}

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
  /** Colour override; absent means `config.ink`. */
  color?: string;
}

/**
 * An axis-aligned run of ink cells drawn as one continuous bar of ink
 * thickness — exactly the old line tool's two-point case (`line()` in the
 * reference app, which emitted the bar as a run of ink/space fragments).
 * `from`/`to` are canonicalised by `compareCells`.
 */
export interface LineItem {
  type: "line";
  key: string;
  from: Cell;
  to: Cell;
  color?: string;
}

/**
 * A multi-point polyline — the old line tool's diagonal case and any run of
 * three or more points. Drawn as a **stroked** path through the cell ink
 * centres (stroke width = ink thickness), like the reference app.
 */
export interface StrokeItem {
  type: "stroke";
  key: string;
  points: Cell[];
  /** Closed polyline (`Z` in the path); absent means open. */
  closed?: boolean;
  color?: string;
}

/**
 * A rib (قوس) between two ink cells on the same row, the same column or a
 * 45° diagonal. Rendered as a stroked arc of ink thickness, springing from
 * the ink edges — `docs/CANVAS.md` §5 has the exact geometry.
 */
export interface ArcItem {
  type: "arc";
  key: string;
  from: Cell;
  to: Cell;
  direction: ArcDirection;
  size: ArcSize;
  color?: string;
}

export type CanvasItem = TileItem | LineItem | StrokeItem | ArcItem;

export type CanvasItemType = CanvasItem["type"];

export interface ProjectConfig {
  gridType: GridType;
  /** Ink fraction per cell — one of `RATIO_PRESETS` (`1:1` … `1:5`). */
  ratio: number;
  /** Cell size in viewBox units. */
  base: number;
  /** Default ink color. */
  ink: string;
  /** Canvas background (hex or "transparent"). */
  background: string;
  /** Show the construction grid. */
  showGrid: boolean;
  /** Merge a straight pen stroke of ink squares into one `line` item. */
  mergeLines: boolean;
}

/* ------------------------------------------------------------------ */
/* Defaults + keys                                                     */
/* ------------------------------------------------------------------ */

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  gridType: "square",
  ratio: DEFAULT_RATIO,
  base: DEFAULT_BASE,
  ink: DEFAULT_INK,
  background: DEFAULT_BACKGROUND,
  showGrid: false,
  mergeLines: true,
};

/** Canonical cell order: by column, then row. */
export function compareCells(a: Cell, b: Cell): number {
  return a.column - b.column || a.row - b.row;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.column === b.column && a.row === b.row;
}

/** `"column:row"` — the compact cell notation the keys are built from. */
function cellKey(cell: Cell): string {
  return `${cell.column}:${cell.row}`;
}

export function tileKey(column: number, row: number, zone: Zone): string {
  return `tile:${column}:${row}:${zone}`;
}

/** Identity of a line: its two cells, canonicalised. */
export function lineKey(from: Cell, to: Cell): string {
  const [a, b] = compareCells(from, to) <= 0 ? [from, to] : [to, from];
  return `line:${cellKey(a)}>${cellKey(b)}`;
}

/**
 * Identity of a polyline: a digest of its point list, because a stroke's
 * point list is unbounded and a key must stay inside `MAX_KEY_LENGTH`.
 */
export function strokeKey(points: readonly Cell[], closed: boolean): string {
  const payload = `${points.map(cellKey).join(";")}|${closed ? "closed" : "open"}`;
  return `stroke:${digest(payload)}`;
}

export function arcKey(
  from: Cell,
  to: Cell,
  direction: ArcDirection,
  size: ArcSize,
): string {
  const [a, b] = compareCells(from, to) <= 0 ? [from, to] : [to, from];
  return `arc:${cellKey(a)}>${cellKey(b)}|${direction}|${size}`;
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
      ].join("|");
    case "line":
      return [
        item.key,
        item.from.column,
        item.from.row,
        item.to.column,
        item.to.row,
        item.color ?? "",
      ].join("|");
    case "stroke":
      return [
        item.key,
        item.points.map(cellKey).join(";"),
        item.closed ? 1 : 0,
        item.color ?? "",
      ].join("|");
    case "arc":
      return [
        item.key,
        item.from.column,
        item.from.row,
        item.to.column,
        item.to.row,
        item.direction,
        item.size,
        item.color ?? "",
      ].join("|");
  }
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
  v.literal("half"),
  v.literal("threeQuarter"),
);

export const cellValidator = v.object({
  column: v.number(),
  row: v.number(),
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
    color: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("line"),
    key: v.string(),
    from: cellValidator,
    to: cellValidator,
    color: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("stroke"),
    key: v.string(),
    points: v.array(cellValidator),
    closed: v.optional(v.boolean()),
    color: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("arc"),
    key: v.string(),
    from: cellValidator,
    to: cellValidator,
    direction: arcDirectionValidator,
    size: arcSizeValidator,
    color: v.optional(v.string()),
  }),
);

export const projectConfigValidator = v.object({
  gridType: gridTypeValidator,
  ratio: v.number(),
  base: v.number(),
  ink: v.string(),
  background: v.string(),
  showGrid: v.boolean(),
  mergeLines: v.boolean(),
});
