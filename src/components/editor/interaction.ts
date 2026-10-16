/**
 * KufiCraft — editor interaction logic (pure, no React, no DOM).
 *
 * Everything the editor does between a pointer event and a backend batch
 * lives here so it can be unit-tested without a browser:
 *
 *   • viewport → viewBox mapping (`clientToViewBox`) including CSS scaling
 *     and RTL — the SVG is fitted with `preserveAspectRatio="xMidYMid meet"`,
 *     so the mapping is a uniform scale plus a centred letterbox offset;
 *   • the gesture reducer (`startGesture` / `updateGesture` / `finishGesture`)
 *     turning pointer positions into canvas items;
 *   • hit testing (`hitTest`), marquee selection and the selection operations
 *     (move, recolour, reshape, duplicate, delete).
 *
 * The module never mutates its inputs: item lists are rebuilt with the
 * engine's `ops.ts` helpers, which keep untouched item objects identical so
 * React can skip re-rendering them.
 */

import {
  CIRCULAR_ANGULAR_UNIT,
  CIRCULAR_SECTORS,
  VIEWBOX_SIZE,
  archKey,
  lineKey,
  tileKey,
} from "@/lib/canvas/model";
import type {
  ArchItem,
  CanvasItem,
  LineItem,
  ProjectConfig,
  TileItem,
  TileShape,
  ZoneQuadrant,
} from "@/lib/canvas/model";
import { cellCenter, pointToAnchor, pointToCell } from "@/lib/canvas/grid";
import type { Anchor, Cell } from "@/lib/canvas/grid";
import { addItems, removeItems, strokeToItems } from "@/lib/canvas/ops";
import type { Point, Rect } from "@/lib/canvas/geometry";

/* ------------------------------------------------------------------ */
/* Tools, shapes, copy                                                 */
/* ------------------------------------------------------------------ */

export type Tool = "select" | "pen" | "eraser" | "arch";

/** Rail order (RTL: first = closest to the canvas edge). */
export const TOOL_ORDER: readonly Tool[] = ["select", "pen", "eraser", "arch"];

export const TOOL_LABELS: Record<Tool, string> = {
  select: "تحديد",
  pen: "قلم",
  eraser: "ممحاة",
  arch: "قوس",
};

export const TOOL_SHORTCUTS: Record<Tool, string> = {
  select: "V",
  pen: "P",
  eraser: "E",
  arch: "A",
};

/** Shape palette order; digits `1…9` pick by index (see `shortcuts.ts`). */
export const SHAPE_ORDER: readonly TileShape[] = [
  "square",
  "circle",
  "triangle",
  "quadrant",
  "semicircle",
  "hexagon",
  "arc",
  "hamza1",
  "hamza2",
];

export const SHAPE_LABELS: Record<TileShape, string> = {
  square: "مربع",
  circle: "دائرة",
  triangle: "مثلث",
  quadrant: "ربع دائرة",
  semicircle: "نصف دائرة",
  hexagon: "مسدس",
  arc: "شريحة قوس",
  hamza1: "همزة ١",
  hamza2: "همزة ٢",
};

/** Rotation helper: next quarter turn, `0 → 1 → 2 → 3 → 0`. */
export function nextRotation(rotation: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
  return (((rotation + 1) % 4) + 4) % 4 as 0 | 1 | 2 | 3;
}

/** Style of the items drawn next (also applied to a selection on demand). */
export interface DrawStyle {
  shape: TileShape;
  rotation: 0 | 1 | 2 | 3;
  /** `undefined` → the project ink colour. */
  color: string | undefined;
}

export const DEFAULT_STYLE: DrawStyle = {
  shape: "square",
  rotation: 0,
  color: undefined,
};

/* ------------------------------------------------------------------ */
/* Viewport mapping                                                    */
/* ------------------------------------------------------------------ */

/** The subset of `DOMRect` the mapping needs (keeps this module DOM-free). */
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Maps a client-space pointer position to viewBox units.
 *
 * `preserveAspectRatio="xMidYMid meet"` fits the 1000-unit square with a
 * single uniform scale (`min(width, height) / 1000`) inside the element's
 * box and centres it, so both letterboxing and CSS scaling (the zoom
 * control) are handled by measuring the live rect.
 * SVG coordinates are never mirrored by `dir="rtl"`, so the mapping is the
 * same in both directions.
 */
export function clientToViewBox(
  rect: ClientRect,
  clientX: number,
  clientY: number,
): Point {
  const scale = Math.min(rect.width, rect.height) / VIEWBOX_SIZE;
  if (!(scale > 0)) return { x: 0, y: 0 };
  const offsetX = (rect.width - VIEWBOX_SIZE * scale) / 2;
  const offsetY = (rect.height - VIEWBOX_SIZE * scale) / 2;
  return {
    x: (clientX - rect.left - offsetX) / scale,
    y: (clientY - rect.top - offsetY) / scale,
  };
}

/** Clips a pointer position to the canvas (never outside the viewBox). */
export function clampToCanvas(point: Point): Point {
  const max = VIEWBOX_SIZE - 1e-6;
  return {
    x: Math.min(Math.max(point.x, 0), max),
    y: Math.min(Math.max(point.y, 0), max),
  };
}

/** Index limits of the grid: `maxI`/`maxJ` are inclusive. */
export function cellLimits(config: ProjectConfig): {
  maxI: number;
  maxJ: number;
} {
  if (config.gridType === "circular") {
    return {
      maxI: Math.max(0, Math.ceil(VIEWBOX_SIZE / 2 / config.base) - 1),
      maxJ: CIRCULAR_SECTORS - 1,
    };
  }
  const count = Math.max(0, Math.ceil(VIEWBOX_SIZE / config.base) - 1);
  return { maxI: count, maxJ: count };
}

/** Anchor under a pointer position (clipped to the canvas first). */
export function anchorAt(config: ProjectConfig, point: Point): Anchor {
  return pointToAnchor(config, clampToCanvas(point));
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.i === b.i && a.j === b.j;
}

function wrapSector(j: number): number {
  return ((j % CIRCULAR_SECTORS) + CIRCULAR_SECTORS) % CIRCULAR_SECTORS;
}

/**
 * Cells swept between two anchors (integer Bresenham), endpoints included,
 * all carrying `to.q`. Fills the gaps a fast drag leaves behind so a stroke
 * stays continuous.
 */
export function anchorsBetween(from: Anchor, to: Anchor): Anchor[] {
  const cells: Cell[] = [];
  let x = from.i;
  let y = from.j;
  const dx = Math.abs(to.i - from.i);
  const dy = Math.abs(to.j - from.j);
  const sx = x < to.i ? 1 : -1;
  const sy = y < to.j ? 1 : -1;
  let error = dx - dy;
  for (let step = 0; step <= dx + dy + 1; step++) {
    cells.push({ i: x, j: y });
    if (x === to.i && y === to.j) break;
    const doubled = error * 2;
    if (doubled > -dy) {
      error -= dy;
      x += sx;
    }
    if (doubled < dx) {
      error += dx;
      y += sy;
    }
  }
  return cells.map((cell) => ({ i: cell.i, j: cell.j, q: to.q }));
}

/* ------------------------------------------------------------------ */
/* Hit testing                                                         */
/* ------------------------------------------------------------------ */

function angleWithin(angle: number, a1: number, a2: number): boolean {
  const twoPi = 2 * Math.PI;
  const norm = (value: number) => ((value % twoPi) + twoPi) % twoPi;
  const span = a2 - a1;
  if (span >= twoPi - 1e-9 || span <= -twoPi + 1e-9) return true;
  const start = norm(a1);
  const end = norm(a2);
  const target = norm(angle);
  return span > 0
    ? target >= start && target <= end
    : target >= start || target <= end;
}

interface Slice {
  cx: number;
  cy: number;
  r1: number;
  r2: number;
  a1: number;
  a2: number;
}

function pointInSlice(slice: Slice, point: Point): boolean {
  const dx = point.x - slice.cx;
  const dy = point.y - slice.cy;
  const radius = Math.hypot(dx, dy);
  if (radius < slice.r1 - 1e-9 || radius > slice.r2 + 1e-9) return false;
  return angleWithin(Math.atan2(dy, dx), slice.a1, slice.a2);
}

/** Zone rect of a square-grid tile — mirrors the engine's `zoneRect`. */
function squareTileRect(config: ProjectConfig, tile: TileItem): Rect {
  const { base, ratio } = config;
  const ink = ratio * base;
  const space = base - ink;
  return {
    x: tile.i * base + (tile.q & 1 ? ink : 0),
    y: tile.j * base + (tile.q & 2 ? ink : 0),
    w: tile.q & 1 ? space : ink,
    h: tile.q & 2 ? space : ink,
  };
}

/** Bounding box of an annular sector (extremes sit on its ends or cardinals). */
function sliceBounds(slice: Slice): Rect {
  const angles = [slice.a1, slice.a2];
  for (const cardinal of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    if (angleWithin(cardinal, slice.a1, slice.a2)) angles.push(cardinal);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const radius of [slice.r1, slice.r2]) {
    for (const angle of angles) {
      const x = slice.cx + radius * Math.cos(angle);
      const y = slice.cy + radius * Math.sin(angle);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function tileSlice(config: ProjectConfig, tile: TileItem): Slice {
  const { base, ratio } = config;
  const ink = ratio * base;
  const angular = CIRCULAR_ANGULAR_UNIT;
  const r1 = tile.i * base + (tile.q & 1 ? ink : 0);
  const a1 = tile.j * angular + (tile.q & 2 ? ratio * angular : 0);
  return {
    cx: VIEWBOX_SIZE / 2,
    cy: VIEWBOX_SIZE / 2,
    r1,
    r2: r1 + (tile.q & 1 ? base - ink : ink),
    a1,
    a2: a1 + (tile.q & 2 ? (1 - ratio) * angular : ratio * angular),
  };
}

function lineRect(config: ProjectConfig, line: LineItem): Rect {
  const base = config.base;
  const i1 = Math.min(line.i1, line.i2);
  const i2 = Math.max(line.i1, line.i2);
  const j1 = Math.min(line.j1, line.j2);
  const j2 = Math.max(line.j1, line.j2);
  return {
    x: i1 * base,
    y: j1 * base,
    w: (i2 - i1 + 1) * base,
    h: (j2 - j1 + 1) * base,
  };
}

function lineSlice(config: ProjectConfig, line: LineItem): Slice {
  const base = config.base;
  const angular = CIRCULAR_ANGULAR_UNIT;
  const i1 = Math.min(line.i1, line.i2);
  const i2 = Math.max(line.i1, line.i2);
  const a1 = line.j1 * angular;
  const delta =
    (((line.j2 - line.j1) % CIRCULAR_SECTORS) + CIRCULAR_SECTORS) %
    CIRCULAR_SECTORS;
  const span = delta > CIRCULAR_SECTORS / 2 ? delta - CIRCULAR_SECTORS : delta;
  const covered = span >= 0 ? span + 1 : span - 1;
  return {
    cx: VIEWBOX_SIZE / 2,
    cy: VIEWBOX_SIZE / 2,
    r1: i1 * base,
    r2: (i2 + 1) * base,
    a1,
    a2: a1 + covered * angular,
  };
}

/** Shortest signed sector delta — mirrors the engine's arch geometry. */
function sectorDelta(j1: number, j2: number): number {
  const delta = (((j2 - j1) % CIRCULAR_SECTORS) + CIRCULAR_SECTORS) % CIRCULAR_SECTORS;
  return delta > CIRCULAR_SECTORS / 2 ? delta - CIRCULAR_SECTORS : delta;
}

/** Bulge direction of a square-grid arch — mirrors the engine's rule. */
function archBulge(p1: Point, p2: Point, d: 0 | 1): Point {
  if (p1.y === p2.y) return { x: 0, y: d === 0 ? -1 : 1 };
  if (p1.x === p2.x) return { x: d === 0 ? -1 : 1, y: 0 };
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy) || 1;
  return d === 0
    ? { x: dy / length, y: -dx / length }
    : { x: -dy / length, y: dx / length };
}

const ARCH_SAMPLES = 12;

/** Rib centre-line of an arch, sampled — used for hit testing only. */
function archSamples(config: ProjectConfig, arch: ArchItem): Point[] {
  const samples: Point[] = [];
  if (config.gridType === "circular") {
    const radius = ((arch.i1 + arch.i2) / 2 + 0.5) * config.base;
    const a1 = (arch.j1 + 0.5) * CIRCULAR_ANGULAR_UNIT;
    const sweep = sectorDelta(arch.j1, arch.j2) * CIRCULAR_ANGULAR_UNIT;
    for (let n = 0; n <= ARCH_SAMPLES; n++) {
      const angle = a1 + (sweep * n) / ARCH_SAMPLES;
      samples.push({
        x: VIEWBOX_SIZE / 2 + radius * Math.cos(angle),
        y: VIEWBOX_SIZE / 2 + radius * Math.sin(angle),
      });
    }
    return samples;
  }
  const p1 = cellCenter(config, arch.i1, arch.j1);
  const p2 = cellCenter(config, arch.i2, arch.j2);
  const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const radius = (chord + config.ratio * config.base) / 2;
  const sagitta =
    radius - Math.sqrt(Math.max(0, radius * radius - (chord / 2) ** 2));
  const bulge = archBulge(p1, p2, arch.d);
  const controlX = (p1.x + p2.x) / 2 + bulge.x * 2 * sagitta;
  const controlY = (p1.y + p2.y) / 2 + bulge.y * 2 * sagitta;
  for (let n = 0; n <= ARCH_SAMPLES; n++) {
    const t = n / ARCH_SAMPLES;
    const inverse = 1 - t;
    samples.push({
      x: inverse * inverse * p1.x + 2 * inverse * t * controlX + t * t * p2.x,
      y: inverse * inverse * p1.y + 2 * inverse * t * controlY + t * t * p2.y,
    });
  }
  return samples;
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.min(
    1,
    Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Whether a click at `point` lands on the drawn ink of `item`. */
export function hitsItem(
  config: ProjectConfig,
  item: CanvasItem,
  point: Point,
): boolean {
  switch (item.t) {
    case "tile": {
      if (config.gridType === "circular") {
        return pointInSlice(tileSlice(config, item), point);
      }
      const rect = squareTileRect(config, item);
      return (
        point.x >= rect.x &&
        point.x <= rect.x + rect.w &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.h
      );
    }
    case "line": {
      if (config.gridType === "circular") {
        return pointInSlice(lineSlice(config, item), point);
      }
      const rect = lineRect(config, item);
      return (
        point.x >= rect.x &&
        point.x <= rect.x + rect.w &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.h
      );
    }
    case "arch": {
      const samples = archSamples(config, item);
      const tolerance = (config.ratio * config.base) / 2 + config.base * 0.25;
      for (let n = 0; n < samples.length - 1; n++) {
        if (distanceToSegment(point, samples[n], samples[n + 1]) <= tolerance) {
          return true;
        }
      }
      return false;
    }
  }
}

/** Topmost item under `point` (last drawn wins), or `null`. */
export function hitTest(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  point: Point,
): CanvasItem | null {
  for (let index = items.length - 1; index >= 0; index--) {
    if (hitsItem(config, items[index], point)) return items[index];
  }
  return null;
}

/** Axis-aligned bounds of an item, used by the marquee and move clamping. */
export function itemBounds(config: ProjectConfig, item: CanvasItem): Rect {
  switch (item.t) {
    case "tile":
      return config.gridType === "circular"
        ? sliceBounds(tileSlice(config, item))
        : squareTileRect(config, item);
    case "line":
      return config.gridType === "circular"
        ? sliceBounds(lineSlice(config, item))
        : lineRect(config, item);
    case "arch": {
      const samples = archSamples(config, item);
      const pad = (config.ratio * config.base) / 2;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const sample of samples) {
        minX = Math.min(minX, sample.x);
        minY = Math.min(minY, sample.y);
        maxX = Math.max(maxX, sample.x);
        maxY = Math.max(maxY, sample.y);
      }
      return {
        x: minX - pad,
        y: minY - pad,
        w: maxX - minX + pad * 2,
        h: maxY - minY + pad * 2,
      };
    }
  }
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
  );
}

/** Keys of the items the marquee box touches. */
export function marqueeSelection(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  box: Rect,
): string[] {
  const keys: string[] = [];
  for (const item of items) {
    if (rectsIntersect(itemBounds(config, item), box)) keys.push(item.k);
  }
  return keys;
}

/* ------------------------------------------------------------------ */
/* Selection operations                                                */
/* ------------------------------------------------------------------ */

interface IndexRange {
  minI: number;
  maxI: number;
  minJ: number;
  maxJ: number;
}

/** Item/line/arch index extent of the listed keys. */
function indexRange(
  items: readonly CanvasItem[],
  keys: readonly string[],
): IndexRange | null {
  const wanted = new Set(keys);
  let range: IndexRange | null = null;
  for (const item of items) {
    if (!wanted.has(item.k)) continue;
    const i1 = item.t === "tile" ? item.i : Math.min(item.i1, item.i2);
    const i2 = item.t === "tile" ? item.i : Math.max(item.i1, item.i2);
    const j1 = item.t === "tile" ? item.j : Math.min(item.j1, item.j2);
    const j2 = item.t === "tile" ? item.j : Math.max(item.j1, item.j2);
    range = range
      ? {
          minI: Math.min(range.minI, i1),
          maxI: Math.max(range.maxI, i2),
          minJ: Math.min(range.minJ, j1),
          maxJ: Math.max(range.maxJ, j2),
        }
      : { minI: i1, maxI: i2, minJ: j1, maxJ: j2 };
  }
  return range;
}

/** Largest delta (in cells) that keeps every listed item inside the grid. */
export function clampDelta(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  keys: readonly string[],
  di: number,
  dj: number,
): { di: number; dj: number } {
  const range = indexRange(items, keys);
  if (!range) return { di: 0, dj: 0 };
  const limits = cellLimits(config);
  const clampedI = Math.min(
    Math.max(di, -range.minI),
    Math.max(0, limits.maxI - range.maxI),
  );
  if (config.gridType === "circular") return { di: clampedI, dj };
  const clampedJ = Math.min(
    Math.max(dj, -range.minJ),
    Math.max(0, limits.maxJ - range.maxJ),
  );
  return { di: clampedI, dj: clampedJ };
}

/** `item` shifted by whole cells; the key follows the anchors. */
function shifted(
  config: ProjectConfig,
  item: CanvasItem,
  di: number,
  dj: number,
): CanvasItem {
  // Sector indices wrap on the circular grid; keeping the raw sum would make
  // the same ring position produce two different keys.
  const shiftJ = (j: number) =>
    config.gridType === "circular" ? wrapSector(j + dj) : j + dj;
  switch (item.t) {
    case "tile": {
      const i = item.i + di;
      const j = shiftJ(item.j);
      return { ...item, i, j, k: tileKey(i, j, item.q) };
    }
    case "line": {
      const i1 = item.i1 + di;
      const j1 = shiftJ(item.j1);
      const i2 = item.i2 + di;
      const j2 = shiftJ(item.j2);
      return { ...item, i1, j1, i2, j2, k: lineKey(i1, j1, i2, j2) };
    }
    case "arch": {
      const i1 = item.i1 + di;
      const j1 = shiftJ(item.j1);
      const i2 = item.i2 + di;
      const j2 = shiftJ(item.j2);
      return { ...item, i1, j1, i2, j2, k: archKey(i1, j1, i2, j2, item.d) };
    }
  }
}

/** The listed items moved by `(di, dj)`, in their original order. */
export function shiftSelection(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  keys: readonly string[],
  di: number,
  dj: number,
): CanvasItem[] {
  const wanted = new Set(keys);
  const moved: CanvasItem[] = [];
  for (const item of items) {
    if (wanted.has(item.k)) moved.push(shifted(config, item, di, dj));
  }
  return moved;
}

/**
 * Moves the listed items by `(di, dj)` cells (clamped to the grid). Shape,
 * rotation and colour are preserved; keys are re-derived from the anchors.
 * Moved items keep their relative order and land on top.
 */
export function moveItems(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  keys: readonly string[],
  di: number,
  dj: number,
): CanvasItem[] {
  const delta = clampDelta(config, items, keys, di, dj);
  if (delta.di === 0 && delta.dj === 0) return [...items];
  const wanted = new Set(keys);
  const rest: CanvasItem[] = [];
  const moved: CanvasItem[] = [];
  for (const item of items) {
    if (wanted.has(item.k)) moved.push(shifted(config, item, delta.di, delta.dj));
    else rest.push(item);
  }
  return [...rest, ...moved];
}

/** Applies a colour override (`undefined` → back to the project ink). */
export function recolourItems(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  keys: readonly string[],
  color: string | undefined,
): CanvasItem[] {
  const wanted = new Set(keys);
  const override =
    color !== undefined && color !== config.ink ? color : undefined;
  return items.map((item) => {
    if (!wanted.has(item.k)) return item;
    if (override === undefined) {
      if (item.c === undefined) return item;
      const next = { ...item };
      delete next.c;
      return next;
    }
    if (item.c === override) return item;
    return { ...item, c: override };
  });
}

/** Applies shape / rotation to the listed tiles (other items are ignored). */
export function reshapeItems(
  items: readonly CanvasItem[],
  keys: readonly string[],
  patch: { shape?: TileShape; rotation?: 0 | 1 | 2 | 3 },
): CanvasItem[] {
  const wanted = new Set(keys);
  return items.map((item) => {
    if (item.t !== "tile" || !wanted.has(item.k)) return item;
    const next: TileItem = { ...item };
    if (patch.shape !== undefined) {
      if (patch.shape === "square") delete next.s;
      else next.s = patch.shape;
    }
    if (patch.rotation !== undefined) {
      if (patch.rotation === 0) delete next.r;
      else next.r = patch.rotation;
    }
    return next;
  });
}

/**
 * Copies the listed items one cell along both axes. Copies whose key is
 * already taken are dropped; the returned keys address the new items.
 */
export function duplicateItems(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  keys: readonly string[],
  steps = 1,
): { items: CanvasItem[]; keys: string[] } {
  const delta = clampDelta(config, items, keys, steps, steps);
  if (delta.di === 0 && delta.dj === 0) return { items: [...items], keys: [] };
  const taken = new Set(items.map((item) => item.k));
  const copies: CanvasItem[] = [];
  const newKeys: string[] = [];
  for (const item of shiftSelection(config, items, keys, delta.di, delta.dj)) {
    if (taken.has(item.k)) continue;
    taken.add(item.k);
    copies.push(item);
    newKeys.push(item.k);
  }
  return { items: [...items, ...copies], keys: newKeys };
}

/** Removes the listed keys (thin wrapper over the engine's op). */
export function deleteItems(
  items: readonly CanvasItem[],
  keys: readonly string[],
): CanvasItem[] {
  return [...removeItems({ items }, keys).items];
}

/* ------------------------------------------------------------------ */
/* Gestures                                                            */
/* ------------------------------------------------------------------ */

export interface GestureNone {
  kind: "none";
}

export interface GesturePen {
  kind: "pen";
  anchors: Anchor[];
}

export interface GestureErase {
  kind: "erase";
  keys: string[];
}

export interface GestureArch {
  kind: "arch";
  from: Anchor;
  to: Anchor;
}

export interface GestureMarquee {
  kind: "marquee";
  from: Point;
  to: Point;
  base: readonly string[];
}

export interface GestureMove {
  kind: "move";
  from: Cell;
  to: Cell;
  keys: readonly string[];
}

export type Gesture =
  | GestureNone
  | GesturePen
  | GestureErase
  | GestureArch
  | GestureMarquee
  | GestureMove;

export const IDLE_GESTURE: GestureNone = { kind: "none" };

export interface GestureContext {
  config: ProjectConfig;
  items: readonly CanvasItem[];
  selection: readonly string[];
  tool: Tool;
  style: DrawStyle;
  /** Bulge of the next arch: `0` up / left, `1` down / right. */
  bulge: 0 | 1;
}

export interface GestureStart {
  gesture: Gesture;
  /** Next selection, when the pointer-down changed it. */
  selection?: readonly string[];
}

export interface GestureCommit {
  items: readonly CanvasItem[];
  selection: readonly string[];
  /** Arabic label recorded in the undo stack. */
  label: string;
}

export interface GestureFinish {
  commit: GestureCommit | null;
  /** Selection change without an item change (select tool). */
  selection?: readonly string[];
}

/** Pen stroke → items (one merged line when straight and `mergeLines`). */
export function strokeItems(
  ctx: GestureContext,
  anchors: readonly Anchor[],
): CanvasItem[] {
  return strokeToItems(ctx.config, anchors, {
    shape: ctx.style.shape,
    rotation: ctx.style.rotation,
    color: ctx.style.color,
    mergeLines: ctx.config.mergeLines,
  });
}

/** Arch between two anchors on the same row / column, or `null`. */
export function archBetween(
  ctx: GestureContext,
  from: Anchor,
  to: Anchor,
): ArchItem | null {
  if (from.i !== to.i && from.j !== to.j) return null;
  if (sameCell(from, to)) return null;
  return {
    t: "arch",
    k: archKey(from.i, from.j, to.i, to.j, ctx.bulge),
    i1: from.i,
    j1: from.j,
    i2: to.i,
    j2: to.j,
    d: ctx.bulge,
  };
}

/** Projects a pointer cell onto the row / column of the arch's first anchor. */
export function snapArchAnchor(
  config: ProjectConfig,
  from: Anchor,
  point: Point,
): Anchor {
  const cell = pointToCell(config, clampToCanvas(point));
  const onSameRow = Math.abs(cell.i - from.i) >= Math.abs(cell.j - from.j);
  return {
    i: onSameRow ? cell.i : from.i,
    j: onSameRow ? from.j : cell.j,
    q: from.q,
  };
}

export function startGesture(
  ctx: GestureContext,
  point: Point,
  modifiers: { shift: boolean },
): GestureStart {
  const canvasPoint = clampToCanvas(point);
  switch (ctx.tool) {
    case "pen": {
      return { gesture: { kind: "pen", anchors: [anchorAt(ctx.config, canvasPoint)] } };
    }
    case "eraser": {
      const hit = hitTest(ctx.config, ctx.items, canvasPoint);
      return { gesture: { kind: "erase", keys: hit ? [hit.k] : [] } };
    }
    case "arch": {
      const anchor = anchorAt(ctx.config, canvasPoint);
      return { gesture: { kind: "arch", from: anchor, to: anchor } };
    }
    case "select": {
      const hit = hitTest(ctx.config, ctx.items, canvasPoint);
      if (hit) {
        const already = ctx.selection.includes(hit.k);
        let selection: readonly string[];
        if (modifiers.shift) {
          selection = already
            ? ctx.selection.filter((key) => key !== hit.k)
            : [...ctx.selection, hit.k];
        } else {
          selection = already ? ctx.selection : [hit.k];
        }
        const cell = pointToCell(ctx.config, canvasPoint);
        return {
          gesture: { kind: "move", from: cell, to: cell, keys: selection },
          selection,
        };
      }
      return {
        gesture: {
          kind: "marquee",
          from: canvasPoint,
          to: canvasPoint,
          base: modifiers.shift ? ctx.selection : [],
        },
        selection: modifiers.shift ? undefined : [],
      };
    }
  }
}

export function updateGesture(
  ctx: GestureContext,
  gesture: Gesture,
  point: Point,
): Gesture {
  const canvasPoint = clampToCanvas(point);
  switch (gesture.kind) {
    case "pen": {
      const anchor = anchorAt(ctx.config, canvasPoint);
      const last = gesture.anchors[gesture.anchors.length - 1];
      if (sameCell(last, anchor) && last.q === anchor.q) return gesture;
      const swept = anchorsBetween(gesture.anchors[0], anchor).slice(1);
      return { kind: "pen", anchors: [...gesture.anchors, ...swept] };
    }
    case "erase": {
      const hit = hitTest(ctx.config, ctx.items, canvasPoint);
      if (!hit || gesture.keys.includes(hit.k)) return gesture;
      return { kind: "erase", keys: [...gesture.keys, hit.k] };
    }
    case "arch": {
      const anchor = snapArchAnchor(ctx.config, gesture.from, canvasPoint);
      if (sameCell(anchor, gesture.to)) return gesture;
      return { kind: "arch", from: gesture.from, to: anchor };
    }
    case "marquee": {
      const tiny =
        Math.abs(canvasPoint.x - gesture.to.x) < 0.5 &&
        Math.abs(canvasPoint.y - gesture.to.y) < 0.5;
      return tiny ? gesture : { ...gesture, to: canvasPoint };
    }
    case "move": {
      const cell = pointToCell(ctx.config, canvasPoint);
      return sameCell(cell, gesture.to) ? gesture : { ...gesture, to: cell };
    }
    case "none":
      return gesture;
  }
}

export function finishGesture(
  ctx: GestureContext,
  gesture: Gesture,
): GestureFinish {
  switch (gesture.kind) {
    case "none":
      return { commit: null };
    case "pen": {
      const next = addItems({ items: ctx.items }, strokeItems(ctx, gesture.anchors))
        .items;
      if (next === ctx.items) return { commit: null };
      return {
        commit: { items: [...next], selection: ctx.selection, label: "رسم" },
      };
    }
    case "erase": {
      if (gesture.keys.length === 0) return { commit: null };
      const next = removeItems({ items: ctx.items }, gesture.keys).items;
      if (next === ctx.items) return { commit: null };
      const doomed = new Set(gesture.keys);
      return {
        commit: {
          items: [...next],
          selection: ctx.selection.filter((key) => !doomed.has(key)),
          label: "مسح",
        },
      };
    }
    case "arch": {
      const arch = archBetween(ctx, gesture.from, gesture.to);
      if (!arch) return { commit: null };
      const next = addItems({ items: ctx.items }, [arch]).items;
      if (next === ctx.items) return { commit: null };
      return {
        commit: { items: [...next], selection: ctx.selection, label: "قوس" },
      };
    }
    case "marquee": {
      const keys = marqueeSelection(
        ctx.config,
        ctx.items,
        rectFromPoints(gesture.from, gesture.to),
      );
      const merged = new Set(gesture.base);
      for (const key of keys) merged.add(key);
      return { commit: null, selection: [...merged] };
    }
    case "move": {
      const delta = clampDelta(
        ctx.config,
        ctx.items,
        gesture.keys,
        gesture.to.i - gesture.from.i,
        gesture.to.j - gesture.from.j,
      );
      if (delta.di === 0 && delta.dj === 0) return { commit: null };
      return {
        commit: {
          items: moveItems(
            ctx.config,
            ctx.items,
            gesture.keys,
            delta.di,
            delta.dj,
          ),
          selection: gesture.keys,
          label: "تحريك",
        },
      };
    }
  }
}

/** Items drawn by the in-flight gesture (preview layer only). */
export function previewItems(
  ctx: GestureContext,
  gesture: Gesture,
): readonly CanvasItem[] {
  switch (gesture.kind) {
    case "pen":
      return strokeItems(ctx, gesture.anchors);
    case "arch": {
      const arch = archBetween(ctx, gesture.from, gesture.to);
      return arch ? [arch] : [];
    }
    case "move": {
      const delta = clampDelta(
        ctx.config,
        ctx.items,
        gesture.keys,
        gesture.to.i - gesture.from.i,
        gesture.to.j - gesture.from.j,
      );
      if (delta.di === 0 && delta.dj === 0) return [];
      return shiftSelection(ctx.config, ctx.items, gesture.keys, delta.di, delta.dj);
    }
    case "marquee": {
      const keys = new Set(
        marqueeSelection(
          ctx.config,
          ctx.items,
          rectFromPoints(gesture.from, gesture.to),
        ),
      );
      for (const key of gesture.base) keys.add(key);
      return ctx.items.filter((item) => keys.has(item.k));
    }
    default:
      return [];
  }
}

/** Keys the eraser has swept so far (preview layer only). */
export function previewKeys(gesture: Gesture): readonly string[] {
  return gesture.kind === "erase" ? gesture.keys : [];
}

/** Rect of the in-flight marquee box, or `null`. */
export function previewMarquee(gesture: Gesture): Rect | null {
  return gesture.kind === "marquee"
    ? rectFromPoints(gesture.from, gesture.to)
    : null;
}

/* ------------------------------------------------------------------ */
/* Value comparison helpers                                            */
/* ------------------------------------------------------------------ */

/** Stable projection of an item (change detection / server reconciliation). */
export function itemSignature(item: CanvasItem): string {
  switch (item.t) {
    case "tile":
      return [
        item.k,
        item.i,
        item.j,
        item.q,
        item.s ?? "square",
        item.c ?? "",
        item.r ?? 0,
      ].join("|");
    case "line":
      return [item.k, item.i1, item.j1, item.i2, item.j2, item.c ?? ""].join("|");
    case "arch":
      return [
        item.k,
        item.i1,
        item.j1,
        item.i2,
        item.j2,
        item.d,
        item.c ?? "",
      ].join("|");
  }
}

export function itemsEqual(
  a: readonly CanvasItem[],
  b: readonly CanvasItem[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] === b[index]) continue;
    if (itemSignature(a[index]) !== itemSignature(b[index])) return false;
  }
  return true;
}

export function configsEqual(a: ProjectConfig, b: ProjectConfig): boolean {
  return (
    a.gridType === b.gridType &&
    a.ratio === b.ratio &&
    a.base === b.base &&
    a.ink === b.ink &&
    a.background === b.background &&
    a.showGrid === b.showGrid &&
    a.mergeLines === b.mergeLines
  );
}

const PROJECT_ID_PATTERN = /^[a-z0-9]{12,64}$/;

/** Whether a URL segment can be a Convex document id (garbage → “not found”). */
export function isProjectId(value: string): boolean {
  return PROJECT_ID_PATTERN.test(value);
}

/** Re-exported for the editor UI (keeps imports in one place). */
export type { Anchor, CanvasItem, ProjectConfig, TileShape, ZoneQuadrant };
