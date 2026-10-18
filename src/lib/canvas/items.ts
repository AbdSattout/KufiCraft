/**
 * KufiCraft — canvas items as classes.
 *
 * Every item is a subclass of `KufiItem`. A class owns three things and shares
 * them with **every** renderer in the app (canvas, overlay, toolbar icon, SVG
 * string export, `.kuficraft` file):
 *
 *   • `render(config)`  — the path to draw and how to paint it;
 *   • `bounds`/`contains`/`cellRange` — the geometry the editor needs;
 *   • `toJSON()` — the exact JSON that is stored (`docs/FORMAT.md`), with the
 *     same class rebuilt by `itemOf`.
 *
 * The JSON is the transport format (Convex documents, `.kuficraft` files), so
 * the editor keeps plain objects in React state and wraps them through
 * `itemOf`, which memoises per object identity — items that a gesture did not
 * touch keep their object identity (see `ops.ts`), so the wrap is free.
 *
 * Geometry that the classes share with the grid/tooling lives in `geometry.ts`;
 * the pen's shape palette lives in `shapes.ts`.
 */

import {
  DEFAULT_PROJECT_CONFIG,
  arcKey,
  cellSize,
  compareCells,
  lineKey,
  sanitizeBorder,
  sanitizeRounding,
  strokeKey,
  tileKey,
} from "./model";
import type {
  ArcDirection,
  ArcItem,
  ArcSize,
  CanvasItem,
  CanvasItemType,
  Cell,
  ItemBorder,
  ItemRounding,
  LineItem,
  ProjectConfig,
  Rotation,
  ShapeId,
  StrokeItem,
  TileItem,
  Zone,
} from "./model";
import {
  A,
  L,
  M,
  Z,
  CENTER,
  arcCentre,
  boundsOfPoints,
  circularSlice,
  cmdsToPath,
  distanceToArc,
  distanceToPolyline,
  expandRect,
  inkUnit,
  polar,
  rectContains,
  sectorPath,
  shortestSectorDelta,
  sectorSpan,
  slicePath,
  unionRect,
  zoneRect,
} from "./geometry";
import type { CircularSlice, PathCmd, Point, Rect } from "./geometry";
import { borderOutline } from "./border";
import { cellCentre } from "./grid";
import { roundingRadius } from "./rounding";
import { shapeById, shapePath } from "./shapes";

/* ------------------------------------------------------------------ */
/* Shared vocabulary                                                   */
/* ------------------------------------------------------------------ */

/**
 * How a path is painted: a filled shape or a stroked line of ink width.
 */
export interface Rendered {
  path: string;
  mode: "fill" | "stroke";
  /** Stroke width in viewBox units (0 for fills). */
  width: number;
  /**
   * The item's outside border, when it carries one (`draw`, not `render`).
   * Drawn **before** the item's own path so ink always wins over a border.
   */
  outline?: RenderedOutline;
}

/** A border ready to paint: path, stroke width and resolved colour. */
export interface RenderedOutline {
  path: string;
  /** Stroke width in viewBox units (always `> 0`). */
  width: number;
  color: string;
}

/** Inclusive cell extent of an item — used to clamp a selection move. */
export interface CellRange {
  minColumn: number;
  maxColumn: number;
  minRow: number;
  maxRow: number;
}

/**
 * Style patch applied to an item. Shape and rotation are the tile's own; a
 * border is a stroke outside **any** item. `null` clears a field, `undefined`
 * leaves it alone.
 */
export interface ItemStyle {
  shape?: ShapeId;
  rotation?: Rotation;
  rounding?: ItemRounding | null;
  border?: ItemBorder | null;
}

/** `rect ∪ rect` for the empty case. */
function rectFrom(points: readonly Point[], pad: number): Rect {
  return expandRect(boundsOfPoints(points), pad);
}

/** Bounding box of an annular sector (corners + any cardinal angle inside). */
export function sliceBounds(slice: CircularSlice): Rect {
  const { cx, cy, r1, r2, a1, a2 } = slice;
  const points: Point[] = [
    polar(cx, cy, r1, a1),
    polar(cx, cy, r2, a1),
    polar(cx, cy, r1, a2),
    polar(cx, cy, r2, a2),
  ];
  for (let quarter = 0; quarter < 4; quarter++) {
    const angle = (quarter * Math.PI) / 2;
    const delta = a2 - a1;
    const offset = (((angle - a1) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (offset <= Math.abs(delta) + 1e-9) {
      points.push(polar(cx, cy, r1, angle), polar(cx, cy, r2, angle));
    }
  }
  return boundsOfPoints(points);
}

/* ------------------------------------------------------------------ */
/* The parent class                                                    */
/* ------------------------------------------------------------------ */

export abstract class KufiItem {
  abstract readonly type: CanvasItemType;

  /** Identity: two items with the same key are the same item. */
  abstract get key(): string;

  /** The colour override, if the item carries one. */
  readonly color?: string;

  /** The outside border, if the item carries one (any item type can). */
  readonly border?: ItemBorder;

  abstract toJSON(): CanvasItem;

  /** The item's **own** paint, without its border, in viewBox units. */
  abstract render(config: ProjectConfig): Rendered;

  /**
   * What a renderer paints for this item: the outside border first (so the
   * item's ink always wins), then the item's own path. This is the entry point
   * of every renderer; `render` is for callers that want the shape alone
   * (selection rings, toolbar icons).
   */
  draw(config: ProjectConfig): Rendered {
    const rendered = this.render(config);
    const border = this.border;
    if (border === undefined) return rendered;
    const outline = borderOutline(
      this.bounds(config),
      border,
      this.resolvedColor(config),
    );
    return outline === undefined ? rendered : { ...rendered, outline };
  }

  abstract bounds(config: ProjectConfig): Rect;

  abstract contains(config: ProjectConfig, point: Point): boolean;

  abstract cellRange(): CellRange;

  /** The same item shifted by whole cells (keys are derived, so they follow). */
  abstract moved(columns: number, rows: number): KufiItem;

  /** Colour override; `undefined` returns the item to the config ink. */
  withColor(color: string | undefined): KufiItem {
    void color;
    return this;
  }

  /**
   * Style patch; each item type applies the fields it has — shape, rotation and
   * rounding belong to tiles, a border to every type. The default is a no-op,
   * and a subclass that has nothing to change returns itself (so a patch that
   * does not concern an item keeps its object identity).
   */
  withStyle(style: ItemStyle): KufiItem {
    void style;
    return this;
  }

  /** Resolved paint colour. */
  resolvedColor(config: ProjectConfig): string {
    return this.color ?? config.ink;
  }
}

/* ------------------------------------------------------------------ */
/* Tile                                                                */
/* ------------------------------------------------------------------ */

export interface TileInit {
  column: number;
  row: number;
  zone: Zone;
  shape?: ShapeId;
  rotation?: Rotation;
  rounding?: ItemRounding;
  border?: ItemBorder;
  color?: string;
}

/** One zone fragment of one cell, painted with one shape. */
export class Tile extends KufiItem {
  readonly type = "tile" as const;
  readonly column: number;
  readonly row: number;
  readonly zone: Zone;
  readonly shape?: ShapeId;
  readonly rotation?: Rotation;
  readonly rounding?: ItemRounding;
  readonly border?: ItemBorder;
  readonly color?: string;

  constructor(init: TileInit) {
    super();
    this.column = init.column;
    this.row = init.row;
    this.zone = init.zone;
    this.shape = init.shape;
    this.rotation = init.rotation;
    this.rounding = init.rounding;
    this.border = init.border;
    this.color = init.color;
  }

  get key(): string {
    return tileKey(this.column, this.row, this.zone);
  }

  toJSON(): TileItem {
    const item: TileItem = {
      type: "tile",
      key: this.key,
      column: this.column,
      row: this.row,
      zone: this.zone,
    };
    if (this.shape !== undefined && this.shape !== "square") item.shape = this.shape;
    if (this.rotation !== undefined && this.rotation !== 0) item.rotation = this.rotation;
    if (this.rounding !== undefined && this.rounding.radius > 0) {
      item.rounding = this.rounding;
    }
    if (this.border !== undefined) item.border = this.border;
    if (this.color !== undefined) item.color = this.color;
    return item;
  }

  render(config: ProjectConfig): Rendered {
    if (config.gridType === "circular") {
      return { path: this.circularPath(config), mode: "fill", width: 0 };
    }
    const box = zoneRect(config, this.column, this.row, this.zone);
    return {
      path: shapePath(this.shape, box, this.rotation ?? 0, this.rounding),
      mode: "fill",
      width: 0,
    };
  }

  /**
   * Circular fragment: the zone fragment *is* an annular sector, so the square
   * shape renders as one (and has no corners to round — the sector's own
   * corners are grid geometry, not the shape's box). Other shapes are fitted
   * into the slice's radial/tangential frame, which keeps the palette usable on
   * a polar grid; their corners are rounded in that local frame.
   */
  private circularPath(config: ProjectConfig): string {
    const slice = circularSlice(config, this.column, this.row, this.zone);
    if (shapeById(this.shape).id === "square" && (this.rotation ?? 0) % 4 === 0) {
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
    const radius = roundingRadius(this.rounding, w, h);
    return shapeById(this.shape).inFrame(
      w,
      h,
      this.rotation ?? 0,
      {
        cos,
        sin,
        ox: px - (w / 2) * cos + (h / 2) * sin,
        oy: py - (w / 2) * sin - (h / 2) * cos,
      },
      (aMid * 180) / Math.PI,
      radius > 0 && this.rounding !== undefined
        ? { radius, corners: this.rounding.corners }
        : undefined,
    );
  }

  bounds(config: ProjectConfig): Rect {
    if (config.gridType === "circular") {
      return sliceBounds(circularSlice(config, this.column, this.row, this.zone));
    }
    return zoneRect(config, this.column, this.row, this.zone);
  }

  contains(config: ProjectConfig, point: Point): boolean {
    if (config.gridType === "circular") {
      const slice = circularSlice(config, this.column, this.row, this.zone);
      const dx = point.x - slice.cx;
      const dy = point.y - slice.cy;
      const distance = Math.hypot(dx, dy);
      if (distance < slice.r1 || distance > slice.r2) return false;
      if (slice.r2 === 0) return false;
      let angle = Math.atan2(dy, dx);
      while (angle < slice.a1) angle += 2 * Math.PI;
      return angle <= slice.a2 + 1e-9;
    }
    return rectContains(zoneRect(config, this.column, this.row, this.zone), point);
  }

  cellRange(): CellRange {
    return {
      minColumn: this.column,
      maxColumn: this.column,
      minRow: this.row,
      maxRow: this.row,
    };
  }

  moved(columns: number, rows: number): Tile {
    return new Tile({
      column: this.column + columns,
      row: this.row + rows,
      zone: this.zone,
      shape: this.shape,
      rotation: this.rotation,
      rounding: this.rounding,
      border: this.border,
      color: this.color,
    });
  }

  withColor(color: string | undefined): Tile {
    return new Tile({
      column: this.column,
      row: this.row,
      zone: this.zone,
      shape: this.shape,
      rotation: this.rotation,
      rounding: this.rounding,
      border: this.border,
      color,
    });
  }

  withStyle(style: ItemStyle): Tile {
    const shape = style.shape ?? this.shape;
    const rotation = style.rotation ?? this.rotation;
    const rounding =
      style.rounding === undefined ? this.rounding : (style.rounding ?? undefined);
    const border =
      style.border === undefined ? this.border : (style.border ?? undefined);
    if (
      shape === this.shape &&
      rotation === this.rotation &&
      sameRounding(rounding, this.rounding) &&
      sameBorder(border, this.border)
    ) {
      return this;
    }
    return new Tile({
      column: this.column,
      row: this.row,
      zone: this.zone,
      shape,
      rotation,
      rounding,
      border,
      color: this.color,
    });
  }
}

/** Value equality of two rounding settings (`undefined` = square corners). */
export function sameRounding(
  a: ItemRounding | undefined,
  b: ItemRounding | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.radius === b.radius && a.corners === b.corners;
}

/** Value equality of two borders (`undefined` = none). */
export function sameBorder(
  a: ItemBorder | undefined,
  b: ItemBorder | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.sides === b.sides && a.width === b.width && a.color === b.color;
}

/* ------------------------------------------------------------------ */
/* Line                                                                */
/* ------------------------------------------------------------------ */

export interface LineInit {
  from: Cell;
  to: Cell;
  border?: ItemBorder;
  color?: string;
}

/**
 * An axis-aligned run of ink cells drawn as **one bar of ink thickness** —
 * the old line tool's two-point case. The old app emitted the bar as a run of
 * ink/space fragments; the union of those fragments is exactly this rectangle,
 * and one item is easier to erase and cheaper to store.
 */
export class Line extends KufiItem {
  readonly type = "line" as const;
  readonly from: Cell;
  readonly to: Cell;
  readonly border?: ItemBorder;
  readonly color?: string;

  constructor(init: LineInit) {
    super();
    const [from, to] =
      compareCells(init.from, init.to) <= 0
        ? [init.from, init.to]
        : [init.to, init.from];
    this.from = from;
    this.to = to;
    this.border = init.border;
    this.color = init.color;
  }

  get key(): string {
    return lineKey(this.from, this.to);
  }

  toJSON(): LineItem {
    const item: LineItem = {
      type: "line",
      key: this.key,
      from: this.from,
      to: this.to,
    };
    if (this.border !== undefined) item.border = this.border;
    if (this.color !== undefined) item.color = this.color;
    return item;
  }

  /** The bar rectangle on a square grid (ink thick, anchored at the ink edge). */
  bar(config: ProjectConfig): Rect {
    const base = cellSize(config);
    const ink = inkUnit(config);
    if (this.from.row === this.to.row) {
      const min = Math.min(this.from.column, this.to.column);
      const max = Math.max(this.from.column, this.to.column);
      return {
        x: min * base,
        y: this.from.row * base,
        w: (max - min) * base + ink,
        h: ink,
      };
    }
    const min = Math.min(this.from.row, this.to.row);
    const max = Math.max(this.from.row, this.to.row);
    return {
      x: this.from.column * base,
      y: min * base,
      w: ink,
      h: (max - min) * base + ink,
    };
  }

  render(config: ProjectConfig): Rendered {
    if (config.gridType === "circular") {
      return { path: this.circularPath(config), mode: "fill", width: 0 };
    }
    if (this.from.row === this.to.row || this.from.column === this.to.column) {
      return { path: rectToPath(this.bar(config)), mode: "fill", width: 0 };
    }
    // Not a straight run (invalid item): join the two cell centres.
    const p1 = cellCentre(config, this.from);
    const p2 = cellCentre(config, this.to);
    return {
      path: cmdsToPath([M(p1.x, p1.y), L(p2.x, p2.y)]),
      mode: "stroke",
      width: inkUnit(config),
    };
  }

  private circularPath(config: ProjectConfig): string {
    const base = cellSize(config);
    const minBand = Math.min(this.from.column, this.to.column);
    const maxBand = Math.max(this.from.column, this.to.column);
    const unit = (2 * Math.PI) / 36;
    const a1 = this.from.row * unit;
    return sectorPath(
      CENTER,
      CENTER,
      minBand * base,
      (maxBand + 1) * base,
      a1,
      a1 + sectorSpan(this.from.row, this.to.row) * unit,
    );
  }

  bounds(config: ProjectConfig): Rect {
    if (config.gridType === "circular") return this.circularBounds(config);
    if (this.from.row === this.to.row || this.from.column === this.to.column) {
      return this.bar(config);
    }
    return rectFrom(
      [cellCentre(config, this.from), cellCentre(config, this.to)],
      inkUnit(config) / 2,
    );
  }

  private circularBounds(config: ProjectConfig): Rect {
    const base = cellSize(config);
    const minBand = Math.min(this.from.column, this.to.column);
    const maxBand = Math.max(this.from.column, this.to.column);
    const unit = (2 * Math.PI) / 36;
    const a1 = this.from.row * unit;
    return sliceBounds({
      cx: CENTER,
      cy: CENTER,
      r1: minBand * base,
      r2: (maxBand + 1) * base,
      a1,
      a2: a1 + sectorSpan(this.from.row, this.to.row) * unit,
    });
  }

  contains(config: ProjectConfig, point: Point): boolean {
    if (this.from.row === this.to.row || this.from.column === this.to.column) {
      const tolerance = inkUnit(config) / 2;
      return rectContains(expandRect(this.bounds(config), tolerance), point);
    }
    return rectContains(this.bounds(config), point);
  }

  cellRange(): CellRange {
    return {
      minColumn: Math.min(this.from.column, this.to.column),
      maxColumn: Math.max(this.from.column, this.to.column),
      minRow: Math.min(this.from.row, this.to.row),
      maxRow: Math.max(this.from.row, this.to.row),
    };
  }

  moved(columns: number, rows: number): Line {
    return new Line({
      from: { column: this.from.column + columns, row: this.from.row + rows },
      to: { column: this.to.column + columns, row: this.to.row + rows },
      border: this.border,
      color: this.color,
    });
  }

  withColor(color: string | undefined): Line {
    return new Line({
      from: this.from,
      to: this.to,
      border: this.border,
      color,
    });
  }

  /** A line has no shape or rounding; a border is the one style it can carry. */
  withStyle(style: ItemStyle): Line {
    if (style.border === undefined || sameBorder(style.border ?? undefined, this.border)) {
      return this;
    }
    return new Line({
      from: this.from,
      to: this.to,
      border: style.border ?? undefined,
      color: this.color,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Stroke                                                              */
/* ------------------------------------------------------------------ */

export interface StrokeInit {
  points: Cell[];
  closed?: boolean;
  border?: ItemBorder;
  color?: string;
}

/**
 * A multi-point polyline — the old line tool's diagonal / many-point case.
 * Drawn as a **stroked** path of ink width through the cell ink centres; the
 * first and last points are pushed half an ink square outwards along an
 * axis-aligned end segment so a straight end reaches the fragment edge,
 * exactly like the reference implementation.
 */
export class Stroke extends KufiItem {
  readonly type = "stroke" as const;
  readonly points: readonly Cell[];
  readonly closed: boolean;
  readonly border?: ItemBorder;
  readonly color?: string;

  constructor(init: StrokeInit) {
    super();
    this.points = init.points;
    this.closed = init.closed ?? false;
    this.border = init.border;
    this.color = init.color;
  }

  get key(): string {
    return strokeKey(this.points, this.closed);
  }

  toJSON(): StrokeItem {
    const item: StrokeItem = {
      type: "stroke",
      key: this.key,
      points: this.points.map((cell) => ({ column: cell.column, row: cell.row })),
    };
    if (this.closed) item.closed = true;
    if (this.border !== undefined) item.border = this.border;
    if (this.color !== undefined) item.color = this.color;
    return item;
  }

  render(config: ProjectConfig): Rendered {
    const points = this.anchorPoints(config);
    if (points.length < 2) return { path: "", mode: "stroke", width: inkUnit(config) };
    const cmds: PathCmd[] = [M(points[0].x, points[0].y)];
    for (let index = 1; index < points.length; index++) {
      cmds.push(L(points[index].x, points[index].y));
    }
    if (this.closed) cmds.push(Z);
    return {
      path: cmdsToPath(cmds),
      mode: "stroke",
      width: inkUnit(config),
    };
  }

  /** Cell centres, with the reference implementation's end nudges. */
  anchorPoints(config: ProjectConfig): Point[] {
    const ink = inkUnit(config);
    const centres = this.points.map((cell) => cellCentre(config, cell));
    if (centres.length < 2) return centres;
    const last = centres.length - 1;
    return centres.map((point, index) => {
      if (this.closed) return point;
      if (index !== 0 && index !== last) return point;
      const previous = centres[index === 0 ? index : index - 1];
      const next = centres[index === 0 ? index + 1 : index];
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const out = expandRect(
        { x: point.x, y: point.y, w: 0, h: 0 },
        ink / 2,
      );
      if (dx !== 0 && dy === 0) {
        return {
          x: dx > 0
            ? (index === 0 ? out.x : out.x + out.w)
            : (index === 0 ? out.x + out.w : out.x),
          y: point.y,
        };
      }
      if (dy !== 0 && dx === 0) {
        return {
          x: point.x,
          y: dy > 0
            ? (index === 0 ? out.y : out.y + out.h)
            : (index === 0 ? out.y + out.h : out.y),
        };
      }
      return point;
    });
  }

  bounds(config: ProjectConfig): Rect {
    return rectFrom(this.anchorPoints(config), inkUnit(config) / 2);
  }

  contains(config: ProjectConfig, point: Point): boolean {
    const points = this.anchorPoints(config);
    return (
      distanceToPolyline(point, points, this.closed) <= inkUnit(config) / 2 + 1e-9
    );
  }

  cellRange(): CellRange {
    return cellRangeOf(this.points);
  }

  moved(columns: number, rows: number): Stroke {
    return new Stroke({
      points: this.points.map((cell) => ({
        column: cell.column + columns,
        row: cell.row + rows,
      })),
      closed: this.closed,
      border: this.border,
      color: this.color,
    });
  }

  withColor(color: string | undefined): Stroke {
    return new Stroke({
      points: [...this.points],
      closed: this.closed,
      border: this.border,
      color,
    });
  }

  /** A polyline has no shape or rounding; a border is its one style field. */
  withStyle(style: ItemStyle): Stroke {
    if (style.border === undefined || sameBorder(style.border ?? undefined, this.border)) {
      return this;
    }
    return new Stroke({
      points: [...this.points],
      closed: this.closed,
      border: style.border ?? undefined,
      color: this.color,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Arc                                                                 */
/* ------------------------------------------------------------------ */

export interface ArcInit {
  from: Cell;
  to: Cell;
  direction: ArcDirection;
  size: ArcSize;
  border?: ItemBorder;
  color?: string;
}

/** The endpoint geometry of a square-grid arc, before it becomes a path. */
export interface ArcGeometry {
  start: Point;
  end: Point;
  radius: number;
  largeArc: 0 | 1;
  sweep: 0 | 1;
}

/**
 * A rib (قوس) between two ink cells. The geometry is the old app's, ported
 * exactly (`kufi.js:285‑311` and `radius()`), but derived from a **canonical**
 * cell order so the result no longer depends on which anchor was clicked
 * first; the click-order quirk became the explicit `direction` control.
 */
export class Arc extends KufiItem {
  readonly type = "arc" as const;
  readonly from: Cell;
  readonly to: Cell;
  readonly direction: ArcDirection;
  readonly size: ArcSize;
  readonly border?: ItemBorder;
  readonly color?: string;

  constructor(init: ArcInit) {
    super();
    const [from, to] =
      compareCells(init.from, init.to) <= 0
        ? [init.from, init.to]
        : [init.to, init.from];
    this.from = from;
    this.to = to;
    this.direction = init.direction;
    this.size = init.size;
    this.border = init.border;
    this.color = init.color;
  }

  get key(): string {
    return arcKey(this.from, this.to, this.direction, this.size);
  }

  toJSON(): ArcItem {
    const item: ArcItem = {
      type: "arc",
      key: this.key,
      from: this.from,
      to: this.to,
      direction: this.direction,
      size: this.size,
    };
    if (this.border !== undefined) item.border = this.border;
    if (this.color !== undefined) item.color = this.color;
    return item;
  }

  /** True when the two cells can carry an arc (same row/column, or 45°). */
  static isSupported(from: Cell, to: Cell): boolean {
    const dColumn = Math.abs(from.column - to.column);
    const dRow = Math.abs(from.row - to.row);
    if (dColumn === 0 && dRow === 0) return false;
    if (dColumn === 0 || dRow === 0) return true;
    return dColumn === dRow;
  }

  geometry(config: ProjectConfig): ArcGeometry {
    const base = cellSize(config);
    const ink = inkUnit(config);
    const clockwise = this.direction === "clockwise";
    const sweep: 0 | 1 = clockwise ? 1 : 0;
    const x1 = this.from.column * base;
    const y1 = this.from.row * base;
    const x2 = this.to.column * base;
    const y2 = this.to.row * base;
    const half = ink / 2;
    let start: Point;
    let end: Point;

    if (this.from.row === this.to.row) {
      // Horizontal chord: clockwise springs off the bottom edge and rises.
      const y = y1 + (clockwise ? ink : 0);
      start = { x: x1 + half, y };
      end = { x: x2 + half, y };
    } else if (this.from.column === this.to.column) {
      // Vertical chord: clockwise springs off the left edge and turns right.
      const x = x1 + (clockwise ? 0 : ink);
      start = { x, y: y1 + half };
      end = { x, y: y2 + half };
    } else {
      // 45° diagonal, canonical by column (`to` is right of `from`).
      const down = this.to.row > this.from.row;
      if (clockwise) {
        start = down
          ? { x: x1, y: y1 + half }
          : { x: x1 + half, y: y1 + ink };
        end = down
          ? { x: x2 + half, y: y2 + ink }
          : { x: x2 + ink, y: y2 + half };
      } else {
        start = down
          ? { x: x1 + half, y: y1 }
          : { x: x1, y: y1 + half };
        end = down
          ? { x: x2 + ink, y: y2 + half }
          : { x: x2 + half, y: y2 };
      }
    }

    const chord = Math.hypot(end.x - start.x, end.y - start.y);
    const diagonal =
      this.from.row !== this.to.row && this.from.column !== this.to.column;
    const dColumn = Math.abs(this.to.column - this.from.column);
    const radius =
      this.size === "threeQuarter"
        ? chord / Math.SQRT2
        : diagonal
          ? dColumn * base + ink / 2
          : chord / 2;
    const largeArc: 0 | 1 = this.size === "threeQuarter" ? 1 : 0;
    return { start, end, radius, largeArc, sweep };
  }

  render(config: ProjectConfig): Rendered {
    if (config.gridType === "circular") {
      return { path: this.circularPath(config), mode: "stroke", width: inkUnit(config) };
    }
    const { start, end, radius, largeArc, sweep } = this.geometry(config);
    return {
      path: cmdsToPath([
        M(start.x, start.y),
        A(radius, radius, largeArc, sweep, end.x, end.y),
      ]),
      mode: "stroke",
      width: inkUnit(config),
    };
  }

  private circularPath(config: ProjectConfig): string {
    const base = cellSize(config);
    const unit = (2 * Math.PI) / 36;
    const r1 = (this.from.column + 0.5) * base;
    const r2 = (this.to.column + 0.5) * base;
    const a1 = (this.from.row + 0.5) * unit;
    const delta = shortestSectorDelta(this.from.row, this.to.row);
    const p1 = polar(CENTER, CENTER, r1, a1);
    const p2 = polar(CENTER, CENTER, r2, a1 + delta * unit);
    const radius = (r1 + r2) / 2;
    return cmdsToPath([
      M(p1.x, p1.y),
      A(radius, radius, 0, this.direction === "clockwise" ? 1 : 0, p2.x, p2.y),
    ]);
  }

  bounds(config: ProjectConfig): Rect {
    if (config.gridType === "circular") {
      const points: Point[] = [];
      const base = cellSize(config);
      for (let step = 0; step <= 8; step++) {
        const t = step / 8;
        const unit = (2 * Math.PI) / 36;
        const r = (this.from.column + 0.5) * base +
          (this.to.column - this.from.column) * base * t;
        const a = ((this.from.row + 0.5) + shortestSectorDelta(this.from.row, this.to.row) * t) * unit;
        points.push(polar(CENTER, CENTER, r, a));
      }
      return rectFrom(points, inkUnit(config) / 2);
    }
    const { start, end, radius, largeArc, sweep } = this.geometry(config);
    const centre = arcCentre(start, end, radius, largeArc, sweep);
    const points: Point[] = [];
    const steps = 12;
    for (let step = 0; step <= steps; step++) {
      points.push(polar(centre.cx, centre.cy, centre.r, centre.start + (centre.delta * step) / steps));
    }
    return rectFrom(points, inkUnit(config) / 2);
  }

  contains(config: ProjectConfig, point: Point): boolean {
    if (config.gridType === "circular") {
      return rectContains(this.bounds(config), point);
    }
    const { start, end, radius, largeArc, sweep } = this.geometry(config);
    const centre = arcCentre(start, end, radius, largeArc, sweep);
    return distanceToArc(point, centre) <= inkUnit(config);
  }

  cellRange(): CellRange {
    return {
      minColumn: Math.min(this.from.column, this.to.column),
      maxColumn: Math.max(this.from.column, this.to.column),
      minRow: Math.min(this.from.row, this.to.row),
      maxRow: Math.max(this.from.row, this.to.row),
    };
  }

  moved(columns: number, rows: number): Arc {
    return new Arc({
      from: { column: this.from.column + columns, row: this.from.row + rows },
      to: { column: this.to.column + columns, row: this.to.row + rows },
      direction: this.direction,
      size: this.size,
      border: this.border,
      color: this.color,
    });
  }

  withColor(color: string | undefined): Arc {
    return new Arc({
      from: this.from,
      to: this.to,
      direction: this.direction,
      size: this.size,
      border: this.border,
      color,
    });
  }

  /** An arc has no shape or rounding; a border is its one style field. */
  withStyle(style: ItemStyle): Arc {
    if (style.border === undefined || sameBorder(style.border ?? undefined, this.border)) {
      return this;
    }
    return new Arc({
      from: this.from,
      to: this.to,
      direction: this.direction,
      size: this.size,
      border: style.border ?? undefined,
      color: this.color,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function rectToPath(rect: Rect): string {
  return cmdsToPath([
    M(rect.x, rect.y),
    L(rect.x + rect.w, rect.y),
    L(rect.x + rect.w, rect.y + rect.h),
    L(rect.x, rect.y + rect.h),
    Z,
  ]);
}

function cellRangeOf(cells: readonly Cell[]): CellRange {
  if (cells.length === 0) {
    return { minColumn: 0, maxColumn: 0, minRow: 0, maxRow: 0 };
  }
  let minColumn = cells[0].column;
  let maxColumn = cells[0].column;
  let minRow = cells[0].row;
  let maxRow = cells[0].row;
  for (const cell of cells) {
    if (cell.column < minColumn) minColumn = cell.column;
    if (cell.column > maxColumn) maxColumn = cell.column;
    if (cell.row < minRow) minRow = cell.row;
    if (cell.row > maxRow) maxRow = cell.row;
  }
  return { minColumn, maxColumn, minRow, maxRow };
}

/* ------------------------------------------------------------------ */
/* JSON ⇄ class                                                        */
/* ------------------------------------------------------------------ */

/** Builds the class for a stored item. Unknown shapes fall back to square. */
export function parseItem(item: CanvasItem): KufiItem {
  switch (item.type) {
    case "tile":
      return new Tile({
        column: item.column,
        row: item.row,
        zone: item.zone,
        shape: item.shape,
        rotation: item.rotation,
        rounding: item.rounding,
        border: item.border,
        color: item.color,
      });
    case "line":
      return new Line({
        from: item.from,
        to: item.to,
        border: item.border,
        color: item.color,
      });
    case "stroke":
      return new Stroke({
        points: item.points,
        closed: item.closed,
        border: item.border,
        color: item.color,
      });
    case "arc":
      return new Arc({
        from: item.from,
        to: item.to,
        direction: item.direction,
        size: item.size,
        border: item.border,
        color: item.color,
      });
  }
}

/**
 * JSON → class, memoised per object identity. Untouched items keep their
 * identity across gestures (see `ops.ts`), so wrapping them is free; React
 * memoisation is preserved.
 */
const WRAPPED = new WeakMap<CanvasItem, KufiItem>();

export function itemOf(item: CanvasItem): KufiItem {
  const cached = WRAPPED.get(item);
  if (cached !== undefined) return cached;
  const built = parseItem(item);
  WRAPPED.set(item, built);
  return built;
}

/* ------------------------------------------------------------------ */
/* Item-level helpers used by the editor                               */
/* ------------------------------------------------------------------ */

export function itemRender(config: ProjectConfig, item: CanvasItem): Rendered {
  return itemOf(item).render(config);
}

export function itemDraw(config: ProjectConfig, item: CanvasItem): Rendered {
  return itemOf(item).draw(config);
}

export function itemColor(config: ProjectConfig, item: CanvasItem): string {
  return itemOf(item).resolvedColor(config);
}

export function itemBounds(config: ProjectConfig, item: CanvasItem): Rect {
  return itemOf(item).bounds(config);
}

export function itemContains(
  config: ProjectConfig,
  item: CanvasItem,
  point: Point,
): boolean {
  return itemOf(item).contains(config, point);
}

export function itemCellRange(item: CanvasItem): CellRange {
  return itemOf(item).cellRange();
}

export function moveItem(
  item: CanvasItem,
  columns: number,
  rows: number,
): CanvasItem {
  return itemOf(item).moved(columns, rows).toJSON();
}

export function colorItem(item: CanvasItem, color: string | undefined): CanvasItem {
  return itemOf(item).withColor(color).toJSON();
}

export function styleItem(item: CanvasItem, style: ItemStyle): CanvasItem {
  // A style patch is stored canonically: the same clamps the backend and the
  // file reader apply. That way a width-only border patch with no side on
  // clears the field instead of storing an invisible `sides: 0` outline (and a
  // zero radius clears rounding instead of storing a no-op object).
  const rounding =
    style.rounding === undefined
      ? undefined
      : style.rounding === null
        ? null
        : (sanitizeRounding(style.rounding) ?? null);
  const border =
    style.border === undefined
      ? undefined
      : style.border === null
        ? null
        : (sanitizeBorder(style.border) ?? null);
  const wrapper = itemOf(item);
  const styled = wrapper.withStyle({ ...style, rounding, border });
  // A patch that asks nothing of this item type leaves the object identity
  // alone, so a React layer can skip it.
  return styled === wrapper ? item : styled.toJSON();
}

/** Item keys in a list, for set operations. */
export function keysOf(items: readonly CanvasItem[]): string[] {
  return items.map((item) => item.key);
}

/* ------------------------------------------------------------------ */
/* Builders (used by the tools)                                        */
/* ------------------------------------------------------------------ */

export function makeTile(init: TileInit): TileItem {
  return new Tile(init).toJSON();
}

export function makeLine(from: Cell, to: Cell, color?: string): LineItem {
  return new Line({ from, to, color }).toJSON();
}

export function makeStroke(
  points: readonly Cell[],
  closed: boolean,
  color?: string,
): StrokeItem {
  return new Stroke({ points: [...points], closed, color }).toJSON();
}

export function makeArc(init: ArcInit): ArcItem {
  return new Arc(init).toJSON();
}

/* ------------------------------------------------------------------ */
/* Toolbar icons                                                       */
/* ------------------------------------------------------------------ */

/**
 * The path the pen paints for `shape` at `rotation`, fitted to a square of
 * `size` — the **same** `Tile.render` the canvas uses, which is what keeps the
 * palette honest. The icon is that path in a `0 0 size size` viewBox.
 */
export function tileIconPath(
  shape: ShapeId | undefined,
  rotation: Rotation,
  size: number,
): string {
  const config: ProjectConfig = {
    ...DEFAULT_PROJECT_CONFIG,
    base: size,
    // A ratio of 1 makes the ink fragment the whole cell, so the shape fills
    // the icon box exactly.
    ratio: 1,
  };
  return new Tile({ column: 0, row: 0, zone: 0, shape, rotation }).render(config).path;
}

/** Union of the items' bounds, or the whole board when there are none. */
export function itemsBounds(
  config: ProjectConfig,
  items: readonly CanvasItem[],
): Rect | null {
  let combined: Rect | null = null;
  for (const item of items) {
    const bounds = itemBounds(config, item);
    combined = combined === null ? bounds : unionRect(combined, bounds);
  }
  return combined;
}

/** Marquee test: does the item's bounding box meet the rectangle? */
export function itemIntersectsRect(
  config: ProjectConfig,
  item: CanvasItem,
  rect: Rect,
): boolean {
  const bounds = itemBounds(config, item);
  return !(
    bounds.x + bounds.w < rect.x ||
    rect.x + rect.w < bounds.x ||
    bounds.y + bounds.h < rect.y ||
    rect.y + rect.h < bounds.y
  );
}
