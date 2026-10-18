/**
 * KufiCraft — the geometry kernel (pure, no DOM).
 *
 * Everything works in the fixed `0 0 1000 1000` viewBox of the canvas: the
 * contract lives in `docs/CANVAS.md`. This module owns only the *plumbing* —
 * points, rects, path commands, frames (rotation + translation) and the polar
 * helpers of the circular grid. What gets drawn from that plumbing lives in
 * `shapes.ts` (the pen's ten shapes) and `items.ts` (the four item classes),
 * so the same path code serves the canvas, the toolbar icons and the grid.
 *
 * Zone rule: every cell / slice is split per axis at `config.ratio`; the ink
 * part is at the **start** of the cell (top-left on a square grid, inner radius
 * / lower angle on a circular one) — exactly the old app's `rectFromPoint`.
 */

import {
  CIRCULAR_ANGULAR_UNIT,
  CIRCULAR_SECTORS,
  VIEWBOX_SIZE,
  cellSize,
} from "./model";
import type { ProjectConfig, Zone } from "./model";

/* ------------------------------------------------------------------ */
/* Public geometry types                                               */
/* ------------------------------------------------------------------ */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Annular sector of the circular grid (band · sector · zone). */
export interface CircularSlice {
  cx: number;
  cy: number;
  /** Inner radius. */
  r1: number;
  /** Outer radius. */
  r2: number;
  /** Start angle (radians, `atan2` convention, y downwards). */
  a1: number;
  /** End angle; may be less than `a1` (clockwise) but never wraps. */
  a2: number;
}

export const CENTER = VIEWBOX_SIZE / 2;

/* ------------------------------------------------------------------ */
/* Path command plumbing                                               */
/* ------------------------------------------------------------------ */

export type PathCmd =
  | { c: "M"; x: number; y: number }
  | { c: "L"; x: number; y: number }
  | {
      c: "C";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x: number;
      y: number;
    }
  | {
      c: "A";
      rx: number;
      ry: number;
      rot: number;
      large: 0 | 1;
      sweep: 0 | 1;
      x: number;
      y: number;
    }
  | { c: "Z" };

export const M = (x: number, y: number): PathCmd => ({ c: "M", x, y });
export const L = (x: number, y: number): PathCmd => ({ c: "L", x, y });
/** Cubic Bézier — the command corner rounding emits (`rounding.ts`). */
export const C = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number,
  y: number,
): PathCmd => ({ c: "C", x1, y1, x2, y2, x, y });
export const A = (
  rx: number,
  ry: number,
  large: 0 | 1,
  sweep: 0 | 1,
  x: number,
  y: number,
): PathCmd => ({ c: "A", rx, ry, rot: 0, large, sweep, x, y });
export const Z: PathCmd = { c: "Z" };

/**
 * A frame is a rotation + translation: `(u, v) -> o + R(cos, sin)·(u, v)`.
 * Shapes are authored in a local `0…w × 0…h` box and mapped through one.
 */
export interface Frame {
  ox: number;
  oy: number;
  cos: number;
  sin: number;
}

/** Identity frame positioned at `(x, y)`. */
export function baseFrame(x: number, y: number): Frame {
  return { ox: x, oy: y, cos: 1, sin: 0 };
}

/** Rounds away float noise; full precision at viewBox scale otherwise. */
function fmt(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function cmdsToPath(cmds: readonly PathCmd[]): string {
  let d = "";
  for (let n = 0; n < cmds.length; n++) {
    const cmd = cmds[n];
    const lead = n === 0 ? "" : " ";
    switch (cmd.c) {
      case "M":
      case "L":
        d += `${lead}${cmd.c} ${fmt(cmd.x)} ${fmt(cmd.y)}`;
        break;
      case "C":
        d +=
          `${lead}C ${fmt(cmd.x1)} ${fmt(cmd.y1)} ${fmt(cmd.x2)} ${fmt(cmd.y2)}` +
          ` ${fmt(cmd.x)} ${fmt(cmd.y)}`;
        break;
      case "A":
        d +=
          `${lead}A ${fmt(cmd.rx)} ${fmt(cmd.ry)} ${fmt(cmd.rot)}` +
          ` ${cmd.large} ${cmd.sweep} ${fmt(cmd.x)} ${fmt(cmd.y)}`;
        break;
      case "Z":
        d += `${lead}Z`;
        break;
    }
  }
  return d;
}

/** Axis-aligned rectangle path. */
export function rectPath(rect: Rect): string {
  const { x, y, w, h } = rect;
  return cmdsToPath([M(x, y), L(x + w, y), L(x + w, y + h), L(x, y + h), Z]);
}

/** `shape ∘ frame` — both parts are rotation + translation frames. */
export function composeFrames(inner: Frame, outer: Frame): Frame {
  return {
    cos: outer.cos * inner.cos - outer.sin * inner.sin,
    sin: outer.sin * inner.cos + outer.cos * inner.sin,
    ox: outer.ox + (inner.ox * outer.cos - inner.oy * outer.sin),
    oy: outer.oy + (inner.ox * outer.sin + inner.oy * outer.cos),
  };
}

/** Rotation of `turns` quarter turns (clockwise on screen) around `(cx, cy)`. */
export function quarterTurnFrame(cx: number, cy: number, turns: number): Frame {
  const angle = (turns * Math.PI) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    cos,
    sin,
    ox: cx - (cx * cos - cy * sin),
    oy: cy - (cx * sin + cy * cos),
  };
}

/**
 * Maps authored commands through `frame`; every arc's x-axis-rotation is
 * shifted by `rotDeg` so elliptical arcs follow the same rotation.
 */
export function mapCommands(
  cmds: readonly PathCmd[],
  frame: Frame,
  rotDeg: number,
): PathCmd[] {
  const map = (x: number, y: number): Point => ({
    x: frame.ox + (x * frame.cos - y * frame.sin),
    y: frame.oy + (x * frame.sin + y * frame.cos),
  });
  const out: PathCmd[] = [];
  for (const cmd of cmds) {
    if (cmd.c === "Z") {
      out.push(cmd);
      continue;
    }
    const end = map(cmd.x, cmd.y);
    if (cmd.c === "A") {
      out.push({
        c: "A",
        rx: cmd.rx,
        ry: cmd.ry,
        rot: ((((cmd.rot + rotDeg) % 180) + 180) % 180),
        large: cmd.large,
        sweep: cmd.sweep,
        x: end.x,
        y: end.y,
      });
    } else if (cmd.c === "C") {
      // Both control points are points of the same frame (no rotation is
      // involved, so a Bézier stays a Bézier with mapped controls).
      const first = map(cmd.x1, cmd.y1);
      const second = map(cmd.x2, cmd.y2);
      out.push({
        c: "C",
        x1: first.x,
        y1: first.y,
        x2: second.x,
        y2: second.y,
        x: end.x,
        y: end.y,
      });
    } else {
      out.push({ c: cmd.c, x: end.x, y: end.y });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Zones                                                               */
/* ------------------------------------------------------------------ */

/** Ink thickness of one cell — the old app's `0.75` at the default ratio. */
export function inkUnit(config: ProjectConfig): number {
  return config.ratio * cellSize(config);
}

/**
 * Zone rect of a square-grid fragment: the intersection of the two chosen
 * zones inside cell `(column, row)`. A circular grid has no rect fragment —
 * use `circularSlice` for the annular sector instead.
 */
export function zoneRect(
  config: ProjectConfig,
  column: number,
  row: number,
  zone: Zone,
): Rect {
  const base = cellSize(config);
  const ink = inkUnit(config);
  const space = base - ink;
  return {
    x: column * base + (zone & 1 ? ink : 0),
    y: row * base + (zone & 2 ? ink : 0),
    w: zone & 1 ? space : ink,
    h: zone & 2 ? space : ink,
  };
}

/** The whole cell of `(column, row)`. */
export function cellRect(
  config: ProjectConfig,
  column: number,
  row: number,
): Rect {
  const base = cellSize(config);
  return {
    x: column * base,
    y: row * base,
    w: base,
    h: base,
  };
}

/** Annular sector of a circular-grid fragment: band, sector, zone. */
export function circularSlice(
  config: ProjectConfig,
  band: number,
  sector: number,
  zone: Zone,
): CircularSlice {
  const base = cellSize(config);
  const ink = inkUnit(config);
  const unit = CIRCULAR_ANGULAR_UNIT;
  const r1 = band * base + (zone & 1 ? ink : 0);
  const a1 = sector * unit + (zone & 2 ? config.ratio * unit : 0);
  return {
    cx: CENTER,
    cy: CENTER,
    r1,
    r2: r1 + (zone & 1 ? base - ink : ink),
    a1,
    a2: a1 + (zone & 2 ? (1 - config.ratio) * unit : config.ratio * unit),
  };
}

export function polar(cx: number, cy: number, r: number, a: number): Point {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

/**
 * Annular sector between two radii and two angles. Angles may run backwards
 * (`a2 < a1`) or all the way around (|Δ| ≥ 2π → full ring).
 */
export function sectorPath(
  cx: number,
  cy: number,
  r1: number,
  r2: number,
  a1: number,
  a2: number,
): string {
  const delta = a2 - a1;
  if (Math.abs(delta) >= 2 * Math.PI - 1e-9) {
    // Full ring: an arc from a vertex back to itself would collapse, so the
    // outer and inner circles are split into two half arcs each.
    const corners = [
      M(cx + r2, cy),
      A(r2, r2, 0, 1, cx - r2, cy),
      A(r2, r2, 0, 1, cx + r2, cy),
      L(cx + r1, cy),
      A(r1, r1, 0, 0, cx - r1, cy),
      A(r1, r1, 0, 0, cx + r1, cy),
      Z,
    ];
    return cmdsToPath(corners);
  }
  const sweep: 0 | 1 = delta >= 0 ? 1 : 0;
  const large: 0 | 1 = Math.abs(delta) > Math.PI ? 1 : 0;
  const o1 = polar(cx, cy, r2, a1);
  const o2 = polar(cx, cy, r2, a2);
  const i2 = polar(cx, cy, r1, a2);
  const i1 = polar(cx, cy, r1, a1);
  return cmdsToPath([
    M(o1.x, o1.y),
    A(r2, r2, large, sweep, o2.x, o2.y),
    L(i2.x, i2.y),
    A(r1, r1, large, sweep === 1 ? 0 : 1, i1.x, i1.y),
    Z,
  ]);
}

export function slicePath(slice: CircularSlice): string {
  return sectorPath(slice.cx, slice.cy, slice.r1, slice.r2, slice.a1, slice.a2);
}

/** Centre point of a circular slice (mid radius, mid angle). */
export function sliceCentre(slice: CircularSlice): Point {
  return polar(
    slice.cx,
    slice.cy,
    (slice.r1 + slice.r2) / 2,
    (slice.a1 + slice.a2) / 2,
  );
}

/* ------------------------------------------------------------------ */
/* Angles                                                              */
/* ------------------------------------------------------------------ */

/** Signed number of sectors from `j1` to `j2` along the shortest path. */
export function shortestSectorDelta(j1: number, j2: number): number {
  let delta =
    (((j2 - j1) % CIRCULAR_SECTORS) + CIRCULAR_SECTORS) % CIRCULAR_SECTORS;
  if (delta > CIRCULAR_SECTORS / 2) delta -= CIRCULAR_SECTORS;
  return delta;
}

/** Number of sectors covered by the run `j1 → j2` along the shortest path. */
export function sectorSpan(j1: number, j2: number): number {
  const delta = shortestSectorDelta(j1, j2);
  return delta >= 0 ? delta + 1 : delta - 1;
}

/* ------------------------------------------------------------------ */
/* Circular arcs                                                       */
/* ------------------------------------------------------------------ */

export interface ArcCentre {
  cx: number;
  cy: number;
  /** Effective radius (grows to `chord/2` when the input radius is too small). */
  r: number;
  /** Start angle (radians, `atan2` convention). */
  start: number;
  /** Signed swept angle; sign follows the sweep flag. */
  delta: number;
}

/**
 * SVG endpoint parameterisation for a **circular** arc → centre form, the
 * conversion the spec describes in appendix B.2 (with `rx = ry = r`). Used by
 * the arc item's hit test; rendering hands the flags straight to `A`.
 */
export function arcCentre(
  p1: Point,
  p2: Point,
  r: number,
  large: 0 | 1,
  sweep: 0 | 1,
): ArcCentre {
  const dx = (p2.x - p1.x) / 2;
  const dy = (p2.y - p1.y) / 2;
  const half = Math.hypot(dx, dy);
  const radius = half === 0 ? Math.max(r, 0) : Math.max(r, half);
  const k = Math.max(0, radius * radius - half * half);
  const d = Math.sqrt(k);
  // The centre sits on the perpendicular bisector; the sign flips with
  // `large === sweep` (SVG spec, "out-of-range radii" step).
  const sign = large === sweep ? -1 : 1;
  const ux = half === 0 ? 0 : dx / half;
  const uy = half === 0 ? 0 : dy / half;
  const cx = p1.x + dx + sign * d * -uy;
  const cy = p1.y + dy + sign * d * ux;
  const start = Math.atan2(p1.y - cy, p1.x - cx);
  let delta = Math.atan2(p2.y - cy, p2.x - cx) - start;
  if (sweep === 1 && delta < 0) delta += 2 * Math.PI;
  if (sweep === 0 && delta > 0) delta -= 2 * Math.PI;
  return { cx, cy, r: radius, start, delta };
}

/** Shortest distance from `p` to the segment `a → b`. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** Distance from `p` to a polyline (open or closed). */
export function distanceToPolyline(
  p: Point,
  points: readonly Point[],
  closed: boolean,
): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y);
  let best = Number.POSITIVE_INFINITY;
  for (let n = 1; n < points.length; n++) {
    best = Math.min(best, distanceToSegment(p, points[n - 1], points[n]));
  }
  if (closed) {
    best = Math.min(best, distanceToSegment(p, points[points.length - 1], points[0]));
  }
  return best;
}

/** Distance from `p` to a circular arc (0 when it is inside a full ring). */
export function distanceToArc(p: Point, arc: ArcCentre): number {
  const angle = Math.atan2(p.y - arc.cy, p.x - arc.cx);
  const outside =
    arc.delta >= 0
      ? (angle - arc.start + 2 * Math.PI) % (2 * Math.PI) > arc.delta
      : (arc.start - angle + 2 * Math.PI) % (2 * Math.PI) > -arc.delta;
  const radial = Math.abs(Math.hypot(p.x - arc.cx, p.y - arc.cy) - arc.r);
  if (!outside) return radial;
  // Outside the swept range: measure to the nearest endpoint.
  const from = polar(arc.cx, arc.cy, arc.r, arc.start);
  const to = polar(arc.cx, arc.cy, arc.r, arc.start + arc.delta);
  return Math.min(Math.hypot(p.x - from.x, p.y - from.y), Math.hypot(p.x - to.x, p.y - to.y));
}

/** Bounding box of a list of points. */
export function boundsOfPoints(points: readonly Point[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Grows a rect by `amount` on every side. */
export function expandRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    w: rect.w + 2 * amount,
    h: rect.h + 2 * amount,
  };
}

export function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}
