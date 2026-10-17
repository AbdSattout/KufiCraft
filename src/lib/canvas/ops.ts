/**
 * KufiCraft — canvas item operations (pure, no DOM).
 *
 * Keys are the identity of an item (see `convex/lib/model.ts`): adding an
 * item whose key already exists is a no-op, exactly like the backend's
 * `projects.applyOps`. Every function returns a new state and never mutates
 * its arguments, so the editor can keep an immutable history for undo/redo.
 *
 * `toOps` turns a local item list into the ordered batch the backend expects:
 * `{type:"add"} | {type:"remove"} | {type:"replace"}` — one call per completed
 * gesture. A gesture that only touched a handful of items emits a bounded
 * `remove` + `add` pair instead of re-sending the whole board: since the pen
 * now paints over what is under it (the old app's recolour behaviour), a full
 * `replace` per stroke would mean megabytes on a dense board.
 */

import { itemSignature } from "./model";
import type {
  Anchor,
  CanvasItem,
  Cell,
  ProjectConfig,
  Rotation,
  ShapeId,
} from "./model";
import { runOf } from "./grid";
import { makeLine, makeStroke, makeTile } from "./items";

export interface CanvasState {
  readonly items: readonly CanvasItem[];
}

/** Backend-compatible batch (mirrors `projects.applyOps` in `convex/projects.ts`). */
export type CanvasOp =
  | { type: "add"; items: CanvasItem[] }
  | { type: "remove"; keys: string[] }
  | { type: "replace"; items: CanvasItem[] };

/** Appends the items whose key is not taken yet (first occurrence wins). */
export function addItems(
  state: CanvasState,
  items: readonly CanvasItem[],
): CanvasState {
  if (items.length === 0) return state;
  const keys = new Set(state.items.map((item) => item.key));
  const appended: CanvasItem[] = [];
  for (const item of items) {
    if (!keys.has(item.key)) {
      keys.add(item.key);
      appended.push(item);
    }
  }
  if (appended.length === 0) return state;
  return { items: [...state.items, ...appended] };
}

/** Removes every item whose key is listed. */
export function removeItems(
  state: CanvasState,
  keys: readonly string[],
): CanvasState {
  if (keys.length === 0) return state;
  const doomed = new Set(keys);
  const items = state.items.filter((item) => !doomed.has(item.key));
  return items.length === state.items.length ? state : { items };
}

/**
 * Paints `items` over `state`: the items are appended, but any existing item
 * with the same key is **replaced in place** (the old app's paint-over, which
 * is how recolouring a fragment worked). Untouched items keep their object
 * identity, so React can skip them.
 */
export function paintItems(
  state: CanvasState,
  items: readonly CanvasItem[],
): CanvasState {
  if (items.length === 0) return state;
  const incoming = new Map<string, CanvasItem>();
  for (const item of items) incoming.set(item.key, item);
  let changed = false;
  const kept = state.items.map((item) => {
    const next = incoming.get(item.key);
    if (next === undefined || next === item) return item;
    changed = true;
    return next;
  });
  const present = new Set(state.items.map((item) => item.key));
  const appended: CanvasItem[] = [];
  for (const item of items) {
    if (!present.has(item.key)) {
      appended.push(item);
      changed = true;
    }
  }
  return changed ? { items: [...kept, ...appended] } : state;
}

/** Replaces the whole item list, deduped by key (last occurrence wins). */
export function replaceItems(
  state: CanvasState,
  items: readonly CanvasItem[],
): CanvasState {
  const byKey = new Map<string, CanvasItem>();
  for (const item of items) byKey.set(item.key, item);
  return { items: [...byKey.values()] };
}

/**
 * Diffs two item lists into backend ops.
 *
 * The batch is built around the longest common prefix of `prev` and `next`
 * (comparing key **and** content): everything from the first difference on is
 * removed and re-appended in `next`'s order. Appending tiles is the common
 * case, so the batch is usually just the new items; erasing is just keys; and
 * a paint-over re-sends only the tail from the first repainted item — never
 * the whole board, which a full `replace` per stroke would mean on a dense
 * canvas.
 */
export function toOps(
  prev: readonly CanvasItem[],
  next: readonly CanvasItem[],
): CanvasOp[] {
  const limit = Math.min(prev.length, next.length);
  let prefix = 0;
  while (
    prefix < limit &&
    prev[prefix].key === next[prefix].key &&
    itemSignature(prev[prefix]) === itemSignature(next[prefix])
  ) {
    prefix++;
  }
  if (prefix === prev.length && prefix === next.length) return [];

  const removeKeys = prev.slice(prefix).map((item) => item.key);
  const append = next.slice(prefix);
  const ops: CanvasOp[] = [];
  if (removeKeys.length > 0) ops.push({ type: "remove", keys: removeKeys });
  if (append.length > 0) ops.push({ type: "add", items: [...append] });
  return ops;
}

/* ------------------------------------------------------------------ */
/* Gesture → items                                                     */
/* ------------------------------------------------------------------ */

export interface InkStyle {
  /** Shape for the drawn tiles (default `square`). */
  shape?: ShapeId;
  /** Colour override; omitted when it equals `config.ink`. */
  color?: string;
  /** Quarter-turn rotation for the drawn tiles. */
  rotation?: Rotation;
  /** Overrides `config.mergeLines` for this stroke. */
  mergeLines?: boolean;
}

/** Consecutive identical anchors collapse to one. */
function collapseAnchors(anchors: readonly Anchor[]): Anchor[] {
  const collapsed: Anchor[] = [];
  for (const anchor of anchors) {
    const last = collapsed[collapsed.length - 1];
    if (
      last === undefined ||
      last.column !== anchor.column ||
      last.row !== anchor.row ||
      last.zone !== anchor.zone
    ) {
      collapsed.push(anchor);
    }
  }
  return collapsed;
}

/**
 * The colour an item is drawn with: the tool's own colour when it has one,
 * otherwise the document ink. It is **always** stored on the item, so changing
 * the document ink later never repaints what is already on the board — colour
 * belongs to the fragment, exactly like the reference app.
 */
function resolvedColor(
  config: ProjectConfig,
  color: string | undefined,
): string {
  return color !== undefined && color.length > 0 ? color : config.ink;
}

function tileFor(
  config: ProjectConfig,
  anchor: Anchor,
  style: InkStyle,
): CanvasItem {
  const shape = style.shape ?? "square";
  const rotation = (((style.rotation ?? 0) % 4) + 4) % 4;
  return makeTile({
    column: anchor.column,
    row: anchor.row,
    zone: anchor.zone,
    shape: shape === "square" ? undefined : shape,
    rotation: rotation === 0 ? undefined : (rotation as Rotation),
    color: resolvedColor(config, style.color),
  });
}

/**
 * Pen stroke → items.
 *
 * The pen paints the anchors the pointer touched, one tile each — the old
 * app's behaviour. `mergeLines` (default on) folds a **contiguous** straight
 * run of full-ink anchors into one `line` item, which is the same picture as
 * the run of fragments the old line tool emitted, at a fraction of the cost.
 */
export function penItems(
  config: ProjectConfig,
  anchors: readonly Anchor[],
  style: InkStyle = {},
): CanvasItem[] {
  const collapsed = collapseAnchors(anchors);
  const merge = style.mergeLines ?? config.mergeLines;
  if (merge && collapsed.length >= 2 && config.gridType === "square") {
    const run = runOf(collapsed);
    const zone = collapsed[0].zone;
    const sameZone = collapsed.every((anchor) => anchor.zone === zone);
    if (run.axis !== null && sameZone && zone === 0) {
      const indexes = collapsed.map((anchor) =>
        run.axis === "row" ? anchor.column : anchor.row,
      );
      const sorted = [...new Set(indexes)].sort((a, b) => a - b);
      const contiguous = sorted.every(
        (value, index) => index === 0 || value === sorted[index - 1] + 1,
      );
      if (contiguous) {
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const from: Cell =
          run.axis === "row"
            ? { column: first, row: collapsed[0].row }
            : { column: collapsed[0].column, row: first };
        const to: Cell =
          run.axis === "row"
            ? { column: last, row: collapsed[0].row }
            : { column: collapsed[0].column, row: last };
        if (first !== last) {
          return [makeLine(from, to, resolvedColor(config, style.color))];
        }
      }
    }
  }
  return collapsed.map((anchor) => tileFor(config, anchor, style));
}

/**
 * Line tool → items: the old app's two-point, same-axis case becomes one
 * `line` bar; anything else (a diagonal, or three or more points) becomes one
 * stroked `polyline`, exactly like the reference implementation.
 */
export function lineItems(
  config: ProjectConfig,
  points: readonly Cell[],
  closed: boolean,
  color?: string,
): CanvasItem[] {
  const unique = dedupeCells(points, closed);
  if (unique.length < 2) return [];
  const lineColor = resolvedColor(config, color);
  const run = runOf(unique);
  if (!closed && run.axis !== null && config.gridType === "square") {
    return [makeLine(unique[0], unique[unique.length - 1], lineColor)];
  }
  return [makeStroke(unique, closed, lineColor)];
}

/** Drops immediate repeats (and the closing repeat of `closed`). */
function dedupeCells(points: readonly Cell[], closed: boolean): Cell[] {
  const unique: Cell[] = [];
  for (const cell of points) {
    const last = unique[unique.length - 1];
    if (last === undefined || last.column !== cell.column || last.row !== cell.row) {
      unique.push({ column: cell.column, row: cell.row });
    }
  }
  if (
    closed &&
    unique.length > 1 &&
    unique[0].column === unique[unique.length - 1].column &&
    unique[0].row === unique[unique.length - 1].row
  ) {
    unique.pop();
  }
  return unique;
}
