/**
 * KufiCraft — grid addressing and the construction grid.
 *
 * Addressing: pointer → anchor (cell + zone), anchor → centre, line points
 * (snap and position), straight runs. Square grid: cell `(column, row)` covers
 * `x ∈ [column·base, (column+1)·base)` and the same on `y`; circular grid:
 * band `column` covers radius `[column·base, (column+1)·base)`, sector `row`
 * covers `[row·unit, (row+1)·unit)` with `unit = 2π / config.circularSectors`
 * and `atan2(dy, dx)` normalised to `[0, 2π)`.
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
  CENTRE_ANCHOR,
  VIEWBOX_SIZE,
  anchorOf,
  arcPoint,
  cellSize,
  circularAngularUnit,
  circularSectors,
  linePoint,
  zoneOf,
} from "./model";
import type {
  Anchor,
  ArcDirection,
  Cell,
  InkPoint,
  LinePoint,
  ProjectConfig,
  Zone,
} from "./model";
import { A, M, cmdsToPath, circularSlice, inkUnit, polar, zoneRect } from "./geometry";
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
      Math.floor(normalizeAngle(Math.atan2(dy, dx)) / circularAngularUnit(config)),
      circularSectors(config) - 1,
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
    const angle = normalizeAngle(Math.atan2(dy, dx)) / circularAngularUnit(config);
    const row = Math.min(Math.floor(angle), circularSectors(config) - 1);
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
    const angle = (cell.row + 0.5) * circularAngularUnit(config);
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
 * Position of a line point: its anchor inside **its own fragment** —
 * `docs/CANVAS.md` §3. The ink fragment (zone 0) maps onto the cell's ink
 * square, exactly where every pre-fragment point drew; a space fragment maps
 * onto its own space square, so a point placed on a space fragment stays on
 * it at every ratio.
 *
 * Square grid: the fragment's `zoneRect`. Circular grid: the fragment's
 * annular slice — `x` runs across the fragment's radial span, and `y` across
 * the whole **sector** for an ink-angular point (the pre-fragment rule:
 * `(0.5, 0.5)` is exactly `cellCentre`, which back-compat pins) and across the
 * space slice for a space-angular point, so a space point also stays on its
 * own slice. A point without an anchor draws at its fragment's centre —
 * `cellCentre` for the ink fragment.
 */
export function linePointPosition(config: ProjectConfig, point: LinePoint): Point {
  const anchor = anchorOf(point);
  const zone = zoneOf(point);
  if (config.gridType === "circular") {
    const slice = circularSlice(config, point.column, point.row, zone);
    const radius = slice.r1 + anchor.x * (slice.r2 - slice.r1);
    const angle =
      zone & 2
        ? slice.a1 + anchor.y * (slice.a2 - slice.a1)
        : (point.row + anchor.y) * circularAngularUnit(config);
    return polar(CENTER, CENTER, radius, angle);
  }
  const box = zoneRect(config, point.column, point.row, zone);
  return {
    x: box.x + anchor.x * box.w,
    y: box.y + anchor.y * box.h,
  };
}

/**
 * The nine-anchor resolution itself: the **fragment** under the cursor
 * (`pointToAnchor`) plus the anchor nearest the pointer inside that fragment,
 * snapped to the nine `ANCHOR_GRID` positions. Each axis is measured inside
 * the fragment's own box and the fraction is clamped to `[0, 1]`, so a click
 * on a space fragment lands on that space fragment — never on the cell's ink
 * square (docs/CANVAS.md §3). The resolved anchor is returned verbatim; the
 * two public readers below decide whether the centre is stored.
 */
function pointToAnchorPoint(config: ProjectConfig, point: Point): LinePoint {
  const target = pointToAnchor(config, point);
  const zone = target.zone;
  if (config.gridType === "circular") {
    const dx = point.x - CENTER;
    const dy = point.y - CENTER;
    const radius = Math.hypot(dx, dy);
    const angle = normalizeAngle(Math.atan2(dy, dx));
    const unit = circularAngularUnit(config);
    const slice = circularSlice(config, target.column, target.row, zone);
    return {
      column: target.column,
      row: target.row,
      zone,
      anchor: {
        x: anchorFraction(radius - slice.r1, slice.r2 - slice.r1),
        y: zone & 2
          ? anchorFraction(angle - slice.a1, slice.a2 - slice.a1)
          : anchorFraction(angle - target.row * unit, unit),
      },
    };
  }
  const box = zoneRect(config, target.column, target.row, zone);
  return {
    column: target.column,
    row: target.row,
    zone,
    anchor: {
      x: anchorFraction(point.x - box.x, box.w),
      y: anchorFraction(point.y - box.y, box.h),
    },
  };
}

/**
 * The line tool's point under a pointer: the anchor resolution above, with the
 * **centre dropped** — canonical storage of nothing (`docs/CANVAS.md` §3).
 * With `smart` on, the pointer still chooses the fragment but the point is
 * always that fragment's centre: the nine-anchor precision is exactly what
 * the mobile default skips.
 */
export function pointToLinePoint(
  config: ProjectConfig,
  point: Point,
  smart = false,
): LinePoint {
  const resolved = pointToAnchorPoint(config, point);
  if (smart) {
    return linePoint(resolved.column, resolved.row, resolved.zone);
  }
  return linePoint(resolved.column, resolved.row, resolved.zone, resolved.anchor);
}

/**
 * The arc tool's endpoint under a pointer: the same nine anchors and the same
 * fragment, but the resolved anchor is returned **verbatim, the centre
 * included**. For an arc endpoint an absent anchor means the legacy spring
 * point (`docs/CANVAS.md` §5), so a centre click must be stored to be
 * meaningful — dropping it would silently move the endpoint onto the ink edge.
 */
export function pointToArcPoint(config: ProjectConfig, point: Point): LinePoint {
  const resolved = pointToAnchorPoint(config, point);
  return arcPoint(resolved.column, resolved.row, resolved.zone, resolved.anchor);
}

/**
 * Smart anchors for an **arc pair**, one per endpoint, in that endpoint's own
 * fragment. A same-row chord springs off the bottom (clockwise) or top
 * (counterclockwise) middle; a same-column chord off the left or right middle;
 * anything else — the 45° diagonals an arc supports — uses both fragment
 * centres. The row/column choices are the reference app's spring points
 * (`Arc.fallbackAnchors`); the diagonal is deliberately the centre, which is
 * the simple "else" rule of smart mode.
 *
 * The tap's exact anchor is ignored, but its fragment (`zone`) is preserved:
 * smart mode loosens the position inside a fragment, never the fragment the
 * designer touched.
 */
export function smartArcPoints(
  from: LinePoint,
  to: LinePoint,
  direction: ArcDirection,
): { from: LinePoint; to: LinePoint } {
  const anchor = smartArcAnchor(from, to, direction);
  return {
    from: arcPoint(from.column, from.row, from.zone, anchor),
    to: arcPoint(to.column, to.row, to.zone, anchor),
  };
}

function smartArcAnchor(
  from: LinePoint,
  to: LinePoint,
  direction: ArcDirection,
): InkPoint {
  if (from.row === to.row && from.column === to.column) return CENTRE_ANCHOR;
  if (from.row === to.row) {
    return { x: 0.5, y: direction === "clockwise" ? 1 : 0 };
  }
  if (from.column === to.column) {
    return { x: direction === "clockwise" ? 0 : 1, y: 0.5 };
  }
  return CENTRE_ANCHOR;
}

/**
 * `local / span` snapped to the nearest of `{0, ½, 1}` and clamped into the
 * fragment: a tie (`¼`, `¾` of the extent) rounds outwards, to the anchor
 * after it. Degenerate input (a vanished fragment) snaps to the centre.
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
  const unit = circularAngularUnit(config);
  const sectors = circularSectors(config);
  const borders: string[] = [];
  const inner: string[] = [];
  const maxRadius = VIEWBOX_SIZE / 2;
  // Ring edges, up to the last band start. With no space-less preset the
  // last band's outer edge never lands on the design circle, so the rings
  // stop before it — the same rule as the square grid's borders.
  for (let index = 1; index * base <= maxRadius + 1e-6; index++) {
    borders.push(circlePath(index * base));
  }
  for (let sector = 0; sector < sectors; sector++) {
    const angle = sector * unit;
    borders.push(spokePath(angle));
  }
  // Both families are drawn unconditionally: every preset has real space, so
  // an inner ring / spoke can never land on the next border (docs/CANVAS.md
  // §2). The inner rings close each ink ring; the last one lands exactly on
  // the design circle (radius 500) — the circular board ends with ink too.
  for (let index = 0; index * base + ink <= maxRadius + 1e-6; index++) {
    inner.push(circlePath(index * base + ink));
  }
  for (let sector = 0; sector < sectors; sector++) {
    const angle = sector * unit;
    inner.push(spokePath(angle + config.ratio * unit));
  }
  return { cellBorders: borders.join(" "), inkLines: inner.join(" ") };
}

export function gridPaths(config: ProjectConfig): GridPaths {
  if (config.gridType === "circular") return radialGrid(config);
  return squareGrid(config);
}
