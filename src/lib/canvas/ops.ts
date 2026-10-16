/**
 * KufiCraft — canvas item operations (pure, no DOM).
 *
 * Keys are the identity of an item (see `convex/lib/model.ts`): adding an
 * item whose key already exists is a no-op, exactly like the backend's
 * `projects.applyOps`. Every function returns a new state and never mutates
 * its arguments, so the editor can keep an immutable history for undo/redo.
 *
 * `toOps` turns a local item list (the editor's optimistic overlay) into the
 * ordered batch the backend expects: `{type:"add"} | {type:"remove"} |
 * {type:"replace"}` — one call per completed gesture.
 */

import { lineKey, tileKey } from "./model";
import type {
  CanvasItem,
  LineItem,
  ProjectConfig,
  TileItem,
  TileShape,
} from "./model";
import { runOf } from "./grid";
import type { Anchor } from "./grid";

export interface CanvasState {
  readonly items: readonly CanvasItem[];
}

/** Backend-compatible batch (mirrors `projects.applyOps` in `convex/projects.ts`). */
export type CanvasOp =
  | { type: "add"; items: CanvasItem[] }
  | { type: "remove"; keys: string[] }
  | { type: "replace"; items: CanvasItem[] };

/** Flat, comparable projection of an item — used for change detection. */
function serializeItem(item: CanvasItem): string {
  switch (item.t) {
    case "tile":
      return [
        "t",
        item.k,
        item.i,
        item.j,
        item.q,
        item.s ?? "square",
        item.c ?? "",
        item.r ?? 0,
      ].join("|");
    case "line":
      return ["l", item.k, item.i1, item.j1, item.i2, item.j2, item.c ?? ""].join(
        "|",
      );
    case "arch":
      return [
        "a",
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

/** Appends the items whose key is not taken yet (first occurrence wins). */
export function addItems(
  state: CanvasState,
  items: readonly CanvasItem[],
): CanvasState {
  if (items.length === 0) return state;
  const keys = new Set(state.items.map((item) => item.k));
  const appended: CanvasItem[] = [];
  for (const item of items) {
    if (!keys.has(item.k)) {
      keys.add(item.k);
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
  const items = state.items.filter((item) => !doomed.has(item.k));
  return items.length === state.items.length ? state : { items };
}

/** Replaces the whole item list, deduped by key (last occurrence wins). */
export function replaceItems(
  state: CanvasState,
  items: readonly CanvasItem[],
): CanvasState {
  const byKey = new Map<string, CanvasItem>();
  for (const item of items) byKey.set(item.k, item);
  return { items: [...byKey.values()] };
}

/**
 * Diffs two item lists into backend ops. A full `replace` is emitted when an
 * item changed, when items were reordered or when the surviving order would
 * differ from `next` — otherwise a `remove` + `add` pair is enough.
 */
export function toOps(
  prev: readonly CanvasItem[],
  next: readonly CanvasItem[],
): CanvasOp[] {
  const prevKeys = new Set(prev.map((item) => item.k));
  const nextKeys = new Set(next.map((item) => item.k));

  const removedKeys: string[] = [];
  const kept: CanvasItem[] = [];
  for (const item of prev) {
    if (nextKeys.has(item.k)) kept.push(item);
    else removedKeys.push(item.k);
  }
  const added: CanvasItem[] = [];
  const keptNext: CanvasItem[] = [];
  for (const item of next) {
    if (prevKeys.has(item.k)) keptNext.push(item);
    else added.push(item);
  }

  const changed =
    kept.length !== keptNext.length ||
    kept.some(
      (item, index) => serializeItem(item) !== serializeItem(keptNext[index]),
    );
  const keptOrder = kept.map((item) => item.k);
  const expectedOrder = [...keptOrder, ...added.map((item) => item.k)];
  const orderPreserved =
    expectedOrder.length === next.length &&
    expectedOrder.every((key, index) => key === next[index].k);

  if (changed || !orderPreserved) {
    return [{ type: "replace", items: [...next] }];
  }

  const ops: CanvasOp[] = [];
  if (removedKeys.length > 0) ops.push({ type: "remove", keys: removedKeys });
  if (added.length > 0) ops.push({ type: "add", items: added });
  return ops;
}

export interface StrokeOptions {
  /** Shape for the drawn tiles (default `square`). */
  shape?: TileShape;
  /** Colour override; omitted when it equals `config.ink`. */
  color?: string;
  /** Quarter-turn rotation for the drawn tiles. */
  rotation?: 0 | 1 | 2 | 3;
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
      last.i !== anchor.i ||
      last.j !== anchor.j ||
      last.q !== anchor.q
    ) {
      collapsed.push(anchor);
    }
  }
  return collapsed;
}

function colorOverride(
  config: ProjectConfig,
  color: string | undefined,
): string | undefined {
  return color !== undefined && color !== config.ink ? color : undefined;
}

function makeTile(
  config: ProjectConfig,
  anchor: Anchor,
  opts: StrokeOptions,
): TileItem {
  const tile: TileItem = {
    t: "tile",
    k: tileKey(anchor.i, anchor.j, anchor.q),
    i: anchor.i,
    j: anchor.j,
    q: anchor.q,
  };
  const shape = opts.shape ?? "square";
  if (shape !== "square") tile.s = shape;
  const rotation = ((opts.rotation ?? 0) % 4 + 4) % 4;
  if (rotation !== 0) tile.r = rotation as 0 | 1 | 2 | 3;
  const color = colorOverride(config, opts.color);
  if (color !== undefined) tile.c = color;
  return tile;
}

function makeLine(
  config: ProjectConfig,
  i1: number,
  j1: number,
  i2: number,
  j2: number,
  color: string | undefined,
): LineItem {
  const line: LineItem = {
    t: "line",
    k: lineKey(i1, j1, i2, j2),
    i1,
    j1,
    i2,
    j2,
  };
  const override = colorOverride(config, color);
  if (override !== undefined) line.c = override;
  return line;
}

/**
 * Pen stroke → items (docs/CANVAS.md §4): one `LineItem` when
 * `mergeLines` is on, the anchors form a straight run and they all sit in
 * the same zone quadrant; one `TileItem` per anchor otherwise.
 */
export function strokeToItems(
  config: ProjectConfig,
  anchors: readonly Anchor[],
  opts: StrokeOptions = {},
): CanvasItem[] {
  const collapsed = collapseAnchors(anchors);
  const merge = opts.mergeLines ?? config.mergeLines;
  if (merge && collapsed.length >= 2) {
    const run = runOf(collapsed);
    const zone = collapsed[0].q;
    const sameZone = collapsed.every((anchor) => anchor.q === zone);
    if (run.axis === "row" && sameZone) {
      return [
        makeLine(config, run.from, collapsed[0].j, run.to, collapsed[0].j, opts.color),
      ];
    }
    if (run.axis === "column" && sameZone) {
      return [
        makeLine(config, collapsed[0].i, run.from, collapsed[0].i, run.to, opts.color),
      ];
    }
  }
  return collapsed.map((anchor) => makeTile(config, anchor, opts));
}
