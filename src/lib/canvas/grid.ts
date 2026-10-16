/**
 * KufiCraft — grid addressing: pointer → anchor, anchor → centre, runs.
 *
 * Square grid: cell `(i, j)` covers `x ∈ [i·base, (i+1)·base)` and
 * `y ∈ [j·base, (j+1)·base)`. Circular grid: band `i` covers radius
 * `[i·base, (i+1)·base)`, sector `j` covers angle `[j·10°, (j+1)·10°)`
 * with `atan2(dy, dx)` normalised to `[0, 2π)`.
 *
 * Pure math — no DOM, no config mutation. Coordinates outside the viewBox
 * are not clamped: callers clip the pointer to the canvas first.
 */

import { CIRCULAR_ANGULAR_UNIT, CIRCULAR_SECTORS, VIEWBOX_SIZE } from "./model";
import type { ProjectConfig, ZoneQuadrant } from "./model";
import type { Point } from "./geometry";

const CENTER = VIEWBOX_SIZE / 2;

export interface Cell {
  i: number;
  j: number;
}

export interface Anchor extends Cell {
  q: ZoneQuadrant;
}

export interface Run {
  /** `"row"` (constant `j`) or `"column"` (constant `i`); `null` otherwise. */
  axis: "row" | "column" | null;
  /** First inclusive index along the run. */
  from: number;
  /** Last inclusive index along the run. */
  to: number;
}

/** Normalises an angle into `[0, 2π)`. */
function normalizeAngle(angle: number): number {
  const twoPi = 2 * Math.PI;
  const wrapped = angle % twoPi;
  return wrapped < 0 ? wrapped + twoPi : wrapped;
}

/** Cell / slice indices containing `point`. */
export function pointToCell(config: ProjectConfig, point: Point): Cell {
  if (config.gridType === "circular") {
    const dx = point.x - CENTER;
    const dy = point.y - CENTER;
    const radius = Math.hypot(dx, dy);
    const i = Math.floor(radius / config.base);
    const j = Math.min(
      Math.floor(normalizeAngle(Math.atan2(dy, dx)) / CIRCULAR_ANGULAR_UNIT),
      CIRCULAR_SECTORS - 1,
    );
    return { i, j };
  }
  return {
    i: Math.floor(point.x / config.base),
    j: Math.floor(point.y / config.base),
  };
}

/**
 * Full anchor of `point`: cell + zone quadrant, picking the ink / space zone
 * of each axis at `config.ratio`.
 */
export function pointToAnchor(config: ProjectConfig, point: Point): Anchor {
  const base = config.base;
  const ratio = config.ratio;
  if (config.gridType === "circular") {
    const dx = point.x - CENTER;
    const dy = point.y - CENTER;
    const radius = Math.hypot(dx, dy) / base;
    const i = Math.floor(radius);
    const radial = radius - i;
    const angle = normalizeAngle(Math.atan2(dy, dx)) / CIRCULAR_ANGULAR_UNIT;
    const j = Math.min(Math.floor(angle), CIRCULAR_SECTORS - 1);
    const angular = angle - j;
    const q = ((radial >= ratio ? 1 : 0) | (angular >= ratio ? 2 : 0)) as ZoneQuadrant;
    return { i, j, q };
  }
  const x = point.x / base;
  const y = point.y / base;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const q = ((x - i >= ratio ? 1 : 0) | (y - j >= ratio ? 2 : 0)) as ZoneQuadrant;
  return { i, j, q };
}

/** Centre of cell / slice `(i, j)` in viewBox units. */
export function cellCenter(config: ProjectConfig, i: number, j: number): Point {
  if (config.gridType === "circular") {
    const radius = (i + 0.5) * config.base;
    const angle = (j + 0.5) * CIRCULAR_ANGULAR_UNIT;
    return {
      x: CENTER + radius * Math.cos(angle),
      y: CENTER + radius * Math.sin(angle),
    };
  }
  return {
    x: (i + 0.5) * config.base,
    y: (j + 0.5) * config.base,
  };
}

/** Whether two anchors / cells share one row or one column. */
export function isSameAxis(a: Cell, b: Cell): boolean {
  return a.i === b.i || a.j === b.j;
}

/**
 * Straight run covered by `cells`: a row (`axis: "row"`, indices are `i`)
 * or a column (`axis: "column"`, indices are `j`). Mixed input → `null`.
 */
export function runOf(cells: readonly Cell[]): Run {
  if (cells.length === 0) return { axis: null, from: 0, to: 0 };
  const first = cells[0];
  let sameRow = true;
  let sameColumn = true;
  let minI = first.i;
  let maxI = first.i;
  let minJ = first.j;
  let maxJ = first.j;
  for (let n = 0; n < cells.length; n++) {
    const cell = cells[n];
    if (cell.j !== first.j) sameRow = false;
    if (cell.i !== first.i) sameColumn = false;
    if (cell.i < minI) minI = cell.i;
    else if (cell.i > maxI) maxI = cell.i;
    if (cell.j < minJ) minJ = cell.j;
    else if (cell.j > maxJ) maxJ = cell.j;
  }
  if (sameRow) return { axis: "row", from: minI, to: maxI };
  if (sameColumn) return { axis: "column", from: minJ, to: maxJ };
  return { axis: null, from: 0, to: 0 };
}
