/**
 * KufiCraft — corner rounding (pure, no DOM).
 *
 * The maths is `/tmp/opencode/kuficraft/rounding.js` (Yona Appletree's
 * `roundPathCorners`, Apache-2.0) carried over from path *strings* to the typed
 * commands of `geometry.ts`:
 *
 *   • a rounded corner is a **cubic Bézier** (`C`) — never an arc — whose two
 *     control points sit halfway between the trimmed endpoints and the corner
 *     itself (the reference's `startControl` / `endControl`);
 *   • each of the two edges at the corner is trimmed by
 *     `min(radius, length / 2)` — the reference's `moveTowardsLength` plus a
 *     per-edge clamp, which is what keeps two corners on one short edge from
 *     eating each other;
 *   • only straight-to-straight vertices are candidates: an `A` (or a `C` from
 *     a previous rounding) has no corner to round.
 *
 * Two deliberate deviations from the reference, both noted in `docs/FORMAT.md`:
 *
 *   1. the reference walks its command list **mutating** it, so the corner where
 *      the `Z` closes is measured against an already-trimmed neighbour and its
 *      curve can land off the edge. Here every corner is trimmed against the
 *      original geometry of its own two edges, so the closing corner is exact;
 *   2. the radius unit is a **fraction of the shorter side of the shape's box**
 *      (`MAX_ROUNDING_RADIUS = 0.5`), not a length, so a radius means the same
 *      thing at any cell size. `roundingRadius` resolves it.
 *
 * The corner *mask* names the corners of the shape's box as seen on screen
 * (`CORNER_*` in `model.ts`); a shape is authored unrotated, so `path` rotates
 * the mask back before calling in here (`rotateCornerMask`).
 */

import {
  CORNER_BOTTOM_LEFT,
  CORNER_BOTTOM_RIGHT,
  CORNER_TOP_LEFT,
  CORNER_TOP_RIGHT,
  MAX_ROUNDING_RADIUS,
} from "./model";
import type { ItemRounding } from "./model";
import { C, L, M } from "./geometry";
import type { PathCmd, Point, Rect } from "./geometry";

/** An absolute radius in local box units plus a local corner mask. */
export interface CornerRounding {
  radius: number;
  corners: number;
}

/** The four corners in clockwise screen order — the rotation cycle. */
const CORNER_CYCLE = [
  CORNER_TOP_LEFT,
  CORNER_TOP_RIGHT,
  CORNER_BOTTOM_RIGHT,
  CORNER_BOTTOM_LEFT,
] as const;

/**
 * Rotates a corner mask by `turns` quarter turns **clockwise**: `mask` is read
 * as the corners *before* the turn and the result names the corners they land
 * on.
 *
 * A stored mask is physical (top right is top right on screen, whatever the
 * writing direction), so drawing a rotated shape means rotating the mask the
 * other way — `path` calls this with `4 - turns`.
 */
export function rotateCornerMask(mask: number, turns: number): number {
  const step = ((turns % 4) + 4) % 4;
  let rotated = 0;
  for (let index = 0; index < CORNER_CYCLE.length; index++) {
    if ((mask & CORNER_CYCLE[index]) !== 0) {
      rotated |= CORNER_CYCLE[(index + step) % CORNER_CYCLE.length];
    }
  }
  return rotated;
}

/** True when the setting rounds anything at all. */
export function hasRounding(
  rounding: ItemRounding | undefined,
): rounding is ItemRounding {
  return (
    rounding !== undefined &&
    Number.isFinite(rounding.radius) &&
    rounding.radius > 0
  );
}

/**
 * The absolute radius of a stored setting inside a `w × h` box: the fraction
 * times the **shorter side**, capped at `MAX_ROUNDING_RADIUS` of it. `0` when
 * nothing is rounded — callers use that as "no rounding".
 */
export function roundingRadius(
  rounding: ItemRounding | undefined,
  w: number,
  h: number,
): number {
  if (!hasRounding(rounding)) return 0;
  const shorter = Math.min(Math.abs(w), Math.abs(h));
  const radius = Math.min(rounding.radius, MAX_ROUNDING_RADIUS) * shorter;
  return Number.isFinite(radius) && radius > 0 ? radius : 0;
}

/** Which box corner a local point sits at, or `0` for an interior vertex. */
function cornerAt(box: Rect, point: Point): number {
  const left = Math.abs(point.x - box.x) < 1e-9;
  const right = Math.abs(point.x - (box.x + box.w)) < 1e-9;
  const top = Math.abs(point.y - box.y) < 1e-9;
  const bottom = Math.abs(point.y - (box.y + box.h)) < 1e-9;
  if (top && left) return CORNER_TOP_LEFT;
  if (top && right) return CORNER_TOP_RIGHT;
  if (bottom && right) return CORNER_BOTTOM_RIGHT;
  if (bottom && left) return CORNER_BOTTOM_LEFT;
  return 0;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** `from` moved `amount` towards `to` — the reference's `moveTowardsLength`. */
function moveTowards(from: Point, to: Point, amount: number): Point {
  const length = distance(from, to);
  const fraction = length === 0 ? 0 : Math.min(1, amount / length);
  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
  };
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** One vertex of the outline walk. */
interface Vertex {
  /** Index in the command list of the command that ends here (`-1` = the `M`). */
  index: number;
  point: Point;
  /** Start of the incoming segment, or `null` when it is not a straight line. */
  from: Point | null;
  /** End of the outgoing segment, or `null` when it is not a straight line. */
  to: Point | null;
}

/** One vertex to round: the trimmed endpoints of its two edges. */
interface Corner {
  index: number;
  vertex: Point;
  start: Point;
  end: Point;
}

/**
 * The outline's vertices in path order, or `null` when the commands are not a
 * single subpath (`roundCorners` then hands them back untouched: none of the
 * ten shapes needs more, and rounding a shape with holes would be guesswork).
 */
function outlineVertices(cmds: readonly PathCmd[]): Vertex[] | null {
  const first = cmds[0];
  if (first === undefined || first.c !== "M") return null;
  if (cmds.some((cmd, index) => index > 0 && cmd.c === "M")) return null;
  const closed = cmds[cmds.length - 1].c === "Z";
  const points: Point[] = [{ x: first.x, y: first.y }];
  const indices: number[] = [-1];
  /** `straight[i]` — is the segment that *arrives* at `points[i + 1]` a line? */
  const straight: boolean[] = [];
  for (let index = 1; index < cmds.length; index++) {
    const cmd = cmds[index];
    if (cmd.c === "Z") break;
    points.push({ x: cmd.x, y: cmd.y });
    indices.push(index);
    straight.push(cmd.c === "L");
  }
  if (points.length < 2) return null;
  // The closing edge of a `Z` is a straight line back to the subpath start.
  straight.push(closed);
  return points.map((point, position) => {
    // A closed subpath has an incoming edge at its first point and an outgoing
    // edge at its last one; an open subpath has neither at its ends.
    const previous = position > 0 ? position - 1 : closed ? straight.length - 1 : -1;
    const next = position + 1 < points.length ? position + 1 : closed ? 0 : -1;
    return {
      index: indices[position],
      point,
      from:
        previous >= 0 && straight[previous] ? points[previous] : null,
      to: next >= 0 && straight[position] ? points[next] : null,
    };
  });
}

/** The vertices the mask selects and the radius can round. */
function cornersOf(
  vertices: readonly Vertex[],
  box: Rect,
  radius: number,
  corners: number,
): Corner[] {
  const rounded: Corner[] = [];
  for (const vertex of vertices) {
    const { from, to } = vertex;
    if (from === null || to === null) continue;
    // A vertex at a box corner is switched by its own bit; a vertex *inside* the
    // box (a hamza's notch, a pentagon's apex) has no bit of its own, so it
    // follows the radius alone.
    const corner = cornerAt(box, vertex.point);
    if (corner !== 0 && (corners & corner) === 0) continue;
    const shortest = Math.min(
      distance(vertex.point, from),
      distance(vertex.point, to),
    );
    const trim = Math.min(radius, shortest / 2);
    if (!(trim > 0)) continue;
    rounded.push({
      index: vertex.index,
      vertex: vertex.point,
      start: moveTowards(vertex.point, from, trim),
      end: moveTowards(vertex.point, to, trim),
    });
  }
  return rounded;
}

/** The cubic that replaces a corner (`rounding.js`'s control-point rule). */
function cornerCurve(corner: Corner): PathCmd {
  const first = midpoint(corner.start, corner.vertex);
  const second = midpoint(corner.vertex, corner.end);
  return C(first.x, first.y, second.x, second.y, corner.end.x, corner.end.y);
}

/**
 * Rounds the corners of a single-subpath outline. `box` is the authored box the
 * commands live in (`0…w × 0…h` for the pen's shapes), `corners` a **local**
 * corner mask and `radius` an absolute length.
 *
 * The input is never mutated: a path with nothing to round comes back as a copy,
 * and every returned command list stays continuous (the curve that replaces a
 * vertex starts where the shortened incoming command ended and ends on the
 * outgoing edge, so the following command is still valid as authored).
 */
export function roundCorners(
  cmds: readonly PathCmd[],
  box: Rect,
  radius: number,
  corners: number,
): PathCmd[] {
  if (!(radius > 0)) return [...cmds];
  const vertices = outlineVertices(cmds);
  if (vertices === null) return [...cmds];
  const rounded = cornersOf(vertices, box, radius, corners);
  if (rounded.length === 0) return [...cmds];
  const byIndex = new Map(rounded.map((corner) => [corner.index, corner]));
  const closing = byIndex.get(-1);

  const out: PathCmd[] = [];
  for (let index = 0; index < cmds.length; index++) {
    const cmd = cmds[index];
    const corner = byIndex.get(index);
    if (corner !== undefined && cmd.c === "L") {
      // Shorten the command that ends at the corner, then append the curve. The
      // following command is unchanged: it still ends at its own vertex and now
      // starts where the curve ended. (Only an `L` can end at a roundable
      // vertex — the walk marks straight segments alone.)
      out.push(L(corner.start.x, corner.start.y));
      out.push(cornerCurve(corner));
      continue;
    }
    if (cmd.c === "Z" && closing !== undefined) {
      // The closing edge (a `Z` is a straight line back to the start) is drawn
      // explicitly up to the trimmed start point, and the subpath then begins at
      // the curve's end — the `M` case below.
      out.push(L(closing.start.x, closing.start.y));
      out.push(cornerCurve(closing));
      out.push(cmd);
      continue;
    }
    if (cmd.c === "M" && closing !== undefined) {
      out.push(M(closing.end.x, closing.end.y));
      continue;
    }
    out.push(cmd);
  }
  return out;
}
