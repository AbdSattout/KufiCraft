/**
 * Tests for the canvas items — one class per stored item type, sharing the
 * render / bounds / JSON contract with every other renderer in the app.
 *
 * The fixtures are built from `DEFAULT_PROJECT_CONFIG` with `base: 10` so the
 * canonical cell is 10 units wide with a 7.5 ink square. Items are compared as
 * plain JSON (the transport format) wherever that is what the editor stores.
 */

import { describe, expect, it } from "vitest";
import {
  CIRCULAR_ANGULAR_UNIT,
  DEFAULT_PROJECT_CONFIG,
  SHAPE_IDS,
  arcKey,
  itemSignature,
  lineKey,
  strokeKey,
  tileKey,
} from "@/lib/canvas/model";
import type {
  ArcDirection,
  ArcItem,
  ArcSize,
  CanvasItem,
  Cell,
  LineItem,
  ProjectConfig,
  Rotation,
  ShapeId,
  StrokeItem,
  TileItem,
  Zone,
} from "@/lib/canvas/model";
import {
  CENTER,
  inkUnit,
  polar,
  rectPath,
  zoneRect,
} from "@/lib/canvas/geometry";
import type { Point } from "@/lib/canvas/geometry";
import { cellCentre } from "@/lib/canvas/grid";
import {
  Arc,
  Line,
  Stroke,
  Tile,
  colorItem,
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
} from "@/lib/canvas/items";

/* ------------------------------------------------------------------ */
/* fixtures + helpers                                                  */
/* ------------------------------------------------------------------ */

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return { ...DEFAULT_PROJECT_CONFIG, base: 10, ...overrides };
}

const SQUARE = makeConfig();
const INKED = makeConfig({ ink: "#123456" });
const CIRCULAR = makeConfig({ gridType: "circular" });
const CIRCULAR_MONO = makeConfig({ gridType: "circular", ratio: 1 });

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

function stroke(points: Cell[], closed = false): StrokeItem {
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

  it("fills a straight line as one bar of ink", () => {
    const rendered = itemRender(SQUARE, line({ column: 0, row: 4 }, { column: 4, row: 4 }));
    expect(rendered).toEqual({
      path: rectPath({ x: 0, y: 40, w: 47.5, h: 7.5 }),
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
    expect(start.y).toBeCloseTo(6 * SQUARE.base + inkUnit(SQUARE), 6);
  });

  it("starts and ends an arc on the two cell centres of a circular grid", () => {
    const subject = new Arc({ from: { column: 5, row: 3 }, to: { column: 5, row: 8 }, direction: "clockwise", size: "half" });
    const { start, end } = endpoints(itemRender(CIRCULAR_MONO, subject).path);
    expectPointNear(start, cellCentre(CIRCULAR_MONO, subject.from), 0.5);
    expectPointNear(end, cellCentre(CIRCULAR_MONO, subject.to), 0.5);
  });
});

/* ------------------------------------------------------------------ */
/* bounds / contains                                                   */
/* ------------------------------------------------------------------ */

describe("bounds / contains", () => {
  it("contains the ink square and rejects the cell's space strip", () => {
    const subject = tile(1, 2, 0);
    expect(itemContains(SQUARE, subject, { x: 12, y: 22 })).toBe(true);
    expect(itemContains(SQUARE, subject, { x: 19, y: 22 })).toBe(false); // x space
    expect(itemContains(SQUARE, subject, { x: 12, y: 29 })).toBe(false); // y space
    const bounds = itemBounds(SQUARE, subject);
    expect(bounds).toEqual({ x: 10, y: 20, w: 7.5, h: 7.5 });
    expect(itemContains(SQUARE, subject, { x: bounds.x, y: bounds.y })).toBe(true);
  });

  it("pads a line's hit area by half an ink thickness", () => {
    const subject = line({ column: 0, row: 1 }, { column: 4, row: 1 });
    expect(itemBounds(SQUARE, subject)).toEqual({ x: 0, y: 10, w: 47.5, h: 7.5 });
    expect(itemContains(SQUARE, subject, { x: 5, y: 12 })).toBe(true); // on the bar
    expect(itemContains(SQUARE, subject, { x: 5, y: 19 })).toBe(true); // within ink/2
    expect(itemContains(SQUARE, subject, { x: 5, y: 25 })).toBe(false); // a cell away
    expect(itemContains(SQUARE, subject, { x: 5, y: 3 })).toBe(false); // the row above
  });

  it("contains a point within ink/2 of a string", () => {
    const subject = stroke([{ column: 0, row: 0 }, { column: 2, row: 2 }]);
    expect(itemContains(SQUARE, subject, { x: 3.75, y: 3.75 })).toBe(true);
    expect(itemContains(SQUARE, subject, { x: 100, y: 100 })).toBe(false);
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
    expect(itemsBounds(SQUARE, [])).toBeNull();
    expect(itemsBounds(SQUARE, [tile(0, 0, 0), tile(3, 4, 0)])).toEqual({
      x: 0,
      y: 0,
      w: 37.5,
      h: 47.5,
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
