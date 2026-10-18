/**
 * KufiCraft — grid addressing and the construction grid.
 *
 * Addressing: pointer → anchor (cell + zone), anchor → centre, line points
 * (snap and position), straight runs. Square grid: cell `(column, row)` covers
 * `x ∈ [column·base, (column+1)·base)` and the same on `y`; circular grid:
 * band `column` covers radius `[column·base, (column+1)·base)`, sector `row`
 * covers `[row·10°, (row+1)·10°)` with `atan2(dy, dx)` normalised to `[0, 2π)`.
 *
 * The construction grid draws **two** families of lines, exactly like the old
 * app's CSS grid (`style.css:51‑72`): the cell borders, and the inner lines
 * that close each cell's ink square (at `ratio` per axis). The inner family is
 * what makes the ink sub-squares visible before anything is drawn, and it is
 * painted a little stronger so the eye reads «قلم / فراغ» directly.
 *
 * Pure math — no DOM, no config mutation. Coordinates outside the viewBox are
 * not clamped: callers clip the pointer to the canvas first.
 */

import {
  CIRCULAR_ANGULAR_UNIT,
  CIRCULAR_SECTORS,
  VIEWBOX_SIZE,
  cellSize,
  linePoint,
} from "./model";
import type { Anchor, Cell, LinePoint, ProjectConfig, Zone } from "./model";
import {
  A,
  M,
  circularSlice,
  cmdsToPath,
  inkUnit,
  polar,
  rectPath,
  slicePath,
  zoneRect,
} from "./geometry";
import type { Point } from "./geometry";

const CENTER = VIEWBOX_SIZE / 2;

export interface Run {
  /** `"row"` (constant `row`) or `"column"` (constant `column`); else `null`. */
  axis: "row" | "column" | null;
  /** First inclusive index along the run. */
  from: number;
  /** Last inclusive index along the run. */
  to: number;
}

function normalizeAngle(angle: number): number {
  const twoPi = 2 * Math.PI;
  const wrapped = angle % twoPi;
  return wrapped < 0 ? wrapped + twoPi : wrapped;
}

/** Cell / slice indices containing `point`. */
export function pointToCell(config: ProjectConfig, point: Point): Cell {
  const base = cellSize(config);
  if (config.gridType === "circular") {
    const dx = point.x - CENTER;
    const dy = point.y - CENTER;
    const radius = Math.hypot(dx, dy);
    const column = Math.floor(radius / base);
    const row = Math.min(
      Math.floor(normalizeAngle(Math.atan2(dy, dx)) / CIRCULAR_ANGULAR_UNIT),
      CIRCULAR_SECTORS - 1,
    );
    return { column, row };
  }
  return {
    column: Math.floor(point.x / base),
    row: Math.floor(point.y / base),
  };
}

/**
 * Full anchor of `point`: cell + zone quadrant, picking the ink / space zone
 * of each axis at `config.ratio`. The ink zone is the first `ratio` of the
 * cell on each axis (the old app's parity test in `point()`).
 */
export function pointToAnchor(config: ProjectConfig, point: Point): Anchor {
  const base = cellSize(config);
  const ratio = config.ratio;
  if (config.gridType === "circular") {
    const dx = point.x - CENTER;
    const dy = point.y - CENTER;
    const radius = Math.hypot(dx, dy) / base;
    const column = Math.floor(radius);
    const radial = radius - column;
    const angle = normalizeAngle(Math.atan2(dy, dx)) / CIRCULAR_ANGULAR_UNIT;
    const row = Math.min(Math.floor(angle), CIRCULAR_SECTORS - 1);
    const angular = angle - row;
    const zone = ((radial >= ratio ? 1 : 0) | (angular >= ratio ? 2 : 0)) as Zone;
    return { column, row, zone };
  }
  const x = point.x / base;
  const y = point.y / base;
  const column = Math.floor(x);
  const row = Math.floor(y);
  const zone = ((x - column >= ratio ? 1 : 0) | (y - row >= ratio ? 2 : 0)) as Zone;
  return { column, row, zone };
}

/** The cell of an anchor, discarding the zone. */
export function anchorToCell(anchor: Anchor): Cell {
  return { column: anchor.column, row: anchor.row };
}

/**
 * Centre of the **ink square** of cell / slice `(column, row)` — the anchor
 * every line, polyline and arc is drawn through (the old app's
 * `rectFromPoint(...) + 0.5 · size`).
 */
export function cellCentre(config: ProjectConfig, cell: Cell): Point {
  const base = cellSize(config);
  const ink = inkUnit(config);
  if (config.gridType === "circular") {
    const radius = cell.column * base + ink / 2;
    const angle = (cell.row + 0.5) * CIRCULAR_ANGULAR_UNIT;
    return polar(CENTER, CENTER, radius, angle);
  }
  return {
    x: cell.column * base + ink / 2,
    y: cell.row * base + ink / 2,
  };
}

/** Whether two cells share one row or one column. */
export function isSameAxis(a: Cell, b: Cell): boolean {
  return a.column === b.column || a.row === b.row;
}

/* ------------------------------------------------------------------ */
/* Line points                                                         */
/* ------------------------------------------------------------------ */

/**
 * Position of a line point: the ink origin of its **drawn** cell
 * (`cellSize(config)`, §1) plus `anchor · ink` on each axis. A point without an
 * anchor is `cellCentre` — literally the same value, so a document written
 * before anchors existed renders identically.
 *
 * Square grid: `x · ink` across, `y · ink` down from the ink square's origin.
 * Circular grid: `x · ink` outwards from the inner ink edge and `y · sector`
 * from the sector's start — the angular fraction spans the whole **sector**,
 * not the ink slice, which is what puts `(0.5, 0.5)` on the sector's mid-angle
 * and so exactly on `cellCentre`.
 */
export function linePointPosition(config: ProjectConfig, point: LinePoint): Point {
  const anchor = point.anchor;
  if (anchor === undefined) return cellCentre(config, point);
  const base = cellSize(config);
  const ink = inkUnit(config);
  if (config.gridType === "circular") {
    const radius = point.column * base + anchor.x * ink;
    const angle = (point.row + anchor.y) * CIRCULAR_ANGULAR_UNIT;
    return polar(CENTER, CENTER, radius, angle);
  }
  return {
    x: point.column * base + anchor.x * ink,
    y: point.row * base + anchor.y * ink,
  };
}

/**
 * The line tool's point under a pointer: the cell under the cursor (`floor`,
 * so a point exactly on a border belongs to the higher cell) and the anchor
 * nearest the pointer inside that cell's ink region, snapped to the nine
 * `ANCHOR_GRID` positions. The ink fraction is clamped to `[0, 1]`, so a
 * pointer in the cell's space strip lands on the nearest ink edge — the cell
 * under the cursor always wins.
 */
export function pointToLinePoint(config: ProjectConfig, point: Point): LinePoint {
  const base = cellSize(config);
  const ink = inkUnit(config);
  if (config.gridType === "circular") {
    const dx = point.x - CENTER;
    const dy = point.y - CENTER;
    const radius = Math.hypot(dx, dy);
    const column = Math.floor(radius / base);
    const angle = normalizeAngle(Math.atan2(dy, dx));
    const row = Math.min(
      Math.floor(angle / CIRCULAR_ANGULAR_UNIT),
      CIRCULAR_SECTORS - 1,
    );
    return linePoint(column, row, {
      x: anchorFraction(radius - column * base, ink),
      y: anchorFraction(angle - row * CIRCULAR_ANGULAR_UNIT, CIRCULAR_ANGULAR_UNIT),
    });
  }
  const column = Math.floor(point.x / base);
  const row = Math.floor(point.y / base);
  return linePoint(column, row, {
    x: anchorFraction(point.x - column * base, ink),
    y: anchorFraction(point.y - row * base, ink),
  });
}

/**
 * `local / span` snapped to the nearest of `{0, ½, 1}` and clamped into the
 * ink region: a tie (`¼`, `¾` of the extent) rounds outwards, to the anchor
 * after it. Degenerate input (a vanished ink region) snaps to the centre.
 */
function anchorFraction(local: number, span: number): number {
  if (!(span > 0) || !Number.isFinite(local)) return 0.5;
  const fraction = Math.round((local / span) * 2) / 2;
  return Math.min(1, Math.max(0, fraction));
}

/**
 * Straight run covered by `cells`: a row (indices are `column`) or a column
 * (indices are `row`). Mixed input → `axis: null`.
 */
export function runOf(cells: readonly Cell[]): Run {
  if (cells.length === 0) return { axis: null, from: 0, to: 0 };
  const first = cells[0];
  let sameRow = true;
  let sameColumn = true;
  let minColumn = first.column;
  let maxColumn = first.column;
  let minRow = first.row;
  let maxRow = first.row;
  for (const cell of cells) {
    if (cell.row !== first.row) sameRow = false;
    if (cell.column !== first.column) sameColumn = false;
    if (cell.column < minColumn) minColumn = cell.column;
    if (cell.column > maxColumn) maxColumn = cell.column;
    if (cell.row < minRow) minRow = cell.row;
    if (cell.row > maxRow) maxRow = cell.row;
  }
  if (sameRow) return { axis: "row", from: minColumn, to: maxColumn };
  if (sameColumn) return { axis: "column", from: minRow, to: maxRow };
  return { axis: null, from: 0, to: 0 };
}

/** Every cell a straight drag from `a` to `b` sweeps, in order. */
export function cellsBetween(a: Cell, b: Cell): Cell[] {
  const run = runOf([a, b]);
  if (run.axis === null) return [{ ...a }, { ...b }];
  const cells: Cell[] = [];
  const step = run.to >= run.from ? 1 : -1;
  if (run.axis === "row") {
    for (let column = run.from; column !== run.to + step; column += step) {
      cells.push({ column, row: a.row });
    }
  } else {
    for (let row = run.from; row !== run.to + step; row += step) {
      cells.push({ column: a.column, row });
    }
  }
  return cells;
}

/* ------------------------------------------------------------------ */
/* The construction grid                                               */
/* ------------------------------------------------------------------ */

export interface GridPaths {
  /** Whole-cell borders. */
  cellBorders: string;
  /** The inner lines that close each cell's ink square (painted stronger). */
  inkLines: string;
}

function squareGrid(config: ProjectConfig): GridPaths {
  const base = cellSize(config);
  const ink = inkUnit(config);
  const borders: string[] = [];
  const inner: string[] = [];
  const count = Math.max(1, Math.ceil(VIEWBOX_SIZE / base));
  // Cell starts, up to the viewBox edge. The board is laid out so the last
  // cell's space is cropped: its start is the last border, and nothing is
  // clamped onto the edge — with no space-less preset, no cell ends on it.
  for (let index = 0; index <= count; index++) {
    const at = index * base;
    if (at > VIEWBOX_SIZE + 1e-6) break;
    borders.push(`M ${at} 0 L ${at} ${VIEWBOX_SIZE}`);
    borders.push(`M 0 ${at} L ${VIEWBOX_SIZE} ${at}`);
  }
  // Both families are drawn unconditionally: every preset has real space, so
  // an inner edge can never land on a cell border (docs/CANVAS.md §2). The ink
  // edges close each ink square; the last one lands exactly on the viewBox
  // edge — the canvas ends with ink, never with a space strip.
  for (let index = 0; index < count; index++) {
    const at = index * base + ink;
    if (at > VIEWBOX_SIZE + 1e-6) break;
    inner.push(`M ${at} 0 L ${at} ${VIEWBOX_SIZE}`);
    inner.push(`M 0 ${at} L ${VIEWBOX_SIZE} ${at}`);
  }
  return { cellBorders: borders.join(" "), inkLines: inner.join(" ") };
}

function circlePath(radius: number): string {
  return cmdsToPath([
    M(CENTER + radius, CENTER),
    A(radius, radius, 0, 1, CENTER - radius, CENTER),
    A(radius, radius, 0, 1, CENTER + radius, CENTER),
  ]);
}

function spokePath(angle: number): string {
  const outer = polar(CENTER, CENTER, VIEWBOX_SIZE / 2, angle);
  const inner = polar(CENTER, CENTER, 0, angle);
  return `M ${inner.x} ${inner.y} L ${outer.x} ${outer.y}`;
}

function radialGrid(config: ProjectConfig): GridPaths {
  const base = cellSize(config);
  const ink = inkUnit(config);
  const borders: string[] = [];
  const inner: string[] = [];
  const maxRadius = VIEWBOX_SIZE / 2;
  // Ring edges, up to the last band start. With no space-less preset the
  // last band's outer edge never lands on the design circle, so the rings
  // stop before it — the same rule as the square grid's borders.
  for (let index = 1; index * base <= maxRadius + 1e-6; index++) {
    borders.push(circlePath(index * base));
  }
  for (let sector = 0; sector < CIRCULAR_SECTORS; sector++) {
    const angle = sector * CIRCULAR_ANGULAR_UNIT;
    borders.push(spokePath(angle));
  }
  // Both families are drawn unconditionally: every preset has real space, so
  // an inner ring / spoke can never land on the next border (docs/CANVAS.md
  // §2). The inner rings close each ink ring; the last one lands exactly on
  // the design circle (radius 500) — the circular board ends with ink too.
  for (let index = 0; index * base + ink <= maxRadius + 1e-6; index++) {
    inner.push(circlePath(index * base + ink));
  }
  for (let sector = 0; sector < CIRCULAR_SECTORS; sector++) {
    const angle = sector * CIRCULAR_ANGULAR_UNIT;
    inner.push(spokePath(angle + config.ratio * CIRCULAR_ANGULAR_UNIT));
  }
  return { cellBorders: borders.join(" "), inkLines: inner.join(" ") };
}

export function gridPaths(config: ProjectConfig): GridPaths {
  if (config.gridType === "circular") return radialGrid(config);
  return squareGrid(config);
}

/**
 * Path of one anchor's fragment.
 *
 * Exists so the editor can ring the cell a click-sequence tool has armed (the
 * line / arc tool's first click): the overlay strokes this path around the
 * pending start anchor before anything is committed. Square grid: the anchor's
 * zone rectangle; circular grid: its annular slice.
 */
export function anchorPath(config: ProjectConfig, anchor: Anchor): string {
  if (config.gridType === "circular") {
    return slicePath(
      circularSlice(config, anchor.column, anchor.row, anchor.zone),
    );
  }
  return rectPath(zoneRect(config, anchor.column, anchor.row, anchor.zone));
}
