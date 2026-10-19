/**
 * Tests for the canvas items — one class per stored item type, sharing the
 * render / bounds / JSON contract with every other renderer in the app.
 *
 * The fixtures are built from `DEFAULT_PROJECT_CONFIG` with `base: 10` — 100
 * drawn cells (`cellSize`), 1000/99.75 units wide with the last cell's space
 * cropped (docs/CANVAS.md §1). Items are compared as
 * plain JSON (the transport format) wherever that is what the editor stores.
 */

import { describe, expect, it } from "vitest";
import {
  BORDER_BOTTOM,
  BORDER_LEFT,
  BORDER_TOP,
  CIRCULAR_ANGULAR_UNIT,
  CORNER_ALL,
  CORNER_TOP_LEFT,
  DEFAULT_PROJECT_CONFIG,
  SHAPE_IDS,
  arcKey,
  canvasItemValidator,
  cellSize,
  itemSignature,
  lineKey,
  strokeKey,
  tileKey,
} from "@/lib/canvas/model";
import type {
  Anchor,
  ArcDirection,
  ArcItem,
  ArcSize,
  CanvasItem,
  CanvasItemType,
  Cell,
  LineItem,
  LinePoint,
  ProjectConfig,
  Rotation,
  ShapeId,
  StrokeItem,
  TileItem,
  Zone,
} from "@/lib/canvas/model";
import {
  CENTER,
  circularSlice,
  inkUnit,
  polar,
  rectPath,
  slicePath,
  zoneRect,
} from "@/lib/canvas/geometry";
import type { Point, Rect } from "@/lib/canvas/geometry";
import {
  Arc,
  Line,
  Stroke,
  Tile,
  colorItem,
  isItemAllowed,
  isItemTypeAllowed,
  itemBounds,
  itemCellRange,
  itemColor,
  itemContains,
  itemIntersectsRect,
  itemOf,
  itemRender,
  itemsBounds,
  keysOf,
  makeArc,
  makeLine,
  makeStroke,
  makeTile,
  moveItem,
  parseItem,
  styleItem,
  tileIconPath,
  visibleItems,
} from "@/lib/canvas/items";
import { shapePath } from "@/lib/canvas/shapes";

/* ------------------------------------------------------------------ */
/* fixtures + helpers                                                  */
/* ------------------------------------------------------------------ */

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return { ...DEFAULT_PROJECT_CONFIG, base: 10, ...overrides };
}

const SQUARE = makeConfig();
const INKED = makeConfig({ ink: "#123456" });
const CIRCULAR = makeConfig({ gridType: "circular" });

function tile(
  column: number,
  row: number,
  zone: Zone,
  extra: Partial<TileItem> = {},
): TileItem {
  return { type: "tile", key: tileKey(column, row, zone), column, row, zone, ...extra };
}

function line(from: Cell, to: Cell, color?: string): LineItem {
  return {
    type: "line",
    key: lineKey(from, to),
    from: { ...from },
    to: { ...to },
    ...(color === undefined ? {} : { color }),
  };
}

function arc(
  from: Cell,
  to: Cell,
  direction: ArcDirection = "clockwise",
  size: ArcSize = "half",
  color?: string,
): ArcItem {
  return {
    type: "arc",
    key: arcKey(from, to, direction, size),
    from: { ...from },
    to: { ...to },
    direction,
    size,
    ...(color === undefined ? {} : { color }),
  };
}

function stroke(points: readonly LinePoint[], closed = false): StrokeItem {
  return {
    type: "stroke",
    key: strokeKey(points, closed),
    points: points.map((point) => ({ ...point })),
    ...(closed ? { closed: true } : {}),
  };
}

/** SVG numbers, for reading endpoints back off a rendered path. */
const TOKEN = /[MLAZ]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

function endpoints(path: string): { start: Point; end: Point } {
  const tokens = path.match(TOKEN) ?? [];
  return {
    start: { x: Number(tokens[1]), y: Number(tokens[2]) },
    end: {
      x: Number(tokens[tokens.length - 2]),
      y: Number(tokens[tokens.length - 1]),
    },
  };
}

function expectPointNear(actual: Point, expected: Point, eps: number): void {
  expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThanOrEqual(eps);
}

function expectRectNear(actual: Rect, expected: Rect): void {
  expect(actual.x).toBeCloseTo(expected.x, 12);
  expect(actual.y).toBeCloseTo(expected.y, 12);
  expect(actual.w).toBeCloseTo(expected.w, 12);
  expect(actual.h).toBeCloseTo(expected.h, 12);
}

/* ------------------------------------------------------------------ */
/* identity / keys                                                     */
/* ------------------------------------------------------------------ */

describe("keys", () => {
  it("derives every key from the shared key helpers", () => {
    expect(new Tile({ column: 1, row: 2, zone: 3 }).key).toBe(tileKey(1, 2, 3));
    expect(new Tile({ column: 4, row: 0, zone: 1 }).key).toBe("tile:4:0:1");
    expect(new Stroke({ points: [{ column: 0, row: 0 }, { column: 2, row: 2 }] }).key).toBe(
      strokeKey([{ column: 0, row: 0 }, { column: 2, row: 2 }], false),
    );
    expect(arc({ column: 0, row: 6 }, { column: 4, row: 6 }).key).toBe(
      arcKey({ column: 0, row: 6 }, { column: 4, row: 6 }, "clockwise", "half"),
    );
  });

  it("canonicalises a line and an arc whichever endpoint came first", () => {
    const forward = new Line({ from: { column: 0, row: 1 }, to: { column: 4, row: 1 } });
    const backward = new Line({ from: { column: 4, row: 1 }, to: { column: 0, row: 1 } });
    expect(forward.key).toBe(lineKey({ column: 0, row: 1 }, { column: 4, row: 1 }));
    expect(backward.key).toBe(forward.key);
    expect(backward.toJSON()).toEqual(forward.toJSON());
    expect(lineKey({ column: 4, row: 1 }, { column: 0, row: 1 })).toBe(forward.key);

    const arcForward = new Arc({ from: { column: 0, row: 2 }, to: { column: 4, row: 2 }, direction: "clockwise", size: "half" });
    const arcBackward = new Arc({ from: { column: 4, row: 2 }, to: { column: 0, row: 2 }, direction: "clockwise", size: "half" });
    expect(arcBackward.key).toBe(arcForward.key);
    expect(arcBackward.toJSON()).toEqual(arcForward.toJSON());
  });

  it("distinguishes the stroke's closed flag", () => {
    const points = [{ column: 0, row: 0 }, { column: 2, row: 0 }, { column: 2, row: 2 }];
    expect(new Stroke({ points, closed: true }).key).toBe(strokeKey(points, true));
    expect(new Stroke({ points, closed: true }).key).not.toBe(
      new Stroke({ points }).key,
    );
  });

  it("carries the stroke's anchors into its key", () => {
    const plain = [{ column: 0, row: 0 }, { column: 2, row: 0 }];
    const anchored = [
      { column: 0, row: 0, anchor: { x: 0, y: 1 } },
      { column: 2, row: 0, anchor: { x: 1, y: 1 } },
    ];
    expect(new Stroke({ points: anchored }).key).toBe(strokeKey(anchored, false));
    expect(new Stroke({ points: anchored }).key).not.toBe(
      new Stroke({ points: plain }).key,
    );
  });
});

/* ------------------------------------------------------------------ */
/* JSON ⇄ class                                                        */
/* ------------------------------------------------------------------ */

describe("parseItem / itemOf", () => {
  it("rebuilds the class for every stored type, wrapping once per identity", () => {
    expect(parseItem(tile(0, 0, 0))).toBeInstanceOf(Tile);
    expect(parseItem(line({ column: 0, row: 1 }, { column: 4, row: 1 }))).toBeInstanceOf(Line);
    expect(parseItem(stroke([{ column: 0, row: 0 }, { column: 1, row: 1 }]))).toBeInstanceOf(Stroke);
    expect(parseItem(arc({ column: 0, row: 6 }, { column: 4, row: 6 }))).toBeInstanceOf(Arc);
    const json = tile(1, 2, 0);
    expect(itemOf(json)).toBe(itemOf(json));
  });

  it("round-trips a fully-styled tile", () => {
    const json = tile(1, 2, 3, { shape: "hamza1", rotation: 3, color: "#00ff00" });
    expect(parseItem(json).toJSON()).toEqual(json);
  });

  it("drops the tile's canonical shape / rotation but keeps the colour", () => {
    const json = tile(0, 0, 0, { shape: "square", rotation: 0, color: "#ff0000" });
    expect(parseItem(json).toJSON()).toEqual(tile(0, 0, 0, { color: "#ff0000" }));
  });

  it("gives the line and the arc identical JSON whichever endpoint came first", () => {
    expect(makeLine({ column: 4, row: 1 }, { column: 0, row: 1 })).toEqual(
      makeLine({ column: 0, row: 1 }, { column: 4, row: 1 }),
    );
    expect(
      makeArc({ from: { column: 4, row: 2 }, to: { column: 0, row: 2 }, direction: "clockwise", size: "half" }),
    ).toEqual(
      makeArc({ from: { column: 0, row: 2 }, to: { column: 4, row: 2 }, direction: "clockwise", size: "half" }),
    );
  });

  it("round-trips a stroke's anchors and drops the centre", () => {
    const json = makeStroke(
      [
        { column: 0, row: 0, anchor: { x: 0, y: 1 } },
        { column: 2, row: 0, anchor: { x: 0.5, y: 0.5 } },
      ],
      false,
    );
    // A centre anchor is storage-free: the point stays a plain cell.
    expect(json.points[1]).toEqual({ column: 2, row: 0 });
    expect(parseItem(json).toJSON()).toEqual(json);
  });
});

/* ------------------------------------------------------------------ */
/* render                                                              */
/* ------------------------------------------------------------------ */

describe("render", () => {
  it("fills a tile's zone rect and resolves its colour", () => {
    const subject = tile(1, 2, 0);
    const rendered = itemRender(SQUARE, subject);
    expect(rendered.mode).toBe("fill");
    expect(rendered.width).toBe(0);
    expect(rendered.path).toBe(rectPath(zoneRect(SQUARE, 1, 2, 0)));
    expect(itemColor(SQUARE, subject)).toBe(SQUARE.ink);
    expect(itemColor(INKED, subject)).toBe(INKED.ink);
    expect(itemColor(INKED, tile(1, 2, 0, { color: "#ff0000" }))).toBe("#ff0000");
  });

  it("falls back to the plain square for an absent or unknown shape", () => {
    const plain = itemRender(SQUARE, tile(0, 0, 0));
    const square = itemRender(SQUARE, tile(0, 0, 0, { shape: "square" }));
    const stranger = itemRender(SQUARE, { ...tile(0, 0, 0), shape: "hexagon" as ShapeId });
    expect(plain).toEqual(square);
    expect(stranger).toEqual(square);
    expect(square.path).toBe(rectPath(zoneRect(SQUARE, 0, 0, 0)));
  });

  it("strokes a polyline, an arc and a bent line at ink thickness", () => {
    const subjects = [
      stroke([{ column: 0, row: 0 }, { column: 2, row: 2 }]),
      arc({ column: 0, row: 6 }, { column: 4, row: 6 }),
      // A line that is neither axis-aligned (an invalid item) strokes through
      // the two cell centres rather than filling a bar.
      line({ column: 0, row: 0 }, { column: 2, row: 3 }),
    ];
    for (const subject of subjects) {
      const rendered = itemRender(SQUARE, subject);
      expect(rendered.mode).toBe("stroke");
      expect(rendered.width).toBe(inkUnit(SQUARE));
      expect(rendered.path).not.toBe("");
    }
  });

  it("strokes through a stroke's anchors, not its cell centres", () => {
    const cell = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    const subject = new Stroke({
      points: [
        { column: 0, row: 0, anchor: { x: 1, y: 1 } },
        { column: 2, row: 0, anchor: { x: 0, y: 0 } },
      ],
    });
    const { start, end } = endpoints(itemRender(SQUARE, subject.toJSON()).path);
    // The far ink corner of the cell is one ink in from its drawn origin.
    expectPointNear(start, { x: ink, y: ink }, 1e-6);
    // An anchored end is drawn exactly: no nudge out to the fragment edge.
    expectPointNear(end, { x: 2 * cell, y: 0 }, 1e-6);
  });

  it("nudges only a centre end out to the fragment edge", () => {
    const cell = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    const mixed = new Stroke({
      points: [
        // Centre end on the left …
        { column: 0, row: 0 },
        // … explicit anchor on the right, where the nudge would land.
        { column: 2, row: 0, anchor: { x: 0, y: 0.5 } },
      ],
    });
    const { start, end } = endpoints(itemRender(SQUARE, mixed.toJSON()).path);
    expectPointNear(start, { x: 0, y: ink / 2 }, 1e-6);
    expectPointNear(end, { x: 2 * cell, y: ink / 2 }, 1e-6);
  });

  it("fills a straight line as one bar of ink", () => {
    const cell = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    const rendered = itemRender(SQUARE, line({ column: 0, row: 4 }, { column: 4, row: 4 }));
    expect(rendered).toEqual({
      path: rectPath({ x: 0, y: 4 * cell, w: 4 * cell + ink, h: ink }),
      mode: "fill",
      width: 0,
    });
  });

  it("springs an arc from the ink edges between its two cells", () => {
    const subject = new Arc({ from: { column: 0, row: 6 }, to: { column: 4, row: 6 }, direction: "clockwise", size: "half" });
    const geometry = subject.geometry(SQUARE);
    const { start, end } = endpoints(itemRender(SQUARE, subject).path);
    expectPointNear(start, geometry.start, 1e-4);
    expectPointNear(end, geometry.end, 1e-4);
    // Clockwise springs off the bottom ink edge of the row.
    expect(start.y).toBeCloseTo(6 * cellSize(SQUARE) + inkUnit(SQUARE), 6);
  });

  it("fills a circular tile's slice at the board's own sector angle", () => {
    const twelve = makeConfig({ gridType: "circular", circularSectors: 12 });
    // The last sector of the ring, one 30° step short of the seam.
    expect(itemRender(twelve, tile(2, 11, 0))).toEqual({
      path: slicePath(circularSlice(twelve, 2, 11, 0)),
      mode: "fill",
      width: 0,
    });
  });

  it("draws a circular stroke through the board's own sector angles", () => {
    const twelve = makeConfig({ gridType: "circular", circularSectors: 12 });
    const unit = (2 * Math.PI) / 12;
    const radius = 2 * cellSize(twelve) + inkUnit(twelve);
    // Anchored ends are drawn exactly where they were placed (no nudge), so the
    // points sit at the board's own angles: 0° and 11 · 30° = 330°, where the
    // default 36-sector ring would have put the second point at 110°.
    const subject = stroke([
      { column: 2, row: 0, anchor: { x: 1, y: 0 } },
      { column: 2, row: 11, anchor: { x: 1, y: 0 } },
    ]);
    const { start, end } = endpoints(itemRender(twelve, subject).path);
    expectPointNear(start, polar(CENTER, CENTER, radius, 0), 1e-6);
    expectPointNear(end, polar(CENTER, CENTER, radius, 11 * unit), 1e-6);
  });
});

/* ------------------------------------------------------------------ */
/* bounds / contains                                                   */
/* ------------------------------------------------------------------ */

describe("bounds / contains", () => {
  it("contains the ink square and rejects the cell's space strip", () => {
    const cell = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    const subject = tile(1, 2, 0);
    expect(itemContains(SQUARE, subject, { x: cell + ink / 2, y: 2 * cell + ink / 2 })).toBe(true);
    expect(itemContains(SQUARE, subject, { x: cell + ink + 0.01, y: 2 * cell })).toBe(false); // x space
    expect(itemContains(SQUARE, subject, { x: cell, y: 2 * cell + ink + 0.01 })).toBe(false); // y space
    const bounds = itemBounds(SQUARE, subject);
    expect(bounds).toEqual({ x: cell, y: 2 * cell, w: ink, h: ink });
    expect(itemContains(SQUARE, subject, { x: bounds.x, y: bounds.y })).toBe(true);
  });

  it("pads a line's hit area by half an ink thickness", () => {
    const cell = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    const subject = line({ column: 0, row: 1 }, { column: 4, row: 1 });
    expect(itemBounds(SQUARE, subject)).toEqual({ x: 0, y: cell, w: 4 * cell + ink, h: ink });
    expect(itemContains(SQUARE, subject, { x: 5, y: cell + ink / 2 })).toBe(true); // on the bar
    expect(itemContains(SQUARE, subject, { x: 5, y: cell + ink + 1 })).toBe(true); // within ink/2
    expect(itemContains(SQUARE, subject, { x: 5, y: 25 })).toBe(false); // a cell away
    expect(itemContains(SQUARE, subject, { x: 5, y: 3 })).toBe(false); // the row above
  });

  it("contains a point within ink/2 of a string", () => {
    const subject = stroke([{ column: 0, row: 0 }, { column: 2, row: 2 }]);
    const ink = inkUnit(SQUARE);
    expect(itemContains(SQUARE, subject, { x: ink / 2, y: ink / 2 })).toBe(true);
    expect(itemContains(SQUARE, subject, { x: 100, y: 100 })).toBe(false);
  });

  it("follows a stroke's anchors for bounds and hit tests", () => {
    const cell = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    const subject = stroke([
      { column: 0, row: 0, anchor: { x: 1, y: 1 } },
      { column: 2, row: 0, anchor: { x: 0, y: 0 } },
    ]);
    // Both ends are anchored, so no nudge: the segment runs
    // (ink, ink) → (2·cell, 0), padded by half an ink on every side.
    expect(itemBounds(SQUARE, subject)).toEqual({
      x: ink / 2,
      y: -ink / 2,
      w: 2 * cell,
      h: 2 * ink,
    });
    expect(itemContains(SQUARE, subject, { x: ink / 2 + cell, y: ink / 2 })).toBe(true);
    // The fence's own cell centre is off the drawing.
    expect(itemContains(SQUARE, subject, { x: ink / 2, y: ink / 2 })).toBe(false);
  });

  it("tests radial and angular points of a circular tile", () => {
    const subject = tile(2, 0, 0);
    const at = (radius: number, sectors: number) =>
      polar(CENTER, CENTER, radius, sectors * CIRCULAR_ANGULAR_UNIT);
    expect(itemContains(CIRCULAR, subject, at(23.75, 0.3))).toBe(true);
    expect(itemContains(CIRCULAR, subject, at(29, 0.3))).toBe(false); // outside r2
    expect(itemContains(CIRCULAR, subject, at(23.75, 0.9))).toBe(false); // past the angle
  });

  it("contains a point on an arc within its ink thickness", () => {
    const subject = arc({ column: 0, row: 6 }, { column: 4, row: 6 });
    // The semicircle peaks one radius above its centre line.
    expect(itemContains(SQUARE, subject, { x: 23.75, y: 47.5 })).toBe(true);
    expect(itemContains(SQUARE, subject, { x: 500, y: 500 })).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* cellRange / moved                                                   */
/* ------------------------------------------------------------------ */

describe("cellRange / moved", () => {
  it("reports inclusive cell ranges", () => {
    expect(itemCellRange(tile(3, 4, 1))).toEqual({
      minColumn: 3,
      maxColumn: 3,
      minRow: 4,
      maxRow: 4,
    });
    expect(itemCellRange(line({ column: 0, row: 1 }, { column: 4, row: 1 }))).toEqual({
      minColumn: 0,
      maxColumn: 4,
      minRow: 1,
      maxRow: 1,
    });
    expect(
      itemCellRange(stroke([{ column: 0, row: 0 }, { column: 2, row: 2 }, { column: 5, row: 1 }])),
    ).toEqual({ minColumn: 0, maxColumn: 5, minRow: 0, maxRow: 2 });
    expect(itemCellRange(arc({ column: 0, row: 6 }, { column: 4, row: 6 }))).toEqual({
      minColumn: 0,
      maxColumn: 4,
      minRow: 6,
      maxRow: 6,
    });
  });

  it("shifts whole cells and lets the derived key follow", () => {
    const movedTile = moveItem(tile(1, 2, 0), 3, -1);
    expect(movedTile).toEqual(makeTile({ column: 4, row: 1, zone: 0 }));
    expect(movedTile.key).toBe(tileKey(4, 1, 0));
    expect(moveItem(line({ column: 0, row: 1 }, { column: 4, row: 1 }), 1, 0)).toEqual(
      makeLine({ column: 1, row: 1 }, { column: 5, row: 1 }),
    );
    expect(moveItem(arc({ column: 0, row: 6 }, { column: 4, row: 6 }), 0, 1)).toEqual(
      makeArc({ from: { column: 0, row: 7 }, to: { column: 4, row: 7 }, direction: "clockwise", size: "half" }),
    );
    expect(moveItem(stroke([{ column: 0, row: 0 }, { column: 2, row: 2 }]), 2, 2)).toEqual(
      makeStroke([{ column: 2, row: 2 }, { column: 4, row: 4 }], false),
    );
    expect(
      moveItem(
        stroke([
          { column: 0, row: 0, anchor: { x: 0, y: 1 } },
          { column: 2, row: 2, anchor: { x: 1, y: 1 } },
        ]),
        1,
        -1,
      ),
    ).toEqual(
      makeStroke(
        [
          { column: 1, row: -1, anchor: { x: 0, y: 1 } },
          { column: 3, row: 1, anchor: { x: 1, y: 1 } },
        ],
        false,
      ),
    );
  });
});

/* ------------------------------------------------------------------ */
/* colour / style                                                      */
/* ------------------------------------------------------------------ */

describe("colorItem / styleItem", () => {
  it("adds and removes a colour override", () => {
    const red = colorItem(tile(1, 2, 0), "#ff0000");
    expect(red).toEqual({ ...tile(1, 2, 0), color: "#ff0000" });
    expect(colorItem(red, undefined)).toEqual(tile(1, 2, 0));
    expect(itemColor(INKED, red)).toBe("#ff0000");
  });

  it("applies shape / rotation to a tile and keeps its colour", () => {
    const subject = colorItem(tile(1, 2, 0), "#00ff00");
    expect(styleItem(subject, { shape: "circle", rotation: 2 })).toEqual(
      makeTile({ column: 1, row: 2, zone: 0, shape: "circle", rotation: 2, color: "#00ff00" }),
    );
    // Canonical defaults are dropped again by `toJSON`.
    expect(
      styleItem(
        makeTile({ column: 0, row: 0, zone: 0, shape: "circle", rotation: 2, color: "#abc" }),
        { shape: "square", rotation: 0 },
      ),
    ).toEqual(makeTile({ column: 0, row: 0, zone: 0, color: "#abc" }));
  });

  it("is a no-op on items without a shape", () => {
    const subject = line({ column: 0, row: 1 }, { column: 4, row: 1 });
    expect(styleItem(subject, { shape: "circle", rotation: 3 })).toEqual(subject);
    const string = stroke([{ column: 0, row: 0 }, { column: 2, row: 2 }]);
    expect(styleItem(string, { shape: "triangle" })).toEqual(string);
    expect(styleItem(arc({ column: 0, row: 6 }, { column: 4, row: 6 }), { rotation: 2 })).toEqual(
      arc({ column: 0, row: 6 }, { column: 4, row: 6 }),
    );
  });
});

/* ------------------------------------------------------------------ */
/* rounding / border                                                   */
/* ------------------------------------------------------------------ */

describe("rounding / border", () => {
  const ROUNDING = { radius: 0.2, corners: CORNER_TOP_LEFT };
  const BORDER = { sides: BORDER_TOP | BORDER_LEFT, width: 3, color: "#7c2d12" };

  it("rounds a tile's own path in the shape box", () => {
    const subject = parseItem(
      makeTile({ column: 1, row: 2, zone: 0, rounding: ROUNDING }),
    );
    const rendered = subject.render(SQUARE);
    expect(rendered.path).toBe(
      shapePath("square", zoneRect(SQUARE, 1, 2, 0), 0, ROUNDING),
    );
    expect(rendered.path).toContain(" C ");
    expect(subject.toJSON()).toMatchObject({ rounding: ROUNDING });
  });

  it("treats a zero radius as the off state", () => {
    const subject = parseItem(
      makeTile({
        column: 0,
        row: 0,
        zone: 0,
        rounding: { radius: 0, corners: CORNER_ALL },
      }),
    );
    expect(subject.toJSON()).not.toHaveProperty("rounding");
    expect(subject.render(SQUARE).path).toBe(rectPath(zoneRect(SQUARE, 0, 0, 0)));
  });

  it("round-trips rounding and borders through JSON", () => {
    const roundedTile = tile(1, 2, 0, { rounding: ROUNDING, border: BORDER });
    expect(parseItem(roundedTile).toJSON()).toEqual(roundedTile);

    const bordered: LineItem = {
      ...line({ column: 0, row: 1 }, { column: 4, row: 1 }),
      border: { sides: BORDER_BOTTOM, width: 2 },
    };
    expect(parseItem(bordered).toJSON()).toEqual(bordered);
  });

  it("styles and clears every item type", () => {
    const subject = tile(1, 2, 0);
    const styled = styleItem(subject, { rounding: ROUNDING, border: BORDER });
    expect(styled).toEqual(
      makeTile({ column: 1, row: 2, zone: 0, rounding: ROUNDING, border: BORDER }),
    );
    expect(styleItem(styled, { rounding: ROUNDING, border: BORDER })).toBe(styled);
    expect(styleItem(styled, { rounding: null, border: null })).toEqual(subject);

    const items = [
      line({ column: 0, row: 1 }, { column: 4, row: 1 }),
      stroke([{ column: 0, row: 0 }, { column: 2, row: 2 }]),
    ];
    for (const item of items) {
      const next = styleItem(item, { border: BORDER, rounding: ROUNDING });
      expect(next).not.toBe(item);
      expect(next).toMatchObject({ border: BORDER, rounding: ROUNDING });
      expect(styleItem(next, { border: null, rounding: null })).toEqual(item);
    }

    // An arc has no corners to round; it carries the border alone.
    const rib = arc({ column: 0, row: 6 }, { column: 4, row: 6 });
    expect(styleItem(rib, { border: BORDER })).toMatchObject({ border: BORDER });
    expect(styleItem(rib, { rounding: ROUNDING })).toBe(rib);
  });

  it("carries the style through moved() and withColor()", () => {
    const subject = makeTile({
      column: 1,
      row: 2,
      zone: 0,
      color: "#00ff00",
      rounding: ROUNDING,
      border: BORDER,
    });
    expect(moveItem(subject, 2, 3)).toMatchObject({
      column: 3,
      row: 5,
      color: "#00ff00",
      rounding: ROUNDING,
      border: BORDER,
    });
    expect(colorItem(subject, "#ff0000")).toMatchObject({
      color: "#ff0000",
      rounding: ROUNDING,
      border: BORDER,
    });
  });

  it("duplicates in draw(), while render() stays the item's own paint", () => {
    const subject = parseItem(
      makeTile({ column: 0, row: 0, zone: 0, border: BORDER }),
    );
    const rendered = subject.render(SQUARE);
    expect(rendered.borders).toBeUndefined();

    const drawn = subject.draw(SQUARE);
    expect(drawn.path).toBe(rendered.path);
    // One copy per enabled side, translated by the width; the path is the
    // item's own path, so both renderers can paint the same duplicate.
    expect(drawn.borders).toEqual([
      { dx: 0, dy: -3, color: "#7c2d12" },
      { dx: -3, dy: 0, color: "#7c2d12" },
    ]);
    expect(drawn.mode).toBe("fill");

    // Without a border `draw` paints exactly `render`.
    const plain = parseItem(makeTile({ column: 0, row: 0, zone: 0 }));
    expect(plain.draw(SQUARE)).toEqual(plain.render(SQUARE));
  });

  it("falls back to the resolved item colour for the duplicate", () => {
    const subject = parseItem(
      makeTile({
        column: 0,
        row: 0,
        zone: 0,
        color: "#abcdef",
        border: { sides: BORDER_TOP, width: 2 },
      }),
    );
    expect(subject.draw(SQUARE).borders?.[0].color).toBe("#abcdef");
    expect(
      parseItem(
        makeTile({
          column: 0,
          row: 0,
          zone: 0,
          border: { sides: BORDER_TOP, width: 2 },
        }),
      ).draw(INKED).borders?.[0].color,
    ).toBe("#123456");
  });

  it("canonicalises a style patch before it reaches an item", () => {
    // A width-only border patch with no side on is the off state: it clears
    // instead of storing an invisible `sides: 0` outline.
    const bordered = styleItem(tile(1, 2, 0), { border: BORDER });
    expect(styleItem(bordered, { border: { sides: 0, width: 5 } })).toEqual(
      tile(1, 2, 0),
    );
    // The same clamps the backend applies: radius 0.9 → 0.5, width 99 → 12.
    expect(
      styleItem(tile(0, 0, 0), {
        rounding: { radius: 0.9, corners: CORNER_ALL },
        border: { sides: BORDER_TOP, width: 99, color: "" },
      }),
    ).toMatchObject({
      rounding: { radius: 0.5, corners: CORNER_ALL },
      border: { sides: BORDER_TOP, width: 12 },
    });
  });

  it("duplicates a run, a polyline and an arc with the same path", () => {
    const border = { sides: BORDER_TOP | BORDER_LEFT, width: 2 };
    const items = [
      line({ column: 0, row: 1 }, { column: 4, row: 1 }),
      stroke([
        { column: 0, row: 0 },
        { column: 2, row: 2 },
      ]),
      arc({ column: 0, row: 6 }, { column: 4, row: 6 }),
    ];
    for (const item of items) {
      const bordered = styleItem(item, { border });
      const drawn = parseItem(bordered).draw(SQUARE);
      expect(drawn.path).toBe(itemRender(SQUARE, bordered).path);
      expect(drawn.borders).toEqual([
        { dx: 0, dy: -2, color: SQUARE.ink },
        { dx: -2, dy: 0, color: SQUARE.ink },
      ]);
    }
  });

  it("rounds a line bar and a polyline's turns", () => {
    const bar: LineItem = {
      ...line({ column: 0, row: 1 }, { column: 4, row: 1 }),
      rounding: { radius: 0.4, corners: CORNER_ALL },
    };
    const barPath = parseItem(bar).render(SQUARE).path;
    expect(barPath).toBe(
      shapePath("square", itemBounds(SQUARE, bar), 0, bar.rounding),
    );
    expect(barPath).toContain(" C ");

    const polyline: StrokeItem = {
      ...stroke([
        { column: 0, row: 0 },
        { column: 3, row: 0 },
        { column: 3, row: 3 },
      ]),
      rounding: { radius: 0.1, corners: CORNER_ALL },
    };
    const rounded = parseItem(polyline).render(SQUARE).path;
    expect(rounded).toContain(" C ");
    // The two ends stay square (a turn is what rounds), and the JSON keeps it.
    expect(parseItem(polyline).toJSON()).toMatchObject({
      rounding: polyline.rounding,
    });
    const plain = parseItem({ ...polyline, rounding: undefined });
    expect(plain.render(SQUARE).path).not.toContain(" C ");
  });

  it("is part of the item signature", () => {
    const plain = tile(1, 2, 0);
    expect(itemSignature(plain)).not.toBe(
      itemSignature(tile(1, 2, 0, { rounding: ROUNDING })),
    );
    expect(itemSignature(plain)).not.toBe(
      itemSignature(tile(1, 2, 0, { border: BORDER })),
    );
    const run = line({ column: 0, row: 1 }, { column: 4, row: 1 });
    expect(itemSignature(run)).not.toBe(
      itemSignature({ ...run, rounding: ROUNDING }),
    );
    const polyline = stroke([
      { column: 0, row: 0 },
      { column: 2, row: 2 },
    ]);
    expect(itemSignature(polyline)).not.toBe(
      itemSignature({ ...polyline, rounding: ROUNDING }),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Arc.isSupported                                                     */
/* ------------------------------------------------------------------ */

describe("Arc.isSupported", () => {
  it("accepts a shared axis or a 45° diagonal only", () => {
    const origin: Cell = { column: 0, row: 0 };
    expect(Arc.isSupported(origin, origin)).toBe(false);
    expect(Arc.isSupported(origin, { column: 5, row: 0 })).toBe(true);
    expect(Arc.isSupported(origin, { column: 0, row: 5 })).toBe(true);
    expect(Arc.isSupported(origin, { column: 3, row: 3 })).toBe(true);
    expect(Arc.isSupported(origin, { column: 3, row: 5 })).toBe(false);
    expect(Arc.isSupported({ column: 7, row: 2 }, { column: 4, row: 5 })).toBe(true);
    expect(Arc.isSupported({ column: 7, row: 2 }, { column: 4, row: 6 })).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* toolbar icons                                                       */
/* ------------------------------------------------------------------ */

describe("tileIconPath", () => {
  it("draws every palette entry inside the icon box", () => {
    for (const shape of SHAPE_IDS) {
      const path = tileIconPath(shape, 0, 100);
      expect(path).not.toBe("");
      expect(path.startsWith("M ")).toBe(true);
    }
    // An absent shape is the plain square filling the whole 0 0 100 100 box.
    expect(tileIconPath(undefined, 0, 100)).toBe("M 0 0 L 100 0 L 100 100 L 0 100 Z");
  });

  it("gives one shape four distinct paths across its rotations", () => {
    const rotations: Rotation[] = [0, 1, 2, 3];
    const paths = rotations.map((rotation) => tileIconPath("triangle", rotation, 100));
    expect(new Set(paths).size).toBe(4);
  });
});

/* ------------------------------------------------------------------ */
/* item-level helpers                                                  */
/* ------------------------------------------------------------------ */

describe("item-level helpers", () => {
  it("collects keys in order", () => {
    expect(keysOf([tile(1, 2, 0), line({ column: 0, row: 1 }, { column: 4, row: 1 })])).toEqual([
      tileKey(1, 2, 0),
      lineKey({ column: 0, row: 1 }, { column: 4, row: 1 }),
    ]);
    expect(keysOf([])).toEqual([]);
  });

  it("unions the bounds of a list, or null when there are none", () => {
    const cell = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    expect(itemsBounds(SQUARE, [])).toBeNull();
    expect(itemsBounds(SQUARE, [tile(0, 0, 0), tile(3, 4, 0)])).toEqual({
      x: 0,
      y: 0,
      w: 3 * cell + ink,
      h: 4 * cell + ink,
    });
  });

  it("intersects a marquee rectangle inclusively", () => {
    const subject = tile(0, 0, 0);
    expect(itemIntersectsRect(SQUARE, subject, { x: 5, y: 5, w: 1, h: 1 })).toBe(true);
    expect(itemIntersectsRect(SQUARE, subject, { x: 7.5, y: 7.5, w: 1, h: 1 })).toBe(true);
    expect(itemIntersectsRect(SQUARE, subject, { x: 100, y: 100, w: 1, h: 1 })).toBe(false);
  });

  it("signs equal items equally and field changes differently", () => {
    // `itemSignature` is defined in the shared model, not in items.ts; the
    // classes are what items.ts owns, and their JSON is what gets signed.
    const subject = tile(1, 2, 0);
    expect(itemSignature(subject)).toBe(itemSignature(parseItem(subject).toJSON()));
    expect(itemSignature(subject)).not.toBe(itemSignature({ ...subject, shape: "circle" }));
    expect(itemSignature(subject)).not.toBe(itemSignature({ ...subject, color: "#ffffff" }));
  });

  it("signs every item type distinctly", () => {
    const items: CanvasItem[] = [
      tile(0, 0, 0),
      line({ column: 0, row: 1 }, { column: 4, row: 1 }),
      stroke([{ column: 0, row: 0 }, { column: 1, row: 1 }]),
      arc({ column: 0, row: 6 }, { column: 4, row: 6 }),
    ];
    expect(new Set(items.map(itemSignature)).size).toBe(items.length);
  });
});

/* ------------------------------------------------------------------ */
/* stored shape (the shared wire validator)                            */
/* ------------------------------------------------------------------ */

/**
 * The fields `canvasItemValidator` demands for `type`, read off the validator
 * itself so this sweep cannot drift from the contract. `convex/values` has no
 * public "validate this value" entry point on the client, so the test compares
 * key sets instead: an **extra** key is exactly what Convex rejected in the
 * field — an `Anchor`'s `zone` riding along on `from` / `to`.
 */
interface RawValidator {
  value?: unknown;
  fields?: Record<string, RawValidator>;
  members?: RawValidator[];
  isOptional?: "required" | "optional";
}

function validatorFields(type: CanvasItemType): {
  required: string[];
  allowed: string[];
} {
  const union = canvasItemValidator as unknown as RawValidator;
  const member = (union.members ?? []).find(
    (candidate) => candidate.fields?.type?.value === type,
  );
  if (!member?.fields) throw new Error(`no validator member for ${type}`);
  const required: string[] = [];
  const allowed: string[] = [];
  for (const [field, validator] of Object.entries(member.fields)) {
    allowed.push(field);
    if (validator.isOptional !== "optional") required.push(field);
  }
  return { required, allowed };
}

/** Asserts an item is exactly what the server's validator accepts. */
function expectStoredShape(item: CanvasItem): void {
  const { required, allowed } = validatorFields(item.type);
  const keys = Object.keys(item);
  expect(keys.filter((key) => !allowed.includes(key))).toEqual([]);
  expect(required.filter((key) => !keys.includes(key))).toEqual([]);
  // A fragment is exactly `{column, row}` for the ink fragment (zone 0 is
  // canonical storage of nothing) and `{column, row, zone}` for a space
  // fragment — `fragmentValidator`/`linePointValidator` accept exactly those.
  const fragments =
    item.type === "line" || item.type === "arc"
      ? [item.from, item.to]
      : item.type === "stroke"
        ? item.points
        : [];
  for (const fragment of fragments) {
    const keys = Object.keys(fragment).sort();
    expect(keys).toEqual(
      (fragment.zone ?? 0) === 0
        ? ["column", "row"]
        : ["column", "row", "zone"],
    );
  }
}

/* ------------------------------------------------------------------ */
/* fragments                                                           */
/* ------------------------------------------------------------------ */

describe("fragment geometry", () => {
  it("draws a bar over the fragments its ends address", () => {
    const base = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    // Horizontal run of two x-space fragments: the bar is that stripe, from
    // the first space square's start to the second's end, ink thick.
    expectRectNear(
      new Line({
        from: { column: 1, row: 3, zone: 1 },
        to: { column: 3, row: 3, zone: 1 },
      }).bar(SQUARE),
      { x: base + ink, y: 3 * base, w: 3 * base - ink, h: ink },
    );
    // Vertical run of y-space fragments: the same rule on the other axis.
    expectRectNear(
      new Line({
        from: { column: 2, row: 1, zone: 2 },
        to: { column: 2, row: 3, zone: 2 },
      }).bar(SQUARE),
      { x: 2 * base, y: base + ink, w: ink, h: 3 * base - ink },
    );
    // Ink ends are exactly the pre-fragment bar.
    expectRectNear(
      new Line({
        from: { column: 1, row: 1 },
        to: { column: 4, row: 1 },
      }).bar(SQUARE),
      { x: base, y: base, w: 3 * base + ink, h: ink },
    );
  });

  it("nudges a stroke's centre ends to their own fragment edges", () => {
    const base = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    // Two centre points on the x-space stripe: each end reaches the edge of
    // the space square it sits on, not the ink square's edge.
    expect(
      new Stroke({
        points: [
          { column: 1, row: 0, zone: 1 },
          { column: 2, row: 0, zone: 1 },
        ],
      }).anchorPoints(SQUARE),
    ).toEqual([
      { x: base + ink, y: ink / 2 },
      { x: 3 * base, y: ink / 2 },
    ]);
    // …and the ink stripe keeps the pre-fragment half-ink nudge.
    expect(
      new Stroke({
        points: [
          { column: 1, row: 0 },
          { column: 2, row: 0 },
        ],
      }).anchorPoints(SQUARE),
    ).toEqual([
      { x: base, y: ink / 2 },
      { x: 2 * base + ink, y: ink / 2 },
    ]);
    // The fragment width, not the ink width, is what the end reaches: at a
    // denser preset the two differ.
    const dense = makeConfig({ ratio: 4 / 5 });
    const denseSpace = cellSize(dense) - inkUnit(dense);
    const nudged = new Stroke({
      points: [
        { column: 1, row: 0, zone: 1 },
        { column: 2, row: 0, zone: 1 },
      ],
    }).anchorPoints(dense);
    expect(nudged[0].x).toBeCloseTo(cellSize(dense) + inkUnit(dense), 12);
    expect(nudged[1].x).toBeCloseTo(
      2 * cellSize(dense) + inkUnit(dense) + denseSpace,
      12,
    );
  });

  it("springs an arc off the space fragments its ends address", () => {
    const base = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    const space = base - ink;
    // Horizontal rib through the x-space stripe: the springs sit at the
    // space squares' mid-width, on the y-ink edge (clockwise → bottom).
    const geometry = new Arc({
      from: { column: 0, row: 0, zone: 1 },
      to: { column: 2, row: 0, zone: 1 },
      direction: "clockwise",
      size: "half",
    }).geometry(SQUARE);
    expect(geometry.start).toEqual({ x: ink + space / 2, y: ink });
    expect(geometry.end).toEqual({
      x: 2 * base + ink + space / 2,
      y: ink,
    });
    // Counter-clockwise springs off the top of the same space squares.
    expect(
      new Arc({
        from: { column: 0, row: 0, zone: 1 },
        to: { column: 2, row: 0, zone: 1 },
        direction: "counterclockwise",
        size: "half",
      }).geometry(SQUARE).start,
    ).toEqual({ x: ink + space / 2, y: 0 });
  });

  it("keeps every fragment when an item moves", () => {
    const zoneEnd = { column: 1, row: 1, zone: 2 as Zone };
    const otherEnd = { column: 1, row: 3, zone: 2 as Zone };
    const lineItem = moveItem(
      new Line({ from: zoneEnd, to: otherEnd }).toJSON(),
      2,
      1,
    );
    expect(lineItem).toMatchObject({
      from: { column: 3, row: 2, zone: 2 },
      to: { column: 3, row: 4, zone: 2 },
      key: lineKey(
        { column: 3, row: 2, zone: 2 },
        { column: 3, row: 4, zone: 2 },
      ),
    });
    const arcItem = moveItem(
      new Arc({
        from: zoneEnd,
        to: otherEnd,
        direction: "clockwise",
        size: "half",
      }).toJSON(),
      2,
      1,
    );
    expect(arcItem).toMatchObject({
      from: { column: 3, row: 2, zone: 2 },
      to: { column: 3, row: 4, zone: 2 },
    });
    const strokeItem = moveItem(
      new Stroke({
        points: [
          { column: 0, row: 0 },
          { column: 2, row: 0, zone: 3, anchor: { x: 0.5, y: 0 } },
        ],
      }).toJSON(),
      1,
      1,
    );
    expect(strokeItem).toMatchObject({
      points: [
        { column: 1, row: 1 },
        { column: 3, row: 1, zone: 3, anchor: { x: 0.5, y: 0 } },
      ],
    });
  });
});

describe("stored shape", () => {
  it("emits exactly the validator's fields for every item type", () => {
    const anchor: Anchor = { column: 3, row: 33, zone: 0 };
    const other: Anchor = { column: 3, row: 35, zone: 0 };
    const subjects: CanvasItem[] = [
      makeTile({ column: 1, row: 2, zone: 3 }),
      makeTile({
        column: 1,
        row: 2,
        zone: 0,
        shape: "hamza1",
        rotation: 3,
        color: "#9f1239",
      }),
      makeLine({ column: 1, row: 1 }, { column: 4, row: 1 }),
      makeLine({ column: 1, row: 1 }, { column: 4, row: 1 }, "#9f1239"),
      makeStroke([{ column: 0, row: 0 }, { column: 2, row: 2 }], true, "#9f1239"),
      makeArc({
        from: { column: 1, row: 1 },
        to: { column: 4, row: 1 },
        direction: "clockwise",
        size: "half",
        color: "#9f1239",
      }),
      // The tool hands the class `Anchor`s (a cell plus a zone); the class
      // canonicalises the ink zone away and keeps a space zone.
      makeLine(anchor, other),
      makeArc({ from: anchor, to: other, direction: "clockwise", size: "half" }),
    ];
    for (const subject of subjects) expectStoredShape(subject);
  });

  it("keeps the shape through the edit paths too", () => {
    const anchor: Anchor = { column: 3, row: 33, zone: 0 };
    const other: Anchor = { column: 3, row: 35, zone: 0 };
    const subjects: CanvasItem[] = [
      makeTile({ column: 1, row: 2, zone: 0 }),
      makeLine(anchor, other),
      makeStroke([{ column: 0, row: 0 }, { column: 2, row: 2 }], false),
      makeArc({ from: anchor, to: other, direction: "clockwise", size: "half" }),
    ];
    for (const subject of subjects) {
      for (const edited of [
        moveItem(subject, 1, 2),
        colorItem(subject, "#9f1239"),
        colorItem(subject, undefined),
        styleItem(subject, { shape: "hamza1", rotation: 1 }),
        parseItem(subject).toJSON(),
      ]) {
        expectStoredShape(edited);
      }
    }
  });

  it("copies tool-shaped anchors to plain fragments", () => {
    // A tool hands the class its `Anchor` objects; the class must copy the
    // fields it stores and drop the rest (docs/CANVAS.md §3). The ink zone is
    // canonical storage of nothing, so it is dropped; a space fragment keeps
    // its zone — that is what makes the end stay on the square clicked.
    const anchor: Anchor = { column: 3, row: 33, zone: 0 };
    const other: Anchor = { column: 3, row: 35, zone: 2 };
    const drawn = new Arc({
      from: anchor,
      to: other,
      direction: "clockwise",
      size: "half",
    });
    expect(drawn.toJSON()).toEqual({
      type: "arc",
      key: arcKey(
        { column: 3, row: 33 },
        { column: 3, row: 35, zone: 2 },
        "clockwise",
        "half",
      ),
      from: { column: 3, row: 33 },
      to: { column: 3, row: 35, zone: 2 },
      direction: "clockwise",
      size: "half",
    });
    expect(drawn.toJSON().from).not.toBe(anchor);
    expect(
      new Line({ from: anchor, to: other }).toJSON().from,
    ).toEqual({ column: 3, row: 33 });
    const points = new Stroke({ points: [anchor, other] }).toJSON().points;
    expect(Object.keys(points[0])).toEqual(["column", "row"]);
    expect(points[1]).toEqual({ column: 3, row: 35, zone: 2 });
  });
});

/* ------------------------------------------------------------------ */
/* per-grid item rules                                                 */
/* ------------------------------------------------------------------ */

describe("per-grid item rules", () => {
  const items: CanvasItem[] = [
    tile(1, 2, 0),
    line({ column: 0, row: 1 }, { column: 4, row: 1 }),
    stroke([{ column: 0, row: 0 }, { column: 1, row: 1 }]),
    arc({ column: 0, row: 6 }, { column: 4, row: 6 }),
  ];

  it("hides exactly the line and the arc on a circular grid", () => {
    expect(isItemTypeAllowed("square", "line")).toBe(true);
    expect(isItemTypeAllowed("square", "arc")).toBe(true);
    expect(isItemTypeAllowed("circular", "line")).toBe(false);
    expect(isItemTypeAllowed("circular", "arc")).toBe(false);
    for (const type of ["tile", "stroke"] as const) {
      expect(isItemTypeAllowed("square", type)).toBe(true);
      expect(isItemTypeAllowed("circular", type)).toBe(true);
    }

    expect(items.filter((item) => isItemAllowed(CIRCULAR, item))).toEqual([
      items[0],
      items[2],
    ]);
    expect(visibleItems("circular", items)).toEqual([items[0], items[2]]);
  });

  it("returns the same array when nothing is hidden", () => {
    expect(visibleItems("square", items)).toBe(items);
    const already = items.filter((item) => isItemAllowed(CIRCULAR, item));
    expect(visibleItems("circular", already)).toBe(already);
    const visible = visibleItems("circular", items);
    expect(visibleItems("circular", visible)).toBe(visible);
  });
});
