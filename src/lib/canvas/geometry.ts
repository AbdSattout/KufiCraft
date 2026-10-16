/**
 * KufiCraft — fragment & shape geometry (pure, no DOM).
 *
 * Everything works in the fixed `0 0 1000 1000` viewBox of the canvas: the
 * contract lives in `docs/CANVAS.md` (§2 zones, §4 shapes). The square grid
 * is a rect grid; the circular grid is a polar grid centred on
 * `(VIEWBOX_SIZE / 2, VIEWBOX_SIZE / 2)`.
 *
 * Zone rule: every cell / slice is split per axis at `config.ratio`.
 * `ZoneQuadrant` bit 0 marks the x / radial axis as the *space* zone and
 * bit 1 marks the y / angular axis as the *space* zone, so `q = 0` is the
 * big ink fragment (size `ratio`) and `q = 3` the small space fragment
 * (size `1 - ratio`).
 */

import {
  CIRCULAR_ANGULAR_UNIT,
  CIRCULAR_SECTORS,
  VIEWBOX_SIZE,
} from "./model";
import type {
  ArchItem,
  CanvasItem,
  LineItem,
  ProjectConfig,
  TileItem,
  TileShape,
  ZoneQuadrant,
} from "./model";
import { cellCenter } from "./grid";

/* ------------------------------------------------------------------ */
/* Public geometry types                                               */
/* ------------------------------------------------------------------ */

export interface Point {
  x: number;
  y: number;
}

/** Axis-aligned zone rect of a square-grid fragment (`w`, `h` > 0). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Annular sector of a circular-grid fragment (radians, SVG convention). */
export interface CircularSlice {
  cx: number;
  cy: number;
  /** Inner radius. */
  r1: number;
  /** Outer radius. */
  r2: number;
  /** Start angle — 0 = +x, growing clockwise on screen (y grows down). */
  a1: number;
  /** End angle (smaller than `a1` for a wrap-around run). */
  a2: number;
}

const CENTER = VIEWBOX_SIZE / 2;

/* ------------------------------------------------------------------ */
/* Path command plumbing                                               */
/* ------------------------------------------------------------------ */

type PathCmd =
  | { c: "M"; x: number; y: number }
  | { c: "L"; x: number; y: number }
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

const M = (x: number, y: number): PathCmd => ({ c: "M", x, y });
const L = (x: number, y: number): PathCmd => ({ c: "L", x, y });
const A = (
  rx: number,
  ry: number,
  large: 0 | 1,
  sweep: 0 | 1,
  x: number,
  y: number,
): PathCmd => ({ c: "A", rx, ry, rot: 0, large, sweep, x, y });
const Z: PathCmd = { c: "Z" };

/**
 * A frame is a rotation + translation: `(u, v) -> o + R(cos, sin)·(u, v)`.
 * Shapes are authored in a local `0…w × 0…h` box and mapped through one.
 */
interface Frame {
  ox: number;
  oy: number;
  cos: number;
  sin: number;
}

/** Rounds away float noise; full precision at viewBox scale otherwise. */
function fmt(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function cmdsToPath(cmds: readonly PathCmd[]): string {
  let d = "";
  for (let n = 0; n < cmds.length; n++) {
    const cmd = cmds[n];
    const lead = n === 0 ? "" : " ";
    switch (cmd.c) {
      case "M":
      case "L":
        d += `${lead}${cmd.c} ${fmt(cmd.x)} ${fmt(cmd.y)}`;
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
function rectPath(rect: Rect): string {
  const { x, y, w, h } = rect;
  return cmdsToPath([M(x, y), L(x + w, y), L(x + w, y + h), L(x, y + h), Z]);
}

/** `shape ∘ frame` — both parts are rotation + translation frames. */
function composeFrames(inner: Frame, outer: Frame): Frame {
  return {
    cos: outer.cos * inner.cos - outer.sin * inner.sin,
    sin: outer.sin * inner.cos + outer.cos * inner.sin,
    ox: outer.ox + (inner.ox * outer.cos - inner.oy * outer.sin),
    oy: outer.oy + (inner.ox * outer.sin + inner.oy * outer.cos),
  };
}

/** Rotation of `turns` quarter turns (clockwise on screen) around `(cx, cy)`. */
function quarterTurnFrame(cx: number, cy: number, turns: number): Frame {
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
function mapCommands(
  cmds: readonly PathCmd[],
  frame: Frame,
  rotDeg: number,
): PathCmd[] {
  const out: PathCmd[] = [];
  for (const cmd of cmds) {
    if (cmd.c === "Z") {
      out.push(cmd);
      continue;
    }
    const x = frame.ox + (cmd.x * frame.cos - cmd.y * frame.sin);
    const y = frame.oy + (cmd.x * frame.sin + cmd.y * frame.cos);
    if (cmd.c === "A") {
      out.push({
        c: "A",
        rx: cmd.rx,
        ry: cmd.ry,
        rot: ((((cmd.rot + rotDeg) % 180) + 180) % 180),
        large: cmd.large,
        sweep: cmd.sweep,
        x,
        y,
      });
    } else {
      out.push({ c: cmd.c, x, y });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Zones                                                               */
/* ------------------------------------------------------------------ */

/**
 * Zone rect of a square-grid fragment: the intersection of the two chosen
 * zones inside cell `(i, j)`. A circular grid has no rect fragment — use
 * `circularSlice` for the annular sector instead.
 */
export function zoneRect(
  config: ProjectConfig,
  i: number,
  j: number,
  q: ZoneQuadrant,
): Rect {
  const base = config.base;
  const ink = config.ratio * base;
  const space = base - ink;
  return {
    x: i * base + (q & 1 ? ink : 0),
    y: j * base + (q & 2 ? ink : 0),
    w: q & 1 ? space : ink,
    h: q & 2 ? space : ink,
  };
}

/** Annular sector of a circular-grid fragment: band `i`, sector `j`, zone `q`. */
export function circularSlice(
  config: ProjectConfig,
  i: number,
  j: number,
  q: ZoneQuadrant,
): CircularSlice {
  const base = config.base;
  const ink = config.ratio * base;
  const unit = CIRCULAR_ANGULAR_UNIT;
  const r1 = i * base + (q & 1 ? ink : 0);
  const a1 = j * unit + (q & 2 ? config.ratio * unit : 0);
  return {
    cx: CENTER,
    cy: CENTER,
    r1,
    r2: r1 + (q & 1 ? base - ink : ink),
    a1,
    a2: a1 + (q & 2 ? (1 - config.ratio) * unit : config.ratio * unit),
  };
}

function polar(cx: number, cy: number, r: number, a: number): Point {
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

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/** Authored commands for one shape inside a local `w × h` box. */
function baseCommands(shape: TileShape, w: number, h: number): PathCmd[] {
  switch (shape) {
    case "square":
      return [M(0, 0), L(w, 0), L(w, h), L(0, h), Z];
    case "circle":
      // Inscribed ellipse; two half arcs keep the flags unambiguous.
      return [
        M(0, h / 2),
        A(w / 2, h / 2, 1, 0, w, h / 2),
        A(w / 2, h / 2, 1, 0, 0, h / 2),
        Z,
      ];
    case "triangle":
      return [M(0, h), L(w / 2, 0), L(w, h), Z];
    case "quadrant":
      // Quarter ellipse centred on the bottom-left corner, closed via it.
      return [M(0, 0), A(w, h, 0, 1, w, h), L(0, h), Z];
    case "semicircle":
      // Upper half ellipse, flat edge on the bottom edge.
      return [M(0, h), A(w / 2, h, 0, 1, w, h), Z];
    case "hexagon":
      // Flat-top hexagon.
      return [
        M(0, h / 2),
        L(w / 4, 0),
        L((3 * w) / 4, 0),
        L(w, h / 2),
        L((3 * w) / 4, h),
        L(w / 4, h),
        Z,
      ];
    case "arc": {
      // Quarter-arc band from the bottom-left to the top-right corner,
      // closed along the two rect edges (port of the old arch band).
      const t = Math.min(w, h) / 2;
      return [
        M(0, h),
        A(w, h, 0, 1, w, 0),
        L(w, t),
        A(w - t, h - t, 0, 0, t, h),
        L(0, h),
        Z,
      ];
    }
    case "hamza1": {
      // Hook: vertical bar on the left, bar along the top, rounded corner.
      const t = Math.min(w, h) / 3;
      return [
        M(0, h),
        L(0, t),
        A(t, t, 0, 1, t, 0),
        L(w, 0),
        L(w, t),
        L(t, t),
        L(t, h),
        Z,
      ];
    }
    case "hamza2": {
      // Variant hook: vertical bar on the right, bar along the top.
      const t = Math.min(w, h) / 3;
      return [
        M(w, h),
        L(w, t),
        A(t, t, 0, 0, w - t, 0),
        L(0, 0),
        L(0, t),
        L(w - t, t),
        L(w - t, h),
        Z,
      ];
    }
  }
}

function shapePathInFrame(
  shape: TileShape,
  w: number,
  h: number,
  rotation: number,
  frame: Frame,
  rotDeg: number,
): string {
  const turned = composeFrames(
    quarterTurnFrame(w / 2, h / 2, ((rotation % 4) + 4) % 4),
    frame,
  );
  const cmds = mapCommands(baseCommands(shape, w, h), turned, rotDeg + rotation * 90);
  return cmdsToPath(cmds);
}

/**
 * Filled path of `shape` inside `rect`; `rotation` is quarter turns
 * clockwise around the rect centre.
 */
export function shapePath(
  shape: TileShape,
  rect: Rect,
  rotation: number,
): string {
  if (shape === "square" && ((rotation % 4) + 4) % 4 === 0) {
    // Hot path: most fragments are plain ink rects.
    return rectPath(rect);
  }
  return shapePathInFrame(
    shape,
    rect.w,
    rect.h,
    rotation,
    { ox: rect.x, oy: rect.y, cos: 1, sin: 0 },
    0,
  );
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

/**
 * Circular fragment of a tile. The zone fragment of a polar grid *is* an
 * annular sector, so the default shape renders as one. Other shapes are
 * fitted into the slice's radial/tangential frame, which keeps the shape
 * palette usable on circular grids.
 */
function circularTilePath(config: ProjectConfig, tile: TileItem): string {
  const slice = circularSlice(config, tile.i, tile.j, tile.q);
  const shape = tile.s ?? "square";
  const rotation = tile.r ?? 0;
  if (shape === "square" && ((rotation % 4) + 4) % 4 === 0) {
    return slicePath(slice);
  }

  const aMid = (slice.a1 + slice.a2) / 2;
  const rMid = (slice.r1 + slice.r2) / 2;
  const w = slice.r2 - slice.r1;
  const h = rMid * (slice.a2 - slice.a1);
  const cos = Math.cos(aMid);
  const sin = Math.sin(aMid);
  const px = slice.cx + rMid * cos;
  const py = slice.cy + rMid * sin;
  // Local +x runs outward along the radius, local +y counter-clockwise.
  return shapePathInFrame(
    shape,
    w,
    h,
    rotation,
    {
      cos,
      sin,
      ox: px - (w / 2) * cos + (h / 2) * sin,
      oy: py - (w / 2) * sin - (h / 2) * cos,
    },
    (aMid * 180) / Math.PI,
  );
}

export function tilePath(config: ProjectConfig, tile: TileItem): string {
  if (config.gridType === "circular") return circularTilePath(config, tile);
  return shapePath(
    tile.s ?? "square",
    zoneRect(config, tile.i, tile.j, tile.q),
    tile.r ?? 0,
  );
}

/** Signed number of sectors from `j1` to `j2` along the shortest path. */
export function shortestSectorDelta(j1: number, j2: number): number {
  let delta = (((j2 - j1) % CIRCULAR_SECTORS) + CIRCULAR_SECTORS) % CIRCULAR_SECTORS;
  if (delta > CIRCULAR_SECTORS / 2) delta -= CIRCULAR_SECTORS;
  return delta;
}

/** Number of sectors covered by the run `j1 → j2` along the shortest path. */
function sectorSpan(j1: number, j2: number): number {
  const delta = shortestSectorDelta(j1, j2);
  return delta >= 0 ? delta + 1 : delta - 1;
}

/**
 * Straight run. Square: the inclusive cell run with full cell thickness.
 * Circular: an annular sector over bands `i1…i2` across sectors `j1…j2`.
 */
export function linePath(config: ProjectConfig, line: LineItem): string {
  const base = config.base;
  if (config.gridType === "circular") {
    const i1 = Math.min(line.i1, line.i2);
    const i2 = Math.max(line.i1, line.i2);
    const a1 = line.j1 * CIRCULAR_ANGULAR_UNIT;
    return sectorPath(
      CENTER,
      CENTER,
      i1 * base,
      (i2 + 1) * base,
      a1,
      a1 + sectorSpan(line.j1, line.j2) * CIRCULAR_ANGULAR_UNIT,
    );
  }
  if (line.j1 === line.j2) {
    const i1 = Math.min(line.i1, line.i2);
    const i2 = Math.max(line.i1, line.i2);
    return rectPath({
      x: i1 * base,
      y: line.j1 * base,
      w: (i2 - i1 + 1) * base,
      h: base,
    });
  }
  if (line.i1 === line.i2) {
    const j1 = Math.min(line.j1, line.j2);
    const j2 = Math.max(line.j1, line.j2);
    return rectPath({
      x: line.i1 * base,
      y: j1 * base,
      w: base,
      h: (j2 - j1 + 1) * base,
    });
  }
  // Not a straight run (invalid item): cover both cells defensively.
  const i1 = Math.min(line.i1, line.i2);
  const j1 = Math.min(line.j1, line.j2);
  return rectPath({
    x: i1 * base,
    y: j1 * base,
    w: (Math.abs(line.i2 - line.i1) + 1) * base,
    h: (Math.abs(line.j2 - line.j1) + 1) * base,
  });
}

/**
 * Stroked arc from `p1` to `p2` with radius `r`, bulging towards the unit
 * vector `(bx, by)`. `(large-arc, sweep)` = `(0, ?)` picks the shallow rib.
 */
function bulgeArc(p1: Point, p2: Point, r: number, bx: number, by: number): string {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  const ux = len === 0 ? 1 : dx / len;
  const uy = len === 0 ? 0 : dy / len;
  // A sweep-flag arc bulges towards (uy, -ux) when sweep = 1.
  const sweep: 0 | 1 = bx * uy - by * ux > 0 ? 1 : 0;
  return cmdsToPath([M(p1.x, p1.y), A(r, r, 0, sweep, p2.x, p2.y)]);
}

/** Arch bulge direction: 0 = up (left for vertical runs), 1 = down (right). */
function archBulge(p1: Point, p2: Point, d: 0 | 1): Point {
  if (p1.y === p2.y) return { x: 0, y: d === 0 ? -1 : 1 };
  if (p1.x === p2.x) return { x: d === 0 ? -1 : 1, y: 0 };
  // Diagonal fallback (invalid for real arches): perpendicular that points up.
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  const bx = dy / len;
  const by = -dx / len;
  const up = { x: by > 0 ? -bx : bx, y: by > 0 ? -by : by };
  return d === 0 ? up : { x: -up.x, y: -up.y };
}

function squareArchPath(config: ProjectConfig, arch: ArchItem): string {
  const p1 = cellCenter(config, arch.i1, arch.j1);
  const p2 = cellCenter(config, arch.i2, arch.j2);
  // Port of the old arch: radius = (chord + ink thickness) / 2, so the rib
  // clears the gap between two fragments (docs/CANVAS.md §3).
  const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const radius = (chord + config.ratio * config.base) / 2;
  const bulge = archBulge(p1, p2, arch.d);
  return bulgeArc(p1, p2, radius, bulge.x, bulge.y);
}

function circularArchPath(config: ProjectConfig, arch: ArchItem): string {
  const base = config.base;
  const unit = CIRCULAR_ANGULAR_UNIT;
  const r1 = (arch.i1 + 0.5) * base;
  const r2 = (arch.i2 + 0.5) * base;
  const a1 = (arch.j1 + 0.5) * unit;
  const delta = shortestSectorDelta(arch.j1, arch.j2);
  const p1 = polar(CENTER, CENTER, r1, a1);
  const p2 = polar(CENTER, CENTER, r2, a1 + delta * unit);
  // The old circular arch spanned the sectors at the band mid-radius; the
  // stroked version keeps that arc (SVG scales radii when bands differ).
  const r = (r1 + r2) / 2;
  return cmdsToPath([
    M(p1.x, p1.y),
    A(r, r, 0, delta >= 0 ? 1 : 0, p2.x, p2.y),
  ]);
}

export function archPath(config: ProjectConfig, arch: ArchItem): string {
  if (config.gridType === "circular") return circularArchPath(config, arch);
  return squareArchPath(config, arch);
}

/** Path of any item — the single entry point used by the renderer. */
export function itemPath(config: ProjectConfig, item: CanvasItem): string {
  switch (item.t) {
    case "tile":
      return tilePath(config, item);
    case "line":
      return linePath(config, item);
    case "arch":
      return archPath(config, item);
    default: {
      const unhandled: never = item;
      return unhandled;
    }
  }
}
