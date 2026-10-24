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
 *     same class rebuilt by `itemOf`; its key set is exactly the shared
 *     `canvasItemValidator`'s, and every fragment is copied through
 *     `fragmentPoint` (`{column, row}`, plus `zone` only for a space fragment).
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
  BORDER_ALL,
  DEFAULT_PROJECT_CONFIG,
  DEFAULT_STROKE_CAP,
  DEFAULT_STROKE_JOIN,
  arcKey,
  arcPoint,
  cellSize,
  clampBorderSides,
  compareFragments,
  fragmentPoint,
  hasAnchor,
  lineKey,
  linePoint,
  normalizeStrokeCap,
  normalizeStrokeJoin,
  sanitizeBorder,
  sanitizeRounding,
  strokeKey,
  tileKey,
  wholeBorder,
  zoneOf,
} from "./model";
import type {
  Anchor,
  ArcDirection,
  ArcItem,
  ArcPoint,
  ArcSize,
  CanvasItem,
  CanvasItemType,
  Cell,
  FragmentPoint,
  GridType,
  InkPoint,
  ItemBorder,
  ItemRounding,
  LineItem,
  LinePoint,
  ProjectConfig,
  Rotation,
  ShapeId,
  StrokeCap,
  StrokeItem,
  StrokeJoin,
  TileItem,
  Zone,
} from "./model";
import {
  A,
  L,
  M,
  Z,
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
  slicePath,
  unionRect,
  zoneRect,
} from "./geometry";
import type { CircularSlice, PathCmd, Point, Rect } from "./geometry";
import { borderBand, borderClipRects, borderPaint, borderSides } from "./border";
import type { BorderPaint } from "./border";
import { cellCentre, linePointPosition } from "./grid";
import { roundCorners, roundingRadius } from "./rounding";
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
  /** End shape of a stroked path; every renderer passes it to SVG. */
  cap: StrokeCap;
  /** Turn shape of a stroked path; every renderer passes it to SVG. */
  join: StrokeJoin;
  /**
   * The item's border, when it carries one (`draw`, not `render`): one wider
   * stroke of the same `path`, in the border colour, painted **before** the
   * item's own paint. No duplicate path and no translation. The border uses
   * the same `cap` and `join`, so a round end wraps the border with the ink.
   */
  border?: BorderPaint;
}

/** Inclusive cell extent of an item — used to clamp a selection move. */
export interface CellRange {
  minColumn: number;
  maxColumn: number;
  minRow: number;
  maxRow: number;
}

/**
 * Style patch applied to an item. Shape and rotation are the tile's own;
 * rounding belongs to tiles, lines and strokes, cap/join to stroked items, and
 * a border to every type. `null` clears a field, `undefined` leaves it alone;
 * cap/join use their default values as the clearing value.
 */
export interface ItemStyle {
  shape?: ShapeId;
  rotation?: Rotation;
  rounding?: ItemRounding | null;
  border?: ItemBorder | null;
  cap?: StrokeCap;
  join?: StrokeJoin;
}

/** `rect ∪ rect` for the empty case. */
function rectFrom(points: readonly Point[], pad: number): Rect {
  return expandRect(boundsOfPoints(points), pad);
}

/**
 * A fragment end as it is **stored**: exactly `{column, row}` for the ink
 * fragment, `{column, row, zone}` for a space fragment (`fragmentPoint` drops
 * the canonical ink zone). Every item class copies its ends through here
 * (constructor **and** `toJSON`), so no caller can leak a foreign key onto the
 * wire; `docs/CANVAS.md` §3.
 */
function plainFragment(point: FragmentPoint): FragmentPoint {
  return fragmentPoint(point.column, point.row, point.zone);
}

/** A fragment with its canonical (zone-0 included) zone. */
function fragmentAnchor(point: FragmentPoint): Anchor {
  return { column: point.column, row: point.row, zone: zoneOf(point) };
}

/**
 * One axis of a signed half-cell translation.
 *
 * A zone bit is an absolute half of its cell: bit 0 is the right half, bit 1
 * the bottom half. Moving `half` half-cells therefore adds to the absolute
 * half coordinate `2 · index + bit`; the carry or borrow lands in the cell
 * index and the remainder is the new bit. This is a real translation — a
 * right-half fragment pushed right moves into the next cell, instead of
 * flipping back into the left half of its own cell (which a zone XOR did).
 */
function shiftedHalf(
  index: number,
  bit: 0 | 1,
  half: number,
): { index: number; bit: 0 | 1 } {
  const t = 2 * index + bit + half;
  return {
    index: Math.floor(t / 2),
    bit: (((t % 2) + 2) % 2) as 0 | 1,
  };
}

/** A fragment translated by whole cells plus signed half-cell steps. */
function shiftedFragment(
  fragment: FragmentPoint,
  columns: number,
  rows: number,
  halfColumns: number,
  halfRows: number,
): Anchor {
  const zone = zoneOf(fragment);
  const x = shiftedHalf(
    fragment.column + columns,
    (zone & 1) as 0 | 1,
    halfColumns,
  );
  const y = shiftedHalf(
    fragment.row + rows,
    ((zone >> 1) & 1) as 0 | 1,
    halfRows,
  );
  return {
    column: x.index,
    row: y.index,
    zone: (x.bit | (y.bit << 1)) as Zone,
  };
}

/**
 * A line point as it is **stored**: the fragment plus the anchor when it has
 * one (the ink zone and the centre anchor are never stored — `linePoint`
 * drops both). Fields are copied one by one, like `plainFragment`, so a
 * caller's object can never leak a foreign key (`anchor`'s own extras
 * included) onto the wire; `docs/CANVAS.md` §3.
 */
function plainLinePoint(point: LinePoint): LinePoint {
  return linePoint(point.column, point.row, point.zone, point.anchor);
}

/**
 * An arc endpoint as it is **stored**: the cell plus the anchor when it has
 * one — the centre included, because for an arc endpoint an absent anchor means
 * the legacy spring point, not the centre. Same field-by-field copy as
 * `plainLinePoint`, so no caller can leak a foreign key onto the wire.
 */
function plainArcPoint(point: ArcPoint): ArcPoint {
  return arcPoint(point.column, point.row, point.zone, point.anchor);
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

/**
 * A tile's border as it is stored: `sides` only when it is a proper subset of
 * the four sides. All four is the absent mask, so a width/colour border keeps
 * the pre-sides JSON shape exactly.
 */
function storedTileBorder(border: ItemBorder | undefined): ItemBorder | undefined {
  if (border === undefined || border.sides === undefined) return border;
  const sides = clampBorderSides(border.sides);
  if (sides === BORDER_ALL) {
    return { width: border.width, color: border.color };
  }
  return sides === border.sides ? border : { width: border.width, color: border.color, sides };
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
   * What a renderer paints for this item: the border stroke first (so the
   * item's ink always wins), then the item's own path. The border is computed
   * once here — a stroked item's is `width + 2 × border`, a filled item's is
   * `2 × border` — so every renderer consumes the same paint. `render` is for
   * callers that want the shape alone (selection rings, toolbar icons).
   */
  draw(config: ProjectConfig): Rendered {
    const rendered = this.render(config);
    const border = this.border;
    if (border === undefined) return rendered;
    const paint = borderPaint(
      border,
      rendered.mode === "stroke" ? rendered.width : 0,
    );
    if (paint === undefined) return rendered;
    const clip = this.borderClip(config, borderSides(border));
    return clip === undefined
      ? { ...rendered, border: paint }
      : { ...rendered, border: { ...paint, clip } };
  }

  /**
   * The outside bands a partial border is clipped to. Only a tile overrides
   * this: line, polyline and arc borders are always whole (the editor hides
   * the side map for those targets and the constructors drop a stray mask).
   */
  protected borderClip(
    config: ProjectConfig,
    sides: number,
  ): readonly Rect[] | undefined {
    void config;
    void sides;
    return undefined;
  }

  abstract bounds(config: ProjectConfig): Rect;

  /**
   * Geometric hit test for selection, the eraser and the tools. It covers the
   * item's **own paint only**: a border is an outline painted outside the
   * shape (`draw`), so including it would let a thick border claim a
   * neighbouring fragment. `Tile` has always worked this way, and every item
   * follows it.
   */
  abstract contains(config: ProjectConfig, point: Point): boolean;

  abstract cellRange(): CellRange;

  /**
   * The same item shifted by whole cells plus an optional signed half-cell
   * displacement, in half-cell units (keys are derived, so they follow). Half
   * steps are a translation only at 1:1, where the four fragments are
   * congruent; callers pass `0` at every denser ratio and on the circular
   * grid. Each fragment carries or borrows on its own, so a mixed-zone item
   * keeps its shape instead of folding one end back over the other.
   */
  abstract moved(
    columns: number,
    rows: number,
    halfColumns?: number,
    halfRows?: number,
  ): KufiItem;

  /**
   * Every fragment the item addresses: its tile quadrant, its two endpoints,
   * or every stroke point. A move needs them to clamp half steps at the grid
   * edge per fragment rather than per cell.
   */
  abstract fragments(): readonly Anchor[];

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
    this.border = storedTileBorder(init.border);
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
      return {
        path: this.circularPath(config),
        mode: "fill",
        width: 0,
        cap: DEFAULT_STROKE_CAP,
        join: DEFAULT_STROKE_JOIN,
      };
    }
    const box = zoneRect(config, this.column, this.row, this.zone);
    return {
      path: shapePath(this.shape, box, this.rotation ?? 0, this.rounding),
      mode: "fill",
      width: 0,
      cap: DEFAULT_STROKE_CAP,
      join: DEFAULT_STROKE_JOIN,
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

  protected borderClip(
    config: ProjectConfig,
    sides: number,
  ): readonly Rect[] | undefined {
    if (this.border === undefined) return undefined;
    const band = borderBand(this.border);
    if (band === undefined) return undefined;
    return borderClipRects(this.bounds(config), sides, band);
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

  fragments(): readonly Anchor[] {
    return [{ column: this.column, row: this.row, zone: this.zone }];
  }

  moved(columns: number, rows: number, halfColumns = 0, halfRows = 0): Tile {
    const at = shiftedFragment(this, columns, rows, halfColumns, halfRows);
    return new Tile({
      ...at,
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
      style.border === undefined
        ? this.border
        : style.border === null
          ? undefined
          : storedTileBorder(style.border);
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

/** Value equality of two borders (`undefined` = none; absent sides = all). */
export function sameBorder(
  a: ItemBorder | undefined,
  b: ItemBorder | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.width === b.width &&
    a.color === b.color &&
    borderSides(a) === borderSides(b)
  );
}

/** The stored form of a cap: the default is the absent state. */
function activeCap(cap: StrokeCap | undefined): StrokeCap | undefined {
  const normalized = normalizeStrokeCap(cap);
  return normalized === DEFAULT_STROKE_CAP ? undefined : normalized;
}

/** The stored form of a join: the default is the absent state. */
function activeJoin(join: StrokeJoin | undefined): StrokeJoin | undefined {
  const normalized = normalizeStrokeJoin(join);
  return normalized === DEFAULT_STROKE_JOIN ? undefined : normalized;
}

/* ------------------------------------------------------------------ */
/* Line                                                                */
/* ------------------------------------------------------------------ */

export interface LineInit {
  from: FragmentPoint;
  to: FragmentPoint;
  rounding?: ItemRounding;
  border?: ItemBorder;
  cap?: StrokeCap;
  join?: StrokeJoin;
  color?: string;
}

/**
 * An axis-aligned run of fragments drawn as **one bar** — the old line tool's
 * two-point case. The old app emitted the bar as a run of ink/space fragments;
 * the union of those fragments is exactly this rectangle, and one item is
 * easier to erase and cheaper to store. Ink fragments give the pre-fragment
 * bar exactly (`[column·base, …, + ink]`, ink thick); a space fragment moves
 * the bar's end or cross-section to its own square, the same rule the pen and
 * the line tool's squares use (`docs/CANVAS.md` §5).
 *
 * A line is a square-grid item: a circular board neither creates nor draws one
 * (`docs/CANVAS.md` §3, «Per-grid item rules»), so the class carries no polar
 * geometry.
 */
export class Line extends KufiItem {
  readonly type = "line" as const;
  readonly from: FragmentPoint;
  readonly to: FragmentPoint;
  readonly rounding?: ItemRounding;
  readonly border?: ItemBorder;
  readonly cap?: StrokeCap;
  readonly join?: StrokeJoin;
  readonly color?: string;

  constructor(init: LineInit) {
    super();
    const [from, to] =
      compareFragments(init.from, init.to) <= 0
        ? [init.from, init.to]
        : [init.to, init.from];
    this.from = plainFragment(from);
    this.to = plainFragment(to);
    this.rounding = init.rounding;
    this.border = init.border === undefined ? undefined : wholeBorder(init.border);
    this.cap = activeCap(init.cap);
    this.join = activeJoin(init.join);
    this.color = init.color;
  }

  get key(): string {
    return lineKey(this.from, this.to);
  }

  toJSON(): LineItem {
    const item: LineItem = {
      type: "line",
      key: this.key,
      from: plainFragment(this.from),
      to: plainFragment(this.to),
    };
    if (this.rounding !== undefined && this.rounding.radius > 0) {
      item.rounding = this.rounding;
    }
    if (this.border !== undefined) item.border = this.border;
    if (this.cap !== undefined) item.cap = this.cap;
    if (this.join !== undefined) item.join = this.join;
    if (this.color !== undefined) item.color = this.color;
    return item;
  }

  /**
   * The bar rectangle on a square grid.
   *
   * The canonical `from` end (lower column — or lower row on a vertical run)
   * supplies the bar's cross-section: its own stripe, ink or space. The length
   * runs from that fragment's start to the `to` fragment's end. For two ink
   * ends this is exactly the pre-fragment bar: `x = min·base`,
   * `w = (max − min)·base + ink`, `h = ink`.
   */
  bar(config: ProjectConfig): Rect {
    const from = zoneRect(config, this.from.column, this.from.row, zoneOf(this.from));
    const to = zoneRect(config, this.to.column, this.to.row, zoneOf(this.to));
    if (this.from.row === this.to.row) {
      return {
        x: from.x,
        y: from.y,
        w: to.x + to.w - from.x,
        h: from.h,
      };
    }
    return {
      x: from.x,
      y: from.y,
      w: from.w,
      h: to.y + to.h - from.y,
    };
  }

  render(config: ProjectConfig): Rendered {
    if (this.from.row === this.to.row || this.from.column === this.to.column) {
      const bar = this.bar(config);
      const path =
        this.rounding !== undefined && this.rounding.radius > 0
          ? shapePath("square", bar, 0, this.rounding)
          : rectToPath(bar);
      return {
        path,
        mode: "fill",
        width: 0,
        cap: DEFAULT_STROKE_CAP,
        join: DEFAULT_STROKE_JOIN,
      };
    }
    // Not a straight run (invalid item): join the two cell centres.
    const p1 = cellCentre(config, this.from);
    const p2 = cellCentre(config, this.to);
    return {
      path: cmdsToPath([M(p1.x, p1.y), L(p2.x, p2.y)]),
      mode: "stroke",
      width: inkUnit(config),
      cap: this.cap ?? DEFAULT_STROKE_CAP,
      join: this.join ?? DEFAULT_STROKE_JOIN,
    };
  }

  bounds(config: ProjectConfig): Rect {
    if (this.from.row === this.to.row || this.from.column === this.to.column) {
      return this.bar(config);
    }
    return rectFrom(
      [cellCentre(config, this.from), cellCentre(config, this.to)],
      inkUnit(config) / 2,
    );
  }

  /**
   * Hit testing matches the painted bar exactly, with no `ink/2` padding.
   *
   * A straight run is filled as `bar(config)` (rounded corners stay inside
   * that rectangle), and every edge of the bar is a fragment edge. Padding it
   * would grow an ink bar from 7.5 to 15 units at the default 1:3 preset — into
   * the rows above and below — and a space-stripe bar, which is thinner than
   * the ink unit at every dense preset, would grow into the ink square beside
   * it. Exact geometry is also what `Tile.contains` does, so a click in a
   * neighbouring fragment never hits the bar.
   *
   * The invalid diagonal fallback is rendered as a stroke of ink width through
   * the two cell centres; its hit test is the same half-width band
   * `Stroke.contains` uses, not the whole bounding box.
   */
  contains(config: ProjectConfig, point: Point): boolean {
    if (this.from.row === this.to.row || this.from.column === this.to.column) {
      return rectContains(this.bar(config), point);
    }
    return (
      distanceToPolyline(
        point,
        [cellCentre(config, this.from), cellCentre(config, this.to)],
        false,
      ) <=
      inkUnit(config) / 2 + 1e-9
    );
  }

  cellRange(): CellRange {
    return {
      minColumn: Math.min(this.from.column, this.to.column),
      maxColumn: Math.max(this.from.column, this.to.column),
      minRow: Math.min(this.from.row, this.to.row),
      maxRow: Math.max(this.from.row, this.to.row),
    };
  }

  fragments(): readonly Anchor[] {
    return [fragmentAnchor(this.from), fragmentAnchor(this.to)];
  }

  moved(columns: number, rows: number, halfColumns = 0, halfRows = 0): Line {
    return new Line({
      from: shiftedFragment(this.from, columns, rows, halfColumns, halfRows),
      to: shiftedFragment(this.to, columns, rows, halfColumns, halfRows),
      rounding: this.rounding,
      border: this.border,
      cap: this.cap,
      join: this.join,
      color: this.color,
    });
  }

  withColor(color: string | undefined): Line {
    return new Line({
      from: this.from,
      to: this.to,
      rounding: this.rounding,
      border: this.border,
      cap: this.cap,
      join: this.join,
      color,
    });
  }

  /** A line can round its box and, when diagonal, its ink ends. */
  withStyle(style: ItemStyle): Line {
    if (
      style.border === undefined &&
      style.rounding === undefined &&
      style.cap === undefined &&
      style.join === undefined
    ) {
      return this;
    }
    const rounding =
      style.rounding === undefined ? this.rounding : (style.rounding ?? undefined);
    const border =
      style.border === undefined
        ? this.border
        : style.border === null
          ? undefined
          : wholeBorder(style.border);
    const cap = style.cap === undefined ? this.cap : activeCap(style.cap);
    const join = style.join === undefined ? this.join : activeJoin(style.join);
    if (
      sameRounding(rounding, this.rounding) &&
      sameBorder(border, this.border) &&
      cap === this.cap &&
      join === this.join
    ) {
      return this;
    }
    return new Line({
      from: this.from,
      to: this.to,
      rounding,
      border,
      cap,
      join,
      color: this.color,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Stroke                                                              */
/* ------------------------------------------------------------------ */

export interface StrokeInit {
  points: readonly LinePoint[];
  closed?: boolean;
  rounding?: ItemRounding;
  border?: ItemBorder;
  cap?: StrokeCap;
  join?: StrokeJoin;
  color?: string;
}

/**
 * A multi-point polyline — the old line tool's diagonal / many-point case.
 * Drawn as a **stroked** path of ink width through its points: each point's
 * anchored position, or its cell centre when it carries no anchor (the
 * pre-anchor model). The first and last **centre** points are pushed half an
 * ink square outwards along an axis-aligned end segment so a straight end
 * reaches the fragment edge, exactly like the reference implementation; an
 * explicit anchor is a position the designer chose and is drawn exactly.
 */
export class Stroke extends KufiItem {
  readonly type = "stroke" as const;
  readonly points: readonly LinePoint[];
  readonly closed: boolean;
  readonly rounding?: ItemRounding;
  readonly border?: ItemBorder;
  readonly cap?: StrokeCap;
  readonly join?: StrokeJoin;
  readonly color?: string;

  constructor(init: StrokeInit) {
    super();
    this.points = init.points.map(plainLinePoint);
    this.closed = init.closed ?? false;
    this.rounding = init.rounding;
    this.border = init.border === undefined ? undefined : wholeBorder(init.border);
    this.cap = activeCap(init.cap);
    this.join = activeJoin(init.join);
    this.color = init.color;
  }

  get key(): string {
    return strokeKey(this.points, this.closed);
  }

  toJSON(): StrokeItem {
    const item: StrokeItem = {
      type: "stroke",
      key: this.key,
      points: this.points.map(plainLinePoint),
    };
    if (this.closed) item.closed = true;
    if (this.rounding !== undefined && this.rounding.radius > 0) {
      item.rounding = this.rounding;
    }
    if (this.border !== undefined) item.border = this.border;
    if (this.cap !== undefined) item.cap = this.cap;
    if (this.join !== undefined) item.join = this.join;
    if (this.color !== undefined) item.color = this.color;
    return item;
  }

  render(config: ProjectConfig): Rendered {
    const points = this.anchorPoints(config);
    if (points.length < 2) {
      return {
        path: "",
        mode: "stroke",
        width: inkUnit(config),
        cap: this.cap ?? DEFAULT_STROKE_CAP,
        join: this.join ?? DEFAULT_STROKE_JOIN,
      };
    }
    let cmds: PathCmd[] = [M(points[0].x, points[0].y)];
    for (let index = 1; index < points.length; index++) {
      cmds.push(L(points[index].x, points[index].y));
    }
    if (this.closed) cmds.push(Z);
    if (this.rounding !== undefined && this.rounding.radius > 0) {
      const box = this.bounds(config);
      const radius = roundingRadius(this.rounding, box.w, box.h);
      if (radius > 0) {
        cmds = roundCorners(cmds, box, radius, this.rounding.corners);
      }
    }
    return {
      path: cmdsToPath(cmds),
      mode: "stroke",
      width: inkUnit(config),
      cap: this.cap ?? DEFAULT_STROKE_CAP,
      join: this.join ?? DEFAULT_STROKE_JOIN,
    };
  }

  /** The points the stroke is drawn through, with the reference end nudges. */
  anchorPoints(config: ProjectConfig): Point[] {
    const ink = inkUnit(config);
    const positions = this.points.map((point) => linePointPosition(config, point));
    if (positions.length < 2) return positions;
    const last = positions.length - 1;
    return positions.map((point, index) => {
      if (this.closed) return point;
      if (index !== 0 && index !== last) return point;
      // An anchored end is where the designer put it — only a centre end is
      // nudged out to the fragment edge, as the reference app always did.
      if (hasAnchor(this.points[index])) return point;
      const previous = positions[index === 0 ? index : index - 1];
      const next = positions[index === 0 ? index + 1 : index];
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      // The nudge reaches the end point's **own fragment** edge: half its own
      // square, so a centre point of a space fragment is nudged onto that
      // space square exactly like an ink one (zone 0 → ±ink/2, unchanged).
      // The circular grid has no rect fragment; it keeps the ink half.
      const out =
        config.gridType === "square"
          ? zoneRect(
              config,
              this.points[index].column,
              this.points[index].row,
              zoneOf(this.points[index]),
            )
          : expandRect({ x: point.x, y: point.y, w: 0, h: 0 }, ink / 2);
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

  fragments(): readonly Anchor[] {
    return this.points.map(fragmentAnchor);
  }

  moved(columns: number, rows: number, halfColumns = 0, halfRows = 0): Stroke {
    return new Stroke({
      points: this.points.map((point) => {
        const at = shiftedFragment(
          point,
          columns,
          rows,
          halfColumns,
          halfRows,
        );
        return linePoint(at.column, at.row, at.zone, point.anchor);
      }),
      closed: this.closed,
      rounding: this.rounding,
      border: this.border,
      cap: this.cap,
      join: this.join,
      color: this.color,
    });
  }

  withColor(color: string | undefined): Stroke {
    return new Stroke({
      points: [...this.points],
      closed: this.closed,
      rounding: this.rounding,
      border: this.border,
      cap: this.cap,
      join: this.join,
      color,
    });
  }

  /** A polyline rounds its turns and sets its ink ends; it can be bordered. */
  withStyle(style: ItemStyle): Stroke {
    if (
      style.border === undefined &&
      style.rounding === undefined &&
      style.cap === undefined &&
      style.join === undefined
    ) {
      return this;
    }
    const rounding =
      style.rounding === undefined ? this.rounding : (style.rounding ?? undefined);
    const border =
      style.border === undefined
        ? this.border
        : style.border === null
          ? undefined
          : wholeBorder(style.border);
    const cap = style.cap === undefined ? this.cap : activeCap(style.cap);
    const join = style.join === undefined ? this.join : activeJoin(style.join);
    if (
      sameRounding(rounding, this.rounding) &&
      sameBorder(border, this.border) &&
      cap === this.cap &&
      join === this.join
    ) {
      return this;
    }
    return new Stroke({
      points: [...this.points],
      closed: this.closed,
      rounding,
      border,
      cap,
      join,
      color: this.color,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Arc                                                                 */
/* ------------------------------------------------------------------ */

export interface ArcInit {
  from: ArcPoint;
  to: ArcPoint;
  direction: ArcDirection;
  size: ArcSize;
  border?: ItemBorder;
  cap?: StrokeCap;
  join?: StrokeJoin;
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
 * A rib (قوس) between two fragments. Each endpoint is an `ArcPoint`: its
 * fragment plus the anchor the user picked inside it. An endpoint without an
 * anchor falls back to the reference app's **spring point** (`kufi.js`
 * 285‑311) on that endpoint's own fragment — that is what keeps every
 * pre-anchor arc, ink or space, drawing exactly as before, and why the arc
 * tool writes every click, the centre included.
 *
 * The geometry is uniform in the chord between the two endpoint positions:
 * `quarter` and `threeQuarter` use `chord/√2` (`largeArc` 0 / 1), `half` the
 * semicircle `chord/2`. Only the legacy anchor-less diagonal keeps the old
 * `dColumn·cell + ink/2` radius (the read-time repair to `quarter` changes no
 * pixel; `docs/CANVAS.md` §5). Endpoints are canonical by **fragment** (`from`
 * is the lower by column, then row, then zone), so the picture never depends on
 * which endpoint was clicked first; the reference app's click-order quirk
 * became the explicit `direction` control.
 *
 * Each end springs off **its own fragment's** box, so a rib drawn from a space
 * fragment attaches to that square. A rib is a square-grid item: a circular
 * board neither creates nor draws one (`docs/CANVAS.md` §3, «Per-grid item
 * rules»), so the class carries no polar geometry.
 */
export class Arc extends KufiItem {
  readonly type = "arc" as const;
  readonly from: ArcPoint;
  readonly to: ArcPoint;
  readonly direction: ArcDirection;
  readonly size: ArcSize;
  readonly border?: ItemBorder;
  readonly cap?: StrokeCap;
  readonly join?: StrokeJoin;
  readonly color?: string;

  constructor(init: ArcInit) {
    super();
    const [from, to] =
      compareFragments(init.from, init.to) <= 0
        ? [init.from, init.to]
        : [init.to, init.from];
    this.from = plainArcPoint(from);
    this.to = plainArcPoint(to);
    this.direction = init.direction;
    this.size = init.size;
    this.border = init.border === undefined ? undefined : wholeBorder(init.border);
    this.cap = activeCap(init.cap);
    this.join = activeJoin(init.join);
    this.color = init.color;
  }

  get key(): string {
    return arcKey(this.from, this.to, this.direction, this.size);
  }

  toJSON(): ArcItem {
    const item: ArcItem = {
      type: "arc",
      key: this.key,
      from: plainArcPoint(this.from),
      to: plainArcPoint(this.to),
      direction: this.direction,
      size: this.size,
    };
    if (this.border !== undefined) item.border = this.border;
    if (this.cap !== undefined) item.cap = this.cap;
    if (this.join !== undefined) item.join = this.join;
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
    // Each end springs off its own fragment: the ink square for zone 0 (the
    // numbers the old app produced), the space square for a space end. A
    // stored anchor is taken verbatim; an absent one is the reference app's
    // spring point on that same fragment.
    const anchored =
      this.from.anchor !== undefined || this.to.anchor !== undefined;
    const fallback = this.fallbackAnchors(clockwise);
    const start = this.endpointPosition(config, this.from, fallback.start);
    const end = this.endpointPosition(config, this.to, fallback.end);

    const chord = Math.hypot(end.x - start.x, end.y - start.y);
    const diagonal =
      this.from.row !== this.to.row && this.from.column !== this.to.column;
    // The legacy anchor-less diagonal keeps the reference app's
    // `dColumn·cell + ink/2` radius. For an ink end it is exactly `chord/√2`;
    // for a space end it is the only expression that reproduces what the
    // pre-anchor model drew, so it survives the read-time repair to `quarter`.
    const legacyDiagonal = !anchored && diagonal;
    const radius =
      this.size === "threeQuarter"
        ? chord / Math.SQRT2
        : legacyDiagonal
          ? Math.abs(this.to.column - this.from.column) * base + ink / 2
          : this.size === "quarter"
            ? chord / Math.SQRT2
            : chord / 2;
    const largeArc: 0 | 1 = this.size === "threeQuarter" ? 1 : 0;
    return { start, end, radius, largeArc, sweep };
  }

  /** Position of one endpoint: its own anchor, or the legacy spring point. */
  private endpointPosition(
    config: ProjectConfig,
    point: ArcPoint,
    fallback: InkPoint,
  ): Point {
    return linePointPosition(config, {
      column: point.column,
      row: point.row,
      zone: point.zone,
      anchor: point.anchor ?? fallback,
    });
  }

  /**
   * The reference app's spring point for each endpoint, expressed as anchors
   * of that endpoint's **own fragment**: horizontal chords spring off the
   * bottom (clockwise) or top (counterclockwise) edge of the row, vertical
   * chords off the left or right edge, and a 45° diagonal picks the edge
   * midpoints that face the chord. These are exactly the positions `geometry`
   * used before anchors existed, for ink and space fragments alike.
   */
  private fallbackAnchors(clockwise: boolean): { start: InkPoint; end: InkPoint } {
    if (this.from.row === this.to.row) {
      const y = clockwise ? 1 : 0;
      return { start: { x: 0.5, y }, end: { x: 0.5, y } };
    }
    if (this.from.column === this.to.column) {
      const x = clockwise ? 0 : 1;
      return { start: { x, y: 0.5 }, end: { x, y: 0.5 } };
    }
    const down = this.to.row > this.from.row;
    if (clockwise) {
      return down
        ? { start: { x: 0, y: 0.5 }, end: { x: 0.5, y: 1 } }
        : { start: { x: 0.5, y: 1 }, end: { x: 1, y: 0.5 } };
    }
    return down
      ? { start: { x: 0.5, y: 0 }, end: { x: 1, y: 0.5 } }
      : { start: { x: 0, y: 0.5 }, end: { x: 0.5, y: 0 } };
  }

  render(config: ProjectConfig): Rendered {
    const { start, end, radius, largeArc, sweep } = this.geometry(config);
    return {
      path: cmdsToPath([
        M(start.x, start.y),
        A(radius, radius, largeArc, sweep, end.x, end.y),
      ]),
      mode: "stroke",
      width: inkUnit(config),
      cap: this.cap ?? DEFAULT_STROKE_CAP,
      join: this.join ?? DEFAULT_STROKE_JOIN,
    };
  }

  bounds(config: ProjectConfig): Rect {
    const { start, end, radius, largeArc, sweep } = this.geometry(config);
    const centre = arcCentre(start, end, radius, largeArc, sweep);
    const points: Point[] = [];
    const steps = 12;
    for (let step = 0; step <= steps; step++) {
      points.push(polar(centre.cx, centre.cy, centre.r, centre.start + (centre.delta * step) / steps));
    }
    return rectFrom(points, inkUnit(config) / 2);
  }

  /**
   * Hit testing matches the rendered stroke: half the ink width on either side
   * of the centreline, clipped to the arc's own angular sweep.
   *
   * `render` strokes the path at `inkUnit(config)`, so the painted band is
   * `ink/2` wide radially. The old test used the full `inkUnit`, which doubled
   * the band and reached neighbouring fragments. Outside the sweep
   * `distanceToArc` measures to the nearest endpoint — a half-disc of the same
   * `ink/2` radius. That is exact for `round` caps and a small, bounded
   * over-touch for `butt` caps (which are flush); `square` caps reach a little
   * further along the tangent than that disc, so their outer corners stay
   * unpainted by the hit test. Every cap allowance is bounded by `ink/2`, so
   * the hit area never grows past the width the stroke paints.
   *
   * A border is outside the stroke and is not part of the hit area (see
   * `KufiItem.contains`).
   */
  contains(config: ProjectConfig, point: Point): boolean {
    const { start, end, radius, largeArc, sweep } = this.geometry(config);
    const centre = arcCentre(start, end, radius, largeArc, sweep);
    return distanceToArc(point, centre) <= inkUnit(config) / 2 + 1e-9;
  }

  cellRange(): CellRange {
    return {
      minColumn: Math.min(this.from.column, this.to.column),
      maxColumn: Math.max(this.from.column, this.to.column),
      minRow: Math.min(this.from.row, this.to.row),
      maxRow: Math.max(this.from.row, this.to.row),
    };
  }

  fragments(): readonly Anchor[] {
    return [fragmentAnchor(this.from), fragmentAnchor(this.to)];
  }

  moved(columns: number, rows: number, halfColumns = 0, halfRows = 0): Arc {
    const from = shiftedFragment(
      this.from,
      columns,
      rows,
      halfColumns,
      halfRows,
    );
    const to = shiftedFragment(this.to, columns, rows, halfColumns, halfRows);
    return new Arc({
      from: arcPoint(from.column, from.row, from.zone, this.from.anchor),
      to: arcPoint(to.column, to.row, to.zone, this.to.anchor),
      direction: this.direction,
      size: this.size,
      border: this.border,
      cap: this.cap,
      join: this.join,
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
      cap: this.cap,
      join: this.join,
      color,
    });
  }

  /** An arc has no shape or rounding; border, cap and join are its style. */
  withStyle(style: ItemStyle): Arc {
    if (
      style.border === undefined &&
      style.cap === undefined &&
      style.join === undefined
    ) {
      return this;
    }
    const border =
      style.border === undefined
        ? this.border
        : style.border === null
          ? undefined
          : wholeBorder(style.border);
    const cap = style.cap === undefined ? this.cap : activeCap(style.cap);
    const join = style.join === undefined ? this.join : activeJoin(style.join);
    if (
      sameBorder(border, this.border) &&
      cap === this.cap &&
      join === this.join
    ) {
      return this;
    }
    return new Arc({
      from: this.from,
      to: this.to,
      direction: this.direction,
      size: this.size,
      border,
      cap,
      join,
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
        rounding: item.rounding,
        border: item.border,
        cap: item.cap,
        join: item.join,
        color: item.color,
      });
    case "stroke":
      return new Stroke({
        points: item.points,
        closed: item.closed,
        rounding: item.rounding,
        border: item.border,
        cap: item.cap,
        join: item.join,
        color: item.color,
      });
    case "arc":
      return new Arc({
        from: item.from,
        to: item.to,
        direction: item.direction,
        size: item.size,
        border: item.border,
        cap: item.cap,
        join: item.join,
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

/** Every fragment the item addresses (tile quadrant, endpoints, stroke points). */
export function itemFragments(item: CanvasItem): readonly Anchor[] {
  return itemOf(item).fragments();
}

export function moveItem(
  item: CanvasItem,
  columns: number,
  rows: number,
  halfColumns: number = 0,
  halfRows: number = 0,
): CanvasItem {
  return itemOf(item)
    .moved(columns, rows, halfColumns, halfRows)
    .toJSON();
}

export function colorItem(item: CanvasItem, color: string | undefined): CanvasItem {
  return itemOf(item).withColor(color).toJSON();
}

export function styleItem(item: CanvasItem, style: ItemStyle): CanvasItem {
  // A style patch is stored canonically: the same clamps the backend and the
  // file reader apply. That way a patch with width `0` clears the field
  // instead of storing an invisible outline (and a zero radius clears rounding
  // instead of storing a no-op object).
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
  const cap =
    style.cap === undefined ? undefined : normalizeStrokeCap(style.cap);
  const join =
    style.join === undefined ? undefined : normalizeStrokeJoin(style.join);
  const wrapper = itemOf(item);
  const styled = wrapper.withStyle({ ...style, rounding, border, cap, join });
  // A patch that asks nothing of this item type leaves the object identity
  // alone, so a React layer can skip it.
  return styled === wrapper ? item : styled.toJSON();
}

/** Item keys in a list, for set operations. */
export function keysOf(items: readonly CanvasItem[]): string[] {
  return items.map((item) => item.key);
}

/* ------------------------------------------------------------------ */
/* Per-grid item rules                                                 */
/* ------------------------------------------------------------------ */

/**
 * The item types a circular board does not carry. A `line` bar and an `arc`
 * rib are chords of the square grid — there is no polar equivalent — so a
 * board that switched from square to circular **hides** them instead of
 * re-interpreting them (user rule; `docs/CANVAS.md` §3 «Per-grid item rules»).
 *
 * Hiding is a **view** rule and nothing else: the document, the history, the
 * `applyOps` diff and `.kuficraft` files keep the items untouched, so
 * switching back to a square grid draws them again. Every renderer, hit test,
 * selection and export asks `isItemAllowed` / `visibleItems` first.
 */
const CIRCULAR_HIDDEN_TYPES: readonly CanvasItemType[] = ["line", "arc"];

/** Whether a board of `gridType` carries items of `type`. */
export function isItemTypeAllowed(
  gridType: GridType,
  type: CanvasItemType,
): boolean {
  return gridType !== "circular" || !CIRCULAR_HIDDEN_TYPES.includes(type);
}

/** Whether `item` is drawn and interactive on `config`'s board. */
export function isItemAllowed(config: ProjectConfig, item: CanvasItem): boolean {
  return isItemTypeAllowed(config.gridType, item.type);
}

/**
 * The items `config`'s board shows. The same array is returned when nothing is
 * hidden, so the memoised canvas layers keep their identity.
 */
export function visibleItems(
  gridType: GridType,
  items: readonly CanvasItem[],
): readonly CanvasItem[] {
  if (gridType !== "circular") return items;
  const visible = items.filter((item) => isItemTypeAllowed(gridType, item.type));
  return visible.length === items.length ? items : visible;
}

/* ------------------------------------------------------------------ */
/* Builders (used by the tools)                                        */
/* ------------------------------------------------------------------ */

export function makeTile(init: TileInit): TileItem {
  return new Tile(init).toJSON();
}

/** Extra style a factory may carry, shared by line and stroke creation. */
export interface StrokeStyle {
  rounding?: ItemRounding;
  border?: ItemBorder;
  cap?: StrokeCap;
  join?: StrokeJoin;
}

export function makeLine(
  from: FragmentPoint,
  to: FragmentPoint,
  color?: string,
  style: StrokeStyle = {},
): LineItem {
  return new Line({ from, to, ...style, color }).toJSON();
}

export function makeStroke(
  points: readonly LinePoint[],
  closed: boolean,
  color?: string,
  style: StrokeStyle = {},
): StrokeItem {
  return new Stroke({ points: [...points], closed, ...style, color }).toJSON();
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
    // The icon box is not a board: `ratio: 1` (deliberately not a preset)
    // makes the ink fragment the whole cell so the glyph fills it exactly.
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
