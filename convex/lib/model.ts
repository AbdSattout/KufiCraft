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

/** Default ink fraction of each cell (0.75 = المتساوية القديمة 1/4 : 3/4). */
export const DEFAULT_RATIO = 0.75;

/** Allowed ratio range. 0.5 = متساوية (1/2 : 1/2). */
export const MIN_RATIO = 0.25;
export const MAX_RATIO = 0.75;

/** Angular divisions of the circular grid (10° sectors). */
export const CIRCULAR_SECTORS = 36;
export const CIRCULAR_ANGULAR_UNIT = (2 * Math.PI) / CIRCULAR_SECTORS;

/** Hard limits enforced by the backend. */
export const MAX_ITEMS = 20_000;
export const MAX_NAME_LENGTH = 120;
export const MAX_THUMBNAIL_LENGTH = 24_000;
/** Colours are stored as CSS strings (`oklch(…)`, `#rrggbb`, `transparent`); anything longer is truncated. */
export const MAX_COLOR_LENGTH = 32;

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
  /** Ink fraction per cell, MIN_RATIO..MAX_RATIO. */
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
