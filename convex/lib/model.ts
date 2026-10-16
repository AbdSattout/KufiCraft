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
 *       ink zone   = [0, ratio)        → drawn fragment size = ratio
 *       space zone = [ratio, 1)        → drawn fragment size = 1 - ratio
 *   - A click inside a cell picks the zone of each axis independently,
 *     yielding a fragment of (w, h) ∈ {ratio, 1-ratio}² — the classic
 *     square-kufi "قلم/فراغ" subdivision.
 *
 * Coordinate system (circular grid):
 *   - Same viewBox; the circle is centered at (500, 500).
 *   - Radially divided into bands of `config.base` units from the center.
 *   - Angularly divided into 36 sectors of 10° (2π/36) each.
 *   - The same zone logic applies per axis: radial zone and angular zone.
 *
 * Anchors (for lines / arches / selection) are expressed in grid units:
 *   square:   (i, j) = cell indices.
 *   circular: (i, j) = (radial band index, sector index).
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
  /** Parts of space (always 1 in the classic scale). */
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
 * (space:ink), so ink is never smaller than space. `docs/CANVAS.md` §2.
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

/** Smallest and largest preset; every stored ratio is one of the five. */
export const MIN_RATIO = RATIO_PRESETS[0].ratio;
export const MAX_RATIO = RATIO_PRESETS[RATIO_PRESETS.length - 1].ratio;

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
 * Item keys are identity: two items with the same `k` are the same item. An
 * oversized key is **rejected** on write (not truncated — truncation would
 * silently merge distinct items). Generated keys (`tileKey`, `lineKey`,
 * `archKey`) stay far below this.
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

export type TileShape =
  | "square"
  | "circle"
  | "triangle"
  | "quadrant"
  | "semicircle"
  | "hexagon"
  | "arc"
  | "hamza1"
  | "hamza2";

/**
 * Zone quadrant of a cell / circular slice.
 * bit0 (1) → x (square) / radial (circular) axis is in the space zone.
 * bit1 (2) → y (square) / angular (circular) axis is in the space zone.
 * 0 = full ink fragment, 3 = the small fragment in the space-space corner.
 */
export type ZoneQuadrant = 0 | 1 | 2 | 3;

export interface TileItem {
  /** Discriminant + stable unique key (see `tileKey`). */
  t: "tile";
  k: string;
  /** square: cell column / circular: radial band index. */
  i: number;
  /** square: cell row / circular: sector index. */
  j: number;
  q: ZoneQuadrant;
  /** Shape variant; defaults to "square". */
  s?: TileShape;
  /** Color override (hex); defaults to `config.ink`. */
  c?: string;
  /** Rotation in quarter turns (shapes only); defaults to 0. */
  r?: 0 | 1 | 2 | 3;
}

/**
 * A straight line, in square-kufi always axis-aligned (same column or row).
 * Circular: a straight chord between the midpoints of two slices.
 */
export interface LineItem {
  t: "line";
  k: string;
  i1: number;
  j1: number;
  i2: number;
  j2: number;
  c?: string;
}

/**
 * A quarter-arc connector (قنطرة) between two anchors on the same row
 * (square) or between two circular slices (circular, drawn as an
 * annular sector). `d` picks the bulge direction: 0 = up (علوية), 1 = down (سفلية).
 */
export interface ArchItem {
  t: "arch";
  k: string;
  i1: number;
  j1: number;
  i2: number;
  j2: number;
  d: 0 | 1;
  c?: string;
}

export type CanvasItem = TileItem | LineItem | ArchItem;

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
  /** Auto-merge straight pen strokes into line items. */
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

export function tileKey(i: number, j: number, q: ZoneQuadrant): string {
  return `${i}:${j}:${q}`;
}

export function lineKey(
  i1: number,
  j1: number,
  i2: number,
  j2: number,
): string {
  return `L${i1}:${j1}|${i2}:${j2}`;
}

export function archKey(
  i1: number,
  j1: number,
  i2: number,
  j2: number,
  d: 0 | 1,
): string {
  return `A${i1}:${j1}|${i2}:${j2}|${d}`;
}

/* ------------------------------------------------------------------ */
/* Convex validators                                                   */
/* ------------------------------------------------------------------ */

export const gridTypeValidator = v.union(
  v.literal("square"),
  v.literal("circular"),
);

export const tileShapeValidator = v.union(
  v.literal("square"),
  v.literal("circle"),
  v.literal("triangle"),
  v.literal("quadrant"),
  v.literal("semicircle"),
  v.literal("hexagon"),
  v.literal("arc"),
  v.literal("hamza1"),
  v.literal("hamza2"),
);

export const zoneQuadrantValidator = v.union(
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

export const canvasItemValidator = v.union(
  v.object({
    t: v.literal("tile"),
    k: v.string(),
    i: v.number(),
    j: v.number(),
    q: zoneQuadrantValidator,
    s: v.optional(tileShapeValidator),
    c: v.optional(v.string()),
    r: v.optional(rotationValidator),
  }),
  v.object({
    t: v.literal("line"),
    k: v.string(),
    i1: v.number(),
    j1: v.number(),
    i2: v.number(),
    j2: v.number(),
    c: v.optional(v.string()),
  }),
  v.object({
    t: v.literal("arch"),
    k: v.string(),
    i1: v.number(),
    j1: v.number(),
    i2: v.number(),
    j2: v.number(),
    d: v.union(v.literal(0), v.literal(1)),
    c: v.optional(v.string()),
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
