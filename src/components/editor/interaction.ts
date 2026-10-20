/**
 * KufiCraft — editor interaction vocabulary and helpers (pure, no React, no DOM).
 *
 * This module holds everything the editor needs *between* a pointer event and
 * a backend batch, except the tools themselves (those are in `tools.ts`):
 *
 *   • viewport → viewBox mapping (`clientToViewBox`) including CSS scaling
 *     and RTL — the SVG is fitted with `preserveAspectRatio="xMidYMid meet"`,
 *     so the mapping is a uniform scale plus a centred letterbox offset;
 *   • anchoring (`anchorAt`, `linePointAt`, `arcPointAt`, `anchorsAlongLine`)
 *     and hit testing (`hitTest`) — the item classes answer for their own
 *     geometry;
 *   • the line tool's run resolver (`lineRun`): preview and commit resolve a
 *     gesture through it, so they can never disagree on an endpoint;
 *   • selection operations (move, recolour, reshape, duplicate, delete);
 *   • the shared types the tools speak: `ToolId`, `ToolContext`, `DrawStyle`,
 *     `ArcStyle`.
 *
 * Geometry never lives here: every item answers for itself through its class
 * in `@/lib/canvas/items`, and this module only decides *what* to ask it.
 */

import {
  CORNER_ALL,
  DEFAULT_BORDER,
  VIEWBOX_SIZE,
  cellSize,
  circularSectors,
  itemSignature as signatureOf,
  linePoint,
  maxGridIndex,
  sameLinePoint,
  tileKey,
} from "@/lib/canvas/model";
import type {
  Anchor,
  ArcDirection,
  ArcItem,
  ArcPoint,
  ArcSize,
  CanvasItem,
  Cell,
  ItemBorder,
  ItemRounding,
  LinePoint,
  ProjectConfig,
  Rotation,
  ShapeId,
} from "@/lib/canvas/model";
import {
  cellCentre,
  pointToAnchor,
  pointToArcPoint,
  pointToLinePoint,
} from "@/lib/canvas/grid";
import { shortestSectorDelta } from "@/lib/canvas/geometry";
import { lineItems, removeItems } from "@/lib/canvas/ops";
import {
  Arc,
  colorItem,
  isItemAllowed,
  itemBounds as boundsOfItem,
  itemCellRange,
  itemContains as hitTestItem,
  itemIntersectsRect,
  makeArc,
  makeLine,
  makeStroke,
  makeTile,
  moveItem,
  styleItem,
  visibleItems,
} from "@/lib/canvas/items";
import type { ItemStyle } from "@/lib/canvas/items";
import type { Point, Rect } from "@/lib/canvas/geometry";
import { SHAPE_ORDER as SHAPE_REGISTRY_ORDER, shapeLabel } from "@/lib/canvas/shapes";

/* ------------------------------------------------------------------ */
/* Tools, shapes, copy                                                 */
/* ------------------------------------------------------------------ */

/**
 * The tools, named for what they do. The old / previous names were fixed:
 * the arch tool is `arc` (قوس) because «arch» was a misspelling that also
 * collided with the shape formerly called `arc` (now `curve`). Each tool is a
 * class in `tools.ts` that declares its own id, label, shortcut and icon.
 */
export type ToolId = "select" | "pen" | "line" | "eraser" | "arc" | "hand";

/** Shape palette order — the pen's ten shapes. */
export const SHAPE_ORDER: readonly ShapeId[] = SHAPE_REGISTRY_ORDER;

export const SHAPE_LABELS: Record<string, string> = Object.fromEntries(
  SHAPE_ORDER.map((id) => [id, shapeLabel(id)]),
);

/** Rotation helper: next quarter turn, `0 → 1 → 2 → 3 → 0`. */
export function nextRotation(rotation: Rotation): Rotation {
  return ((((rotation + 1) % 4) + 4) % 4) as Rotation;
}

/**
 * Style of the tiles drawn next (also applied to a selection on demand).
 *
 * There is no colour here: the pen paints with the project's ink colour
 * (`config.ink`), and every fragment stores the colour it was drawn with, so
 * picking a new ink never repaints what is already on the canvas
 * (docs/CANVAS.md §Items + §Editing).
 *
 * Rounding and the outside border are part of the style too, so a pen stroke
 * is drawn exactly the way the panel shows it. `rounding.radius === 0` and
 * `border.width === 0` are the "off" ends and are what a fresh editor opens
 * with — a document drawn with the defaults stores neither field.
 */
export interface DrawStyle {
  shape: ShapeId;
  rotation: Rotation;
  rounding: ItemRounding;
  border: ItemBorder;
}

export const DEFAULT_STYLE: DrawStyle = {
  shape: "square",
  rotation: 0,
  // All four corners on: the switch a designer expects when first enabling it.
  rounding: { radius: 0, corners: CORNER_ALL },
  border: { ...DEFAULT_BORDER },
};

/**
 * The style the shape panel displays. With nothing selected it is the draw
 * style; with a selection it is the first selected item's own rounding and
 * border — the panel reflects what is on the board, while the **draw** style
 * (`context.style`) stays what the tools paint with until an edit is made.
 * An item without a field shows the off state: no rounding, no border.
 */
export function styleForSelection(
  style: DrawStyle,
  item: CanvasItem | undefined,
): DrawStyle {
  if (item === undefined) return style;
  const rounding =
    item.type === "arc" ? undefined : item.rounding;
  return {
    ...style,
    rounding: rounding ?? { radius: 0, corners: CORNER_ALL },
    border: item.border ?? { ...DEFAULT_BORDER },
  };
}

/** Style of the next arc (the old app's direction radios + the size option). */
export interface ArcStyle {
  direction: ArcDirection;
  size: ArcSize;
}

export const DEFAULT_ARC_STYLE: ArcStyle = {
  direction: "clockwise",
  size: "half",
};

/** Everything a tool needs to know about the document and the editor. */
export interface ToolContext {
  config: ProjectConfig;
  items: readonly CanvasItem[];
  selection: readonly string[];
  /** The active tool (the registry dispatches with it). */
  tool: ToolId;
  style: DrawStyle;
  arc: ArcStyle;
}

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

/** Inclusive index limits of the grid. */
export function cellLimits(config: ProjectConfig): {
  maxColumn: number;
  maxRow: number;
} {
  const base = cellSize(config);
  if (config.gridType === "circular") {
    return {
      maxColumn: Math.max(0, Math.ceil(VIEWBOX_SIZE / 2 / base) - 1),
      maxRow: circularSectors(config) - 1,
    };
  }
  const count = Math.max(0, Math.ceil(VIEWBOX_SIZE / base) - 1);
  return { maxColumn: count, maxRow: count };
}

/** Anchor under a pointer position (clipped to the canvas first). */
export function anchorAt(config: ProjectConfig, point: Point): Anchor {
  return pointToAnchor(config, clampToCanvas(point));
}

/**
 * The line tool's point under `point`: the **fragment** under the cursor plus
 * the anchor nearest the pointer inside that fragment (nine positions). A
 * click on a space fragment stays on it — every fragment is a square the user
 * can draw on (`docs/CANVAS.md` §3).
 */
export function linePointAt(config: ProjectConfig, point: Point): LinePoint {
  return pointToLinePoint(config, clampToCanvas(point));
}

/**
 * The arc tool's endpoint under `point`: the same nine-anchor resolution, but
 * the resolved point keeps its anchor — including the centre, because an
 * arc endpoint's absent value is the legacy spring point (`docs/CANVAS.md` §5).
 */
export function arcPointAt(config: ProjectConfig, point: Point): LinePoint {
  return pointToArcPoint(config, clampToCanvas(point));
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.column === b.column && a.row === b.row;
}

/** Identity of an anchor — the same key the engine gives its fragment. */
function anchorKey(anchor: Anchor): string {
  return tileKey(anchor.column, anchor.row, anchor.zone);
}

/** Sector indices wrap on the circular grid, so a move cannot escape the ring. */
function wrapSector(config: ProjectConfig, row: number): number {
  const sectors = circularSectors(config);
  return ((row % sectors) + sectors) % sectors;
}

/* ------------------------------------------------------------------ */
/* Hit testing (the item classes answer)                               */
/* ------------------------------------------------------------------ */

export function hitsItem(
  config: ProjectConfig,
  item: CanvasItem,
  point: Point,
): boolean {
  return hitTestItem(config, item, point);
}

/** Topmost **visible** item under `point` (last drawn wins), or `null`. */
export function hitTest(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  point: Point,
): CanvasItem | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    // An item the grid hides is not there as far as the pointer is concerned
    // (`docs/CANVAS.md` §3): it cannot be clicked, moved or erased. The
    // document keeps it (see the per-grid rules in items.ts).
    if (!isItemAllowed(config, item)) continue;
    if (hitsItem(config, item, point)) return item;
  }
  return null;
}

/** Axis-aligned bounds of an item (marquee, move clamping, previews). */
export function itemBounds(config: ProjectConfig, item: CanvasItem): Rect {
  return boundsOfItem(config, item);
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

/** Keys of the **visible** items the marquee box touches. */
export function marqueeSelection(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  box: Rect,
): string[] {
  const keys: string[] = [];
  for (const item of items) {
    if (!isItemAllowed(config, item)) continue;
    if (itemIntersectsRect(config, item, box)) keys.push(item.key);
  }
  return keys;
}

/* ------------------------------------------------------------------ */
/* Selection operations                                                */
/* ------------------------------------------------------------------ */

/**
 * Drops selection keys whose item is gone, or which the current grid hides.
 *
 * The controller runs this every render, so a switch to a circular board
 * clears the line/arc keys it hides at once (`docs/CANVAS.md` §3) — delete,
 * move, colour and arrange can never act on something the user cannot see.
 * Key order is kept; the array identity is the caller's business.
 */
export function pruneSelection(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  keys: readonly string[],
): string[] {
  if (keys.length === 0) return [];
  const live = new Set(
    visibleItems(config.gridType, items).map((item) => item.key),
  );
  return keys.filter((key) => live.has(key));
}

/** Largest delta (in cells) that keeps every listed item inside the grid. */
export function clampDelta(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  keys: readonly string[],
  dColumn: number,
  dRow: number,
): { dColumn: number; dRow: number } {
  const wanted = new Set(keys);
  let minColumn = Infinity;
  let maxColumn = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const item of items) {
    if (!wanted.has(item.key)) continue;
    const range = itemCellRange(item);
    minColumn = Math.min(minColumn, range.minColumn);
    maxColumn = Math.max(maxColumn, range.maxColumn);
    minRow = Math.min(minRow, range.minRow);
    maxRow = Math.max(maxRow, range.maxRow);
  }
  if (!Number.isFinite(minColumn)) return { dColumn: 0, dRow: 0 };
  const limits = cellLimits(config);
  const clampedColumn = Math.min(
    Math.max(dColumn, -minColumn),
    Math.max(0, limits.maxColumn - maxColumn),
  );
  if (config.gridType === "circular") return { dColumn: clampedColumn, dRow };
  const clampedRow = Math.min(
    Math.max(dRow, -minRow),
    Math.max(0, limits.maxRow - maxRow),
  );
  return { dColumn: clampedColumn, dRow: clampedRow };
}

/** Sector indices wrap on the circular grid, so a move cannot escape the ring. */
function wrapRows(config: ProjectConfig, item: CanvasItem): CanvasItem {
  switch (item.type) {
    case "tile":
      return makeTile({ ...item, row: wrapSector(config, item.row) });
    case "line":
      return makeLine(
        {
          column: item.from.column,
          row: wrapSector(config, item.from.row),
          zone: item.from.zone,
        },
        {
          column: item.to.column,
          row: wrapSector(config, item.to.row),
          zone: item.to.zone,
        },
        item.color,
      );
    case "arc":
      return makeArc({
        ...item,
        from: {
          column: item.from.column,
          row: wrapSector(config, item.from.row),
          zone: item.from.zone,
        },
        to: {
          column: item.to.column,
          row: wrapSector(config, item.to.row),
          zone: item.to.zone,
        },
      });
    case "stroke":
      return makeStroke(
        item.points.map((point) =>
          linePoint(
            point.column,
            wrapSector(config, point.row),
            point.zone,
            point.anchor,
          ),
        ),
        item.closed ?? false,
        item.color,
      );
  }
}

function shiftedItem(
  config: ProjectConfig,
  item: CanvasItem,
  dColumn: number,
  dRow: number,
): CanvasItem {
  const moved = moveItem(item, dColumn, dRow);
  return config.gridType === "circular" ? wrapRows(config, moved) : moved;
}

/**
 * The listed items moved by `(dColumn, dRow)`, in their original order — the
 * moved **fragments only**, which is what a live preview paints over the board.
 * A commit needs the whole board, so use `moveItems` for one: a `ToolCommit`
 * is diffed against the document (`toOps`), and a list of fragments alone reads
 * as “delete everything else”.
 */
export function shiftSelection(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  keys: readonly string[],
  dColumn: number,
  dRow: number,
): CanvasItem[] {
  const wanted = new Set(keys);
  const moved: CanvasItem[] = [];
  for (const item of items) {
    if (wanted.has(item.key)) moved.push(shiftedItem(config, item, dColumn, dRow));
  }
  return moved;
}

/**
 * Moves the listed items by whole cells (clamped to the grid). Shape,
 * rotation, colour and the arc's direction/size are preserved; keys follow the
 * anchors. Moved items keep their relative order and land on top.
 */
export function moveItems(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  keys: readonly string[],
  dColumn: number,
  dRow: number,
): CanvasItem[] {
  const delta = clampDelta(config, items, keys, dColumn, dRow);
  if (delta.dColumn === 0 && delta.dRow === 0) return [...items];
  const wanted = new Set(keys);
  const rest: CanvasItem[] = [];
  const moved: CanvasItem[] = [];
  for (const item of items) {
    if (wanted.has(item.key)) {
      moved.push(shiftedItem(config, item, delta.dColumn, delta.dRow));
    } else {
      rest.push(item);
    }
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
  // Colour belongs to the fragment: every recoloured item stores a concrete
  // colour, so the document ink can change later without repainting the board.
  const resolved = color !== undefined && color.length > 0 ? color : config.ink;
  return items.map((item) => {
    if (!wanted.has(item.key)) return item;
    if (item.color === resolved) return item;
    return colorItem(item, resolved);
  });
}

/**
 * Applies a style patch to the listed items. Shape and rotation belong to
 * tiles; rounding belongs to tiles, line bars and polylines (an arc ignores
 * it); a border is one stroke around the whole shape for any item type, so
 * `{ border }` in a patch re-borders a line, a polyline or a rib just as well
 * as a tile.
 */
export function reshapeItems(
  items: readonly CanvasItem[],
  keys: readonly string[],
  patch: ItemStyle,
): CanvasItem[] {
  const wanted = new Set(keys);
  return items.map((item) =>
    wanted.has(item.key) ? styleItem(item, patch) : item,
  );
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
  if (delta.dColumn === 0 && delta.dRow === 0) {
    return { items: [...items], keys: [] };
  }
  const taken = new Set(items.map((item) => item.key));
  const copies: CanvasItem[] = [];
  const newKeys: string[] = [];
  for (const item of shiftSelection(
    config,
    items,
    keys,
    delta.dColumn,
    delta.dRow,
  )) {
    if (taken.has(item.key)) continue;
    taken.add(item.key);
    copies.push(item);
    newKeys.push(item.key);
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
/* Item builders shared by the tools                                   */
/* ------------------------------------------------------------------ */

/**
 * Arc between two endpoints, or `null` when the pair cannot carry one. The
 * endpoints travel whole — fragment *and* anchor — into the item, so the
 * preview and the click resolve to the same arc (`docs/CANVAS.md` §5).
 */
export function arcBetween(
  ctx: ToolContext,
  from: ArcPoint,
  to: ArcPoint,
): ArcItem | null {
  if (sameCell(from, to)) return null;
  if (!Arc.isSupported(from, to)) return null;
  return makeArc({
    from,
    to,
    direction: ctx.arc.direction,
    size: ctx.arc.size,
    border: ctx.style.border.width > 0 ? ctx.style.border : undefined,
    color: ctx.config.ink,
  });
}

/**
 * The run a line gesture holds, resolved for the point under the cursor.
 *
 * `preview` and a click both go through `lineRun`, so the ghost the overlay
 * paints and the run the click stores are the same list of points closed the
 * same way — the preview *is* the commit, not a copy of it.
 */
export interface LineRun {
  /** The points the run would store. */
  points: LinePoint[];
  /** Whether the run would be closed (`Z` in the path). */
  closed: boolean;
  /** Whether the hover finishes the run instead of extending it. */
  finished: boolean;
}

/**
 * Resolves a click sequence: the points so far plus the pending hover, exactly
 * as a click on that hover would commit them. The first click starts the run,
 * clicking the last point ends it (open), clicking the first one closes it;
 * anything else extends it. With no hover, the run is the points as they stand.
 *
 * This is the **only** place the line tool's rules live: `linePreview` calls it
 * to paint, the tool calls it to commit, so a preview can never show an
 * endpoint the commit does not draw (`docs/CANVAS.md` §6).
 */
export function lineRun(
  points: readonly LinePoint[],
  hover: LinePoint | null,
): LineRun {
  if (hover === null) return { points: [...points], closed: false, finished: false };
  const first = points[0];
  const last = points[points.length - 1];
  if (last === undefined) {
    return { points: [hover], closed: false, finished: false };
  }
  if (sameLinePoint(last, hover)) {
    return { points: [...points], closed: false, finished: true };
  }
  if (points.length >= 2 && first !== undefined && sameLinePoint(first, hover)) {
    return { points: [...points], closed: true, finished: true };
  }
  return { points: [...points, hover], closed: false, finished: false };
}

/**
 * Line-tool items for a run in flight. The run paints with the project ink
 * colour; the fragments keep their own copy of it, so later ink changes leave
 * the committed run alone.
 */
export function linePreview(
  config: ProjectConfig,
  points: readonly LinePoint[],
  hover: LinePoint | null,
  style: Pick<DrawStyle, "rounding" | "border"> = DEFAULT_STYLE,
): CanvasItem[] {
  const run = lineRun(points, hover);
  return lineItems(config, run.points, run.closed, undefined, style);
}

/* ------------------------------------------------------------------ */
/* The pen's stroke fill                                               */
/* ------------------------------------------------------------------ */

/* Anchor identity helpers used by the pen's de-duplication. */
export { anchorKey };

/** Integer cell of an anchor, or `null` when it is not a pair of numbers. */
function integerCell(anchor: Anchor): Cell | null {
  if (!Number.isFinite(anchor.column) || !Number.isFinite(anchor.row)) {
    return null;
  }
  return { column: Math.trunc(anchor.column), row: Math.trunc(anchor.row) };
}

/**
 * Every cell a straight drag from one anchor to another crosses, in path
 * order — the fill for the cells a fast pointer flew over between two reported
 * positions (docs/CANVAS.md §6, «Pen rules»).
 *
 * The start anchor is dropped, the target is included, and the cells in
 * between carry the target's zone. The walk is a **supercover** rasterisation
 * of the segment between the two cell centres: it advances one cell per
 * gridline the segment crosses, and a segment that passes exactly through a
 * cell corner reports *both* cells that share the corner — a diagonal stroke
 * stays edge-connected instead of only touching at the corners, which is what
 * would read as dotted at any `ratio < 1`.
 *
 * Identical cells yield nothing. On the circular grid the walk takes the
 * shortest way round the sectors and folds every row back into the ring. The
 * walk is capped at the grid's own cell count, so degenerate input
 * (non-finite coordinates, or cells far outside the board) terminates without
 * NaN instead of running away.
 */
export function anchorsAlongLine(
  config: ProjectConfig,
  from: Anchor,
  to: Anchor,
): Anchor[] {
  const start = integerCell(from);
  const end = integerCell(to);
  if (start === null || end === null) return [];
  const deltaColumn = end.column - start.column;
  const deltaRow =
    config.gridType === "circular"
      ? shortestSectorDelta(config, start.row, end.row)
      : end.row - start.row;
  if (deltaColumn === 0 && deltaRow === 0) return [];

  const stepColumn = Math.sign(deltaColumn);
  const stepRow = Math.sign(deltaRow);
  const spreadColumn = Math.abs(deltaColumn);
  const spreadRow = Math.abs(deltaRow);
  const side = maxGridIndex(config.base) + 1;
  const cap = side * side;
  const cells: Cell[] = [];
  let column = start.column;
  let row = start.row;

  if (spreadRow === 0) {
    for (let index = 1; index <= spreadColumn && cells.length < cap; index++) {
      cells.push({ column: start.column + index * stepColumn, row: start.row });
    }
  } else if (spreadColumn === 0) {
    for (let index = 1; index <= spreadRow && cells.length < cap; index++) {
      cells.push({ column: start.column, row: start.row + index * stepRow });
    }
  } else {
    // Both axes move, so walk gridline crossing by gridline crossing. Each
    // axis counts its own crossings (`1, 3, 5, …` half-steps); scaling each
    // counter by the other axis' span compares the two crossing positions in
    // exact integer arithmetic, so a corner crossing (`equal`) cannot be lost
    // to float drift.
    let nextColumn = 1;
    let nextRow = 1;
    while ((column !== end.column || row !== end.row) && cells.length < cap) {
      const columnAt = nextColumn * spreadRow;
      const rowAt = nextRow * spreadColumn;
      if (columnAt < rowAt) {
        column += stepColumn;
        nextColumn += 2;
        cells.push({ column, row });
      } else if (rowAt < columnAt) {
        row += stepRow;
        nextRow += 2;
        cells.push({ column, row });
      } else {
        // Exactly through the corner: report both cells that share it, then
        // the diagonal cell the segment continues into.
        cells.push({ column: column + stepColumn, row });
        cells.push({ column, row: row + stepRow });
        column += stepColumn;
        row += stepRow;
        nextColumn += 2;
        nextRow += 2;
        cells.push({ column, row });
      }
    }
  }

  const anchors: Anchor[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    const anchor: Anchor = {
      column: cell.column,
      row: config.gridType === "circular" ? wrapSector(config, cell.row) : cell.row,
      zone: to.zone,
    };
    // Identity is the anchor's key: a fragment is never listed twice, and the
    // wrap on the circular grid can fold two raw cells onto one.
    const id = anchorKey(anchor);
    if (seen.has(id)) continue;
    seen.add(id);
    anchors.push(anchor);
  }
  return anchors;
}

/* ------------------------------------------------------------------ */
/* Viewport: pan and zoom (the hand tool)                              */
/* ------------------------------------------------------------------ */

/**
 * The scroll fields the viewport helpers read and write. A real element
 * satisfies this, and so does a plain object in a test — the helpers stay
 * DOM-free like the rest of this module.
 */
export interface ScrollLike {
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
}

export interface ScrollOffset {
  left: number;
  top: number;
}

/**
 * Which way this container counts horizontal offsets.
 *
 * An RTL scroll container is the classic trap: `scrollLeft` is `0` at the
 * inline **start** (the right edge in Arabic), and the offset then runs either
 * positive (offsets measured from that start) or negative (the historical
 * Blink/Gecko behaviour). Instead of guessing, probe: `1` is only reachable
 * when the container counts upwards. The probe is undone before returning.
 */
export function horizontalScrollSign(view: ScrollLike): 1 | -1 {
  const restore = view.scrollLeft;
  view.scrollLeft = 1;
  const countsUp = view.scrollLeft > 0;
  view.scrollLeft = restore;
  return countsUp ? 1 : -1;
}

/**
 * The scroll offset that keeps the board under the hand: the board follows the
 * pointer, so a rightward drag subtracts the pointer's X delta from
 * `scrollLeft` — exactly as it does in LTR.
 *
 * `dir="rtl"` must not flip this. The scroller there counts `scrollLeft` from
 * the inline-start (right) edge towards negative values, but a browser always
 * moves the content opposite to `scrollLeft`: dragging right decreases the
 * offset, which in RTL means going deeper into its negative range rather than
 * towards zero. A direction argument would only be needed for the historical
 * "reverse" offset model (offsets counted up towards the inline-end), which no
 * live browser reports and `horizontalScrollSign` cannot tell apart from the
 * positive-descending one — so the arithmetic is deliberately convention-free
 * and stays correct everywhere. The vertical axis never flips.
 */
export function panScrollOffset(
  start: ScrollOffset,
  from: Point,
  to: Point,
): ScrollOffset {
  return {
    left: start.left - (to.x - from.x),
    top: start.top - (to.y - from.y),
  };
}

/** Nice zoom stops, covering the whole range the prefs allow (0.1 … 32). */
export const ZOOM_STOPS: readonly number[] = [
  0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32,
];

/**
 * The next zoom stop in `direction` (`1` zooms in, `-1` zooms out), limited to
 * `[min, max]` and clamped at both ends, so a stale stored zoom cannot walk
 * outside the range: a value between stops snaps to the neighbouring stop and
 * a value outside the range snaps to the nearest bound.
 */
export function nextZoom(
  current: number,
  direction: 1 | -1,
  min: number,
  max: number,
): number {
  const stops = ZOOM_STOPS.filter((stop) => stop >= min && stop <= max);
  if (direction > 0) {
    return stops.find((stop) => stop > current) ?? max;
  }
  for (let index = stops.length - 1; index >= 0; index--) {
    if (stops[index] < current) return stops[index];
  }
  return min;
}

/** The zoom readout as a whole percentage (`0.1` → `10`, `1.5` → `150`). */
export function zoomPercent(zoom: number): number {
  return Math.round(zoom * 100);
}

/* Wheel delta normalisation (plain-wheel zoom). */

/** Pixels of wheel travel that count as one stop on the zoom ladder. */
const WHEEL_NOTCH_PX = 60;
/** A `deltaMode 1` (lines) delta, in pixels — Firefox sends ~3 per notch. */
const WHEEL_LINE_PX = 16;
/** A `deltaMode 2` (pages) delta, in pixels. */
const WHEEL_PAGE_PX = 100;

/**
 * Quiet period that ends a wheel **gesture**: events closer together than this
 * belong to one scroll. 100 ms sits above the repeat interval of a notched
 * mouse being spun (~50–80 ms) and below the pause between two deliberate
 * scrolls, so «one scroll» and «one gesture» line up on every device.
 */
export const WHEEL_GESTURE_GAP_MS = 100;

/**
 * Stops one gesture may walk. The ladder has 15 stops; 4 (1× → 4×) is a
 * visible but still-reversible change, while a free-spinning wheel streaming
 * events would otherwise cross the whole range in one flick.
 */
export const WHEEL_GESTURE_MAX_STOPS = 4;

/** The wheel's carry-over between the events of one gesture. */
export interface WheelGesture {
  /** Pixels banked towards the next stop (unsigned) since the last one. */
  pending: number;
  /** Which way the gesture travels (`0` before it has seen any travel). */
  direction: -1 | 0 | 1;
  /** Stops the gesture has already walked (counted against the cap). */
  spent: number;
  /** Clock reading of the previous event, or `null` before the first. */
  lastAt: number | null;
}

/** A gesture that has seen no events. */
export const WHEEL_IDLE: WheelGesture = {
  pending: 0,
  direction: 0,
  spent: 0,
  lastAt: null,
};

/** One wheel event, normalised: its stops plus the gesture it leaves behind. */
export interface WheelStep extends WheelGesture {
  /** Whole stops this event carries, signed like `deltaY`. */
  steps: number;
  /** Whether this event began a gesture (a quiet gap, a flip, or the first). */
  began: boolean;
}

/**
 * Turns one wheel event into whole stops, gesture-aware.
 *
 * A **gesture** is a run of events with no quiet gap longer than
 * `WHEEL_GESTURE_GAP_MS`, all travelling the same way. Its first event walks
 * **exactly one stop**, whatever its size or `deltaMode` — the acceptance
 * criterion is that one scroll *visibly* zooms, and a pixel threshold cannot
 * promise that: Firefox's 3-line notch is 48 px and a Linux trackpad event
 * ~53 px, both under the 60 px stop, so banking alone left them doing nothing.
 *
 * Events continuing the gesture bank their pixels towards further stops (the
 * raw delta is in the event's unit: lines ×16, pages ×100), but the gesture
 * walks at most `WHEEL_GESTURE_MAX_STOPS` stops in total. A **direction flip
 * starts a fresh gesture**: its bank can never cancel the first stop of the
 * other way, and the flip itself still walks its guaranteed stop.
 *
 * The clock is injected (`now`, the same source as `lastAt`); a reading that is
 * not usable (NaN, or a clock that went backwards) counts as a quiet gap,
 * because a fresh guarantee is the safe side. An event with no travel (0, or
 * non-finite) is not input: it neither steps nor splits the gesture.
 */
export function wheelSteps(
  state: WheelGesture,
  deltaY: number,
  deltaMode: number,
  now: number,
): WheelStep {
  const unit =
    deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? WHEEL_PAGE_PX : 1;
  const pixels = deltaY * unit;
  if (!Number.isFinite(pixels) || pixels === 0) {
    return { ...state, steps: 0, began: false };
  }
  const direction: 1 | -1 = pixels > 0 ? 1 : -1;
  const travel = Math.abs(pixels);
  const gap =
    state.lastAt === null ? Number.POSITIVE_INFINITY : now - state.lastAt;
  const ongoing =
    gap >= 0 && gap < WHEEL_GESTURE_GAP_MS && state.direction === direction;
  if (!ongoing) {
    // One stop, whatever the magnitude — and only one: the guarantee is the
    // visible answer to the user's scroll, not a licence to leap the ladder.
    return {
      pending: Math.max(0, travel - WHEEL_NOTCH_PX),
      direction,
      spent: 1,
      lastAt: now,
      steps: direction,
      began: true,
    };
  }
  const total = state.pending + travel;
  const wanted = Math.trunc(total / WHEEL_NOTCH_PX);
  const budget = Math.max(0, WHEEL_GESTURE_MAX_STOPS - state.spent);
  const taken = Math.min(wanted, budget);
  return {
    // The uncapped remainder, so the bank stays a sub-stop fraction even when
    // the cap suppressed the stops the pixels would have bought.
    pending: total - wanted * WHEEL_NOTCH_PX,
    direction,
    spent: state.spent + taken,
    lastAt: now,
    // `|| 0` folds -0 into 0: a zero-stop event has no direction.
    steps: direction * taken || 0,
    began: false,
  };
}

/**
 * The scroll offset that keeps `anchor` — a board fraction (0…1 of the
 * viewBox) that sat under `focus` before a zoom — under that same point after
 * the surface has the new size.
 *
 * `focus` is a client-space point: a wheel notch passes the **pointer** it
 * landed on, while the ± buttons omit it so the **middle of the pane** stays
 * put (they are not on the canvas, so there is no pointer to anchor). The
 * inputs are the *measured* live rects (taken after the new size is laid out
 * but before the scroll is moved) plus the current offset, so the maths also
 * survives the browser clamping the old offset while the range changed, and it
 * needs no knowledge of padding, the `m-auto` centring, or the horizontal
 * convention: a scroll container always moves its content opposite to
 * `scrollLeft`, in `dir="rtl"` exactly as in LTR (docs/CANVAS.md §6).
 */
export function zoomScrollOffset(
  start: ScrollOffset,
  surface: ClientRect,
  pane: ClientRect,
  anchor: Point,
  focus?: Point,
): ScrollOffset {
  const focusX = focus?.x ?? pane.left + pane.width / 2;
  const focusY = focus?.y ?? pane.top + pane.height / 2;
  const targetLeft = focusX - anchor.x * surface.width;
  const targetTop = focusY - anchor.y * surface.height;
  return {
    left: start.left + (surface.left - targetLeft),
    top: start.top + (surface.top - targetTop),
  };
}

/**
 * Centres the scrolled content — the middle of the reachable range, on the side
 * this container counts towards (see `horizontalScrollSign`), so the hand
 * tool's double click recentres the board in any browser.
 */
export function centreScroll(view: ScrollLike): void {
  const sign = horizontalScrollSign(view);
  const rangeX = Math.max(0, view.scrollWidth - view.clientWidth);
  const rangeY = Math.max(0, view.scrollHeight - view.clientHeight);
  view.scrollLeft = (sign * rangeX) / 2;
  view.scrollTop = rangeY / 2;
}

/* ------------------------------------------------------------------ */
/* Value comparison helpers                                            */
/* ------------------------------------------------------------------ */

/** Stable projection of an item (change detection / server reconciliation). */
export function itemSignature(item: CanvasItem): string {
  return signatureOf(item);
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
    a.circularSectors === b.circularSectors &&
    a.ink === b.ink &&
    a.background === b.background &&
    a.showGrid === b.showGrid &&
    a.straightLinesAsSquares === b.straightLinesAsSquares
  );
}

const PROJECT_ID_PATTERN = /^[a-z0-9]{12,64}$/;

/** Whether a URL segment can be a Convex document id (garbage → “not found”). */
export function isProjectId(value: string): boolean {
  return PROJECT_ID_PATTERN.test(value);
}

/** Handy for callers that need an ink centre. */
export { cellCentre };

/** Re-exported for the editor UI (keeps imports in one place). */
export type {
  Anchor,
  ArcDirection,
  ArcSize,
  CanvasItem,
  Cell,
  ProjectConfig,
  Rotation,
  ShapeId,
};
