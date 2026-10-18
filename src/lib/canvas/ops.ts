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
  ItemBorder,
  ItemRounding,
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
/* Arrange (z-order)                                                   */
/* ------------------------------------------------------------------ */

/** The four arrange commands, in the order Illustrator/Figma list them. */
export type ArrangeAction = "front" | "forward" | "backward" | "back";

/** Array form, for menu rendering and disabled-state scans. */
export const ARRANGE_ACTIONS: readonly ArrangeAction[] = [
  "front",
  "forward",
  "backward",
  "back",
];

/** Whether two lists hold the same keys in the same order. */
function sameKeys(a: readonly CanvasItem[], b: readonly CanvasItem[]): boolean {
  for (let index = 0; index < a.length; index++) {
    if (a[index].key !== b[index].key) return false;
  }
  return true;
}

/**
 * Moves the listed items in the **render order** — the array order is the
 * z-order, so the end of the list paints on top (docs/CANVAS.md §3).
 *
 * `front` / `back` are stable partitions of the list around the selection:
 * unselected items keep their relative order, and so does the selection
 * itself. `forward` / `backward` step each selected item past its nearest
 * unselected neighbour **above** / **below**, iterating from that end, so a
 * contiguous block moves as one block and relative order never changes.
 *
 * An action that cannot change anything returns `items` unchanged — the editor
 * turns that into "no commit, no undo entry" and the menu into a disabled item.
 */
export function arrangeItems(
  items: readonly CanvasItem[],
  keys: readonly string[],
  action: ArrangeAction,
): readonly CanvasItem[] {
  if (items.length < 2 || keys.length === 0) return items;
  const selected = new Set(keys);

  switch (action) {
    case "front":
    case "back": {
      const rest: CanvasItem[] = [];
      const picked: CanvasItem[] = [];
      for (const item of items) {
        (selected.has(item.key) ? picked : rest).push(item);
      }
      const next = action === "front" ? [...rest, ...picked] : [...picked, ...rest];
      return sameKeys(next, items) ? items : next;
    }
    case "forward": {
      const next = [...items];
      let moved = false;
      // From the top, so a block's lower items cannot block its upper ones.
      for (let index = next.length - 2; index >= 0; index--) {
        if (selected.has(next[index].key) && !selected.has(next[index + 1].key)) {
          [next[index], next[index + 1]] = [next[index + 1], next[index]];
          moved = true;
        }
      }
      return moved ? next : items;
    }
    case "backward": {
      const next = [...items];
      let moved = false;
      // Mirror of `forward`: from the bottom this time.
      for (let index = 1; index < next.length; index++) {
        if (selected.has(next[index].key) && !selected.has(next[index - 1].key)) {
          [next[index - 1], next[index]] = [next[index], next[index - 1]];
          moved = true;
        }
      }
      return moved ? next : items;
    }
  }
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
  /** Corner rounding for the drawn tiles (`radius: 0` → square corners). */
  rounding?: ItemRounding;
  /** Outside border for the drawn tiles. */
  border?: ItemBorder;
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
  // `radius: 0` / `sides: 0` are the off ends of the style: they store nothing,
  // which is exactly how a document drawn before these fields existed looks.
  const rounding =
    style.rounding !== undefined && style.rounding.radius > 0
      ? style.rounding
      : undefined;
  const border =
    style.border !== undefined && style.border.sides !== 0
      ? style.border
      : undefined;
  return makeTile({
    column: anchor.column,
    row: anchor.row,
    zone: anchor.zone,
    shape: shape === "square" ? undefined : shape,
    rotation: rotation === 0 ? undefined : (rotation as Rotation),
    rounding,
    border,
    color: resolvedColor(config, style.color),
  });
}

/**
 * Pen stroke → items.
 *
 * One fragment per anchor the pointer touched — the reference app: the pen
 * colours the cells it is moved over and nothing else. It never merges a
 * straight run into a bar (`straightLinesAsSquares` is about the *line tool*),
 * so what the overlay previews is exactly what is painted.
 */
export function penItems(
  config: ProjectConfig,
  anchors: readonly Anchor[],
  style: InkStyle = {},
): CanvasItem[] {
  return collapseAnchors(anchors).map((anchor) => tileFor(config, anchor, style));
}

/**
 * Line tool → items.
 *
 * A run with **no diagonal segment** is either one solid `line` bar (the two
 * endpoints) or — when `config.straightLinesAsSquares` is on, the reference
 * app's default — one square per cell along every segment. Anything with a
 * diagonal part becomes one stroked `polyline`, exactly like the old app.
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
  if (config.gridType === "square" && config.straightLinesAsSquares) {
    const squared = straightRunSquares(config, unique, closed, lineColor);
    if (squared !== null) return squared;
  }
  const run = runOf(unique);
  if (!closed && run.axis !== null && config.gridType === "square") {
    return [makeLine(unique[0], unique[unique.length - 1], lineColor)];
  }
  return [makeStroke(unique, closed, lineColor)];
}

/**
 * One square per cell along every axis-aligned segment of the run — the
 * reference app's `line()` (which emitted a `square` shape per cell whenever a
 * straight line was drawn). Returns `null` as soon as a segment is diagonal,
 * leaving the run to the polyline path.
 */
function straightRunSquares(
  config: ProjectConfig,
  cells: readonly Cell[],
  closed: boolean,
  color: string,
): CanvasItem[] | null {
  const segments: [Cell, Cell][] = [];
  for (let index = 1; index < cells.length; index++) {
    segments.push([cells[index - 1], cells[index]]);
  }
  if (closed && cells.length > 2) {
    segments.push([cells[cells.length - 1], cells[0]]);
  }
  const along: Cell[] = [];
  const seen = new Set<string>();
  for (const [from, to] of segments) {
    if (from.column !== to.column && from.row !== to.row) return null;
    const step = Math.sign(to.column - from.column) || Math.sign(to.row - from.row);
    const length = Math.abs(to.column - from.column) + Math.abs(to.row - from.row);
    for (let offset = 0; offset <= length; offset++) {
      const cell =
        from.column === to.column
          ? { column: from.column, row: from.row + step * offset }
          : { column: from.column + step * offset, row: from.row };
      // A closed run returns to its first cell; a cell is painted once.
      const id = `${cell.column}:${cell.row}`;
      if (seen.has(id)) continue;
      seen.add(id);
      along.push(cell);
    }
  }
  return along.map((cell) =>
    tileFor(config, { column: cell.column, row: cell.row, zone: 0 }, { color }),
  );
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
