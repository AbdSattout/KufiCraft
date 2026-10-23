import { describe, expect, it } from "vitest";
import {
  BORDER_ALL,
  BORDER_BOTTOM,
  BORDER_LEFT,
  BORDER_TOP,
  CORNER_ALL,
  DEFAULT_BORDER,
  DEFAULT_PROJECT_CONFIG,
  RATIO_PRESETS,
  arcKey,
  cellSize,
  lineKey,
  linePoint,
  maxGridIndex,
  tileKey,
} from "@/lib/canvas/model";
import type {
  Anchor,
  CanvasItem,
  ProjectConfig,
  StrokeItem,
  TileItem,
  Zone,
} from "@/lib/canvas/model";
import { makeArc, makeLine, makeStroke, makeTile } from "@/lib/canvas/items";
import { inkUnit } from "@/lib/canvas/geometry";
import { lineItems } from "@/lib/canvas/ops";
import {
  DEFAULT_ARC_STYLE,
  DEFAULT_STYLE,
  WHEEL_GESTURE_GAP_MS,
  applyDrawStyle,
  WHEEL_GESTURE_MAX_STOPS,
  WHEEL_IDLE,
  anchorAt,
  anchorsAlongLine,
  anchorsAlongStroke,
  arcBetween,
  cellLimits,
  centreScroll,
  clampDelta,
  clampMoveOffset,
  clampToCanvas,
  clientToViewBox,
  configsEqual,
  deleteItems,
  horizontalScrollSign,
  duplicateItems,
  hitTest,
  hitsItem,
  isProjectId,
  itemBounds,
  itemSignature,
  itemsEqual,
  linePointAt,
  linePreview,
  lineRun,
  marqueeSelection,
  moveItems,
  moveItemsWithSelection,
  moveOffset,
  nextZoom,
  panScrollOffset,
  pruneSelection,
  recolourItems,
  rectFromPoints,
  rectsIntersect,
  reshapeItems,
  roundingCornersApplies,
  selectionFillColor,
  shiftSelection,
  strokeStyleApplies,
  styleForSelection,
  tileTargetApplies,
  toggleBorderSide,
  wheelSteps,
  wheelZoomDelta,
  zoomPercent,
  zoomScrollOffset,
  ZOOM_STOPS,
} from "./interaction";
import type {
  DrawStyle,
  ScrollLike,
  ToolContext,
  WheelGesture,
} from "./interaction";

const square: ProjectConfig = { ...DEFAULT_PROJECT_CONFIG, base: 10 };
const circular: ProjectConfig = { ...square, gridType: "circular" };
/** The equal `1:1` cell: half ink beside half space, the lightest preset. */
const equal: ProjectConfig = { ...square, ratio: RATIO_PRESETS[0].ratio };
/** A ring with 12 sectors of 30° instead of the default 36 of 10°. */
const circular12: ProjectConfig = { ...circular, circularSectors: 12 };

type TileExtra = Partial<Pick<TileItem, "shape" | "rotation" | "color">>;

function tile(
  column: number,
  row: number,
  zone: Zone = 0,
  extra: TileExtra = {},
): TileItem {
  return makeTile({ column, row, zone, ...extra });
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    config: square,
    items: [],
    selection: [],
    tool: "pen",
    style: DEFAULT_STYLE,
    arc: DEFAULT_ARC_STYLE,
    ...overrides,
  };
}

describe("clientToViewBox", () => {
  it("maps the corners of a square element exactly", () => {
    const rect = { left: 100, top: 50, width: 500, height: 500 };
    expect(clientToViewBox(rect, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(clientToViewBox(rect, 350, 300)).toEqual({ x: 500, y: 500 });
    expect(clientToViewBox(rect, 600, 550)).toEqual({ x: 1000, y: 1000 });
  });

  it("compensates for letterboxing (preserveAspectRatio meet)", () => {
    const wide = { left: 0, top: 0, width: 1000, height: 500 };
    expect(clientToViewBox(wide, 250, 0)).toEqual({ x: 0, y: 0 });
    expect(clientToViewBox(wide, 750, 500)).toEqual({ x: 1000, y: 1000 });
    expect(clientToViewBox(wide, 500, 250)).toEqual({ x: 500, y: 500 });

    const tall = { left: 0, top: 0, width: 200, height: 800 };
    expect(clientToViewBox(tall, 0, 300)).toEqual({ x: 0, y: 0 });
    expect(clientToViewBox(tall, 200, 500)).toEqual({ x: 1000, y: 1000 });
  });

  it("is unaffected by CSS scaling and RTL (x never mirrors)", () => {
    const zoomed = { left: -40, top: -40, width: 2000, height: 2000 };
    expect(clientToViewBox(zoomed, 960, 960)).toEqual({ x: 500, y: 500 });
    const small = { left: 0, top: 0, width: 100, height: 100 };
    expect(clientToViewBox(small, 25, 25)).toEqual({ x: 250, y: 250 });
    // Moving the pointer away from the RTL start edge still increases x.
    expect(clientToViewBox(small, 75, 25)).toEqual({ x: 750, y: 250 });
  });

  it("returns the origin for a degenerate rect", () => {
    expect(clientToViewBox({ left: 0, top: 0, width: 0, height: 0 }, 5, 5)).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("clampToCanvas + grid limits", () => {
  it("keeps points inside the viewBox", () => {
    expect(clampToCanvas({ x: -10, y: 1200 })).toEqual({ x: 0, y: 1000 - 1e-6 });
  });

  it("counts the cells of both grid types", () => {
    // 1000 / 10 = 100 cells, so indices run 0…99.
    expect(cellLimits(square)).toEqual({ maxColumn: 99, maxRow: 99 });
    // Circular: radius 500 → bands 0…49, and one row per sector of the board.
    expect(cellLimits(circular)).toEqual({ maxColumn: 49, maxRow: 35 });
    expect(cellLimits(circular12)).toEqual({ maxColumn: 49, maxRow: 11 });
  });
});

describe("anchoring", () => {
  it("picks the zone quadrant of the cell under the pointer", () => {
    expect(anchorAt(square, { x: 2, y: 2 })).toEqual({ column: 0, row: 0, zone: 0 });
    expect(anchorAt(square, { x: 8, y: 2 })).toEqual({ column: 0, row: 0, zone: 1 });
    expect(anchorAt(square, { x: 2, y: 8 })).toEqual({ column: 0, row: 0, zone: 2 });
    expect(anchorAt(square, { x: 8, y: 8 })).toEqual({ column: 0, row: 0, zone: 3 });
    expect(anchorAt(square, { x: 25, y: 5 })).toEqual({ column: 2, row: 0, zone: 0 });
  });

  it("clips the pointer to the canvas first", () => {
    // The board ends with the last cell's ink, so a pointer clipped to the
    // canvas lands in that ink (zone 0) instead of a trailing space strip.
    expect(anchorAt(square, { x: 1200, y: -5 })).toEqual({
      column: 99,
      row: 0,
      zone: 0,
    });
  });

  it("puts a line point on the fragment that was clicked", () => {
    const base = cellSize(square);
    const ink = inkUnit(square);
    const space = base - ink;
    // Ink quadrant of cell (0, 0): the ink square, as every pre-fragment point.
    expect(linePointAt(square, { x: ink / 2, y: ink / 2 })).toEqual(
      linePoint(0, 0, undefined, { x: 0.5, y: 0.5 }),
    );
    // Space corner: the point stays on *that* space square — it must not snap
    // across into the ink fragment; its fractions are the space square's own.
    expect(
      linePointAt(square, {
        x: ink + space / 2,
        y: ink + space / 2,
      }),
    ).toEqual(linePoint(0, 0, 3, { x: 0.5, y: 0.5 }));
    // A space strip along one axis only.
    expect(
      linePointAt(square, {
        x: 2 * base + ink + space / 2,
        y: ink / 2,
      }),
    ).toEqual(linePoint(2, 0, 1, { x: 0.5, y: 0.5 }));
  });
});

describe("hit testing", () => {
  it("respects the zone rectangles of a tile", () => {
    const items = [tile(0, 0, 0), tile(1, 0, 3)];
    expect(hitTest(square, items, { x: 2, y: 2 })?.key).toBe(tileKey(0, 0, 0));
    // Inside cell (0, 0) but in the space zone → no item there.
    expect(hitTest(square, items, { x: 8, y: 8 })).toBeNull();
    // Cell (1, 0) space-space fragment.
    expect(hitTest(square, items, { x: 18, y: 8 })?.key).toBe(tileKey(1, 0, 3));
  });

  it("answers for a single item as well as the whole board", () => {
    const only = tile(1, 0, 3);
    expect(hitsItem(square, only, { x: 18, y: 8 })).toBe(true);
    expect(hitsItem(square, only, { x: 2, y: 2 })).toBe(false);
  });

  it("returns the topmost item", () => {
    const items = [tile(0, 0, 0), tile(0, 0, 0, { color: "#ff0000" })];
    expect(hitTest(square, items, { x: 3, y: 3 })?.color).toBe("#ff0000");
  });

  it("hits lines and arcs near their ink", () => {
    const line = makeLine({ column: 0, row: 0 }, { column: 4, row: 0 });
    expect(hitTest(square, [line], { x: 25, y: 5 })?.key).toBe(line.key);
    expect(hitTest(square, [line], { x: 25, y: 40 })).toBeNull();

    const arc = makeArc({
      from: { column: 0, row: 0 },
      to: { column: 4, row: 0 },
      direction: "clockwise",
      size: "half",
    });
    // The arc springs off the ink edge, so its start point lies on the curve.
    expect(hitTest(square, [arc], { x: 3.75, y: 7.5 })?.key).toBe(arc.key);
    expect(hitTest(square, [arc], { x: 25, y: 95 })).toBeNull();
  });

  it("hits a stroke near its line", () => {
    const stroke = makeStroke(
      [
        { column: 0, row: 0 },
        { column: 3, row: 3 },
      ],
      false,
    );
    // The cell centres are at 3.75…33.75; (10, 10) sits on the diagonal.
    expect(hitTest(square, [stroke], { x: 10, y: 10 })?.key).toBe(stroke.key);
    expect(hitTest(square, [stroke], { x: 10, y: 40 })).toBeNull();
  });

  it("ignores the items the grid hides", () => {
    // A line and an arc are square-grid items; a circular board hides them
    // (`docs/CANVAS.md` §3), so the pointer must not find them even where
    // their square geometry lies.
    const line = makeLine({ column: 0, row: 1 }, { column: 4, row: 1 });
    const arc = makeArc({
      from: { column: 0, row: 0 },
      to: { column: 4, row: 0 },
      direction: "clockwise",
      size: "half",
    });
    const board = [line, arc, tile(30, 0)];

    for (const point of [{ x: 5, y: 12 }, { x: 3.75, y: 7.5 }]) {
      expect(hitTest(square, board, point)).not.toBeNull();
      expect(hitTest(circular, board, point)).toBeNull();
    }
    // The visible item is still found on the circular board (band 30 is
    // radius 300…310 around the centre, sector 0 is 0°…10°).
    expect(hitTest(circular, board, { x: 802.5, y: 502.5 })?.key).toBe(
      tileKey(30, 0, 0),
    );
  });

  it("hits circular slices by radius and angle", () => {
    const items = [tile(10, 0, 0)];
    // Band 10 covers radius 100…110; sector 0 is 0°…10°.
    expect(hitTest(circular, items, { x: 500 + 103, y: 500 + 5 })?.key).toBe(
      tileKey(10, 0, 0),
    );
    expect(hitTest(circular, items, { x: 500 + 103, y: 500 - 5 })).toBeNull();
    expect(hitTest(circular, items, { x: 500 + 60, y: 500 })).toBeNull();
  });

  it("computes item bounds that contain the item", () => {
    const item = tile(2, 3, 0);
    const bounds = itemBounds(square, item);
    expect(bounds).toEqual({
      x: 2 * cellSize(square),
      y: 3 * cellSize(square),
      w: inkUnit(square),
      h: inkUnit(square),
    });
  });
});

describe("marquee selection", () => {
  it("builds a normalised rectangle from two points", () => {
    expect(rectFromPoints({ x: 80, y: 60 }, { x: -20, y: -40 })).toEqual({
      x: -20,
      y: -40,
      w: 100,
      h: 100,
    });
  });

  it("reports whether two rectangles meet", () => {
    expect(
      rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }),
    ).toBe(true);
    expect(
      rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 }),
    ).toBe(false);
  });

  it("selects every touched item", () => {
    const items = [tile(0, 0), tile(5, 5), tile(30, 30)];
    const keys = marqueeSelection(
      square,
      items,
      rectFromPoints({ x: -5, y: -5 }, { x: 80, y: 80 }),
    );
    expect(keys).toEqual([tileKey(0, 0, 0), tileKey(5, 5, 0)]);
  });

  it("selects a space fragment by its own square", () => {
    const space = tile(2, 0, 3);
    const ink = tile(0, 0, 0);
    const side = tile(2, 0, 1);
    // A box strictly inside the space square: it meets neither the ink square
    // of another cell nor the same cell's x-space strip (a shared edge counts
    // as touched, and those strips share one).
    const bounds = itemBounds(square, space);
    expect(
      marqueeSelection(square, [ink, space, side], {
        x: bounds.x + 1,
        y: bounds.y + 1,
        w: bounds.w - 2,
        h: bounds.h - 2,
      }),
    ).toEqual([space.key]);
  });

  it("leaves the items the grid hides out of the selection", () => {
    const line = makeLine({ column: 0, row: 1 }, { column: 4, row: 1 });
    const board = [line, tile(0, 0), tile(1, 0)];
    const box = { x: 0, y: 0, w: 1000, h: 1000 };
    expect(marqueeSelection(square, board, box)).toEqual([
      line.key,
      tileKey(0, 0, 0),
      tileKey(1, 0, 0),
    ]);
    expect(marqueeSelection(circular, board, box)).toEqual([
      tileKey(0, 0, 0),
      tileKey(1, 0, 0),
    ]);
  });
});

describe("pruneSelection", () => {
  it("keeps live keys in order and drops the ones that are gone", () => {
    const items = [tile(0, 0), tile(1, 0)];
    expect(
      pruneSelection(square, items, [items[1].key, "ghost", items[0].key]),
    ).toEqual([items[1].key, items[0].key]);
    expect(pruneSelection(square, items, [])).toEqual([]);
  });

  it("drops the line and arc keys a circular board hides", () => {
    const line = makeLine({ column: 0, row: 1 }, { column: 4, row: 1 });
    const items = [line, tile(0, 0)];
    const keys = [line.key, tileKey(0, 0, 0)];
    expect(pruneSelection(square, items, keys)).toEqual(keys);
    // The grid switched under the selection: the line is no longer in it.
    expect(pruneSelection(circular, items, keys)).toEqual([tileKey(0, 0, 0)]);
  });
});

describe("selection operations", () => {
  const items: CanvasItem[] = [
    tile(0, 0, 0, { shape: "circle", rotation: 1, color: "#ff0000" }),
    tile(1, 0, 0),
    tile(9, 9, 0),
  ];

  it("moves items with their shape, rotation, colour and relative offset", () => {
    const moved = moveItems(
      square,
      items,
      [tileKey(0, 0, 0), tileKey(1, 0, 0)],
      2,
      3,
    );
    const circle = moved.find((item) => item.key === tileKey(2, 3, 0));
    expect(circle).toMatchObject({
      column: 2,
      row: 3,
      shape: "circle",
      rotation: 1,
      color: "#ff0000",
    });
    expect(moved.some((item) => item.key === tileKey(3, 3, 0))).toBe(true);
    // Untouched items keep their identity.
    expect(moved.some((item) => item === items[2])).toBe(true);
  });

  it("moves a space fragment without changing its zone", () => {
    const space = tile(3, 4, 2);
    expect(moveItems(square, [space], [space.key], 1, 1)).toEqual([
      tile(4, 5, 2),
    ]);
  });

  it("moves the listed items in their original order", () => {
    const shifted = shiftSelection(
      square,
      items,
      [tileKey(9, 9, 0), tileKey(0, 0, 0)],
      1,
      0,
    );
    expect(shifted.map((item) => item.key)).toEqual([
      tileKey(1, 0, 0),
      tileKey(10, 9, 0),
    ]);
  });

  it("remaps every moved key, keeping the selection's order", () => {
    const moved = moveItemsWithSelection(
      square,
      items,
      [tileKey(9, 9, 0), tileKey(0, 0, 0), tileKey(1, 0, 0)],
      2,
      3,
    );
    // Keys embed the cell, so every moved item has a new identity. The
    // returned keys follow the selection order, not the board order.
    expect(moved.keys).toEqual([
      tileKey(11, 12, 0),
      tileKey(2, 3, 0),
      tileKey(3, 3, 0),
    ]);
    const onBoard = new Set(moved.items.map((item) => item.key));
    for (const key of moved.keys) expect(onBoard.has(key)).toBe(true);
    expect(moved.items).toEqual(
      moveItems(
        square,
        items,
        [tileKey(9, 9, 0), tileKey(0, 0, 0), tileKey(1, 0, 0)],
        2,
        3,
      ),
    );
  });

  it("keeps the selection's keys when clamping turns a move into a no-op", () => {
    const corner = [tile(99, 99, 0)];
    // A stray key is kept too: `pruneSelection` owns dropping keys that have
    // no item, so the move helper never silently rewrites the selection.
    const keys = [tileKey(99, 99, 0), "ghost"];
    const moved = moveItemsWithSelection(square, corner, keys, 5, 5);
    expect(moved.keys).toEqual(keys);
    expect(moved.items).toEqual(corner);
  });

  it("remaps a wrapped key on the circular grid", () => {
    const ring = [tile(2, 35, 0)];
    const moved = moveItemsWithSelection(
      circular,
      ring,
      [tileKey(2, 35, 0)],
      1,
      2,
    );
    expect(moved.keys).toEqual([tileKey(3, 1, 0)]);
    expect(moved.items.map((item) => item.key)).toEqual([tileKey(3, 1, 0)]);
  });

  it("clamps a move to the grid", () => {
    const corner = [tile(99, 99, 0)];
    expect(clampDelta(square, corner, [tileKey(99, 99, 0)], 5, 5)).toEqual({
      dColumn: 0,
      dRow: 0,
    });
    expect(clampDelta(square, corner, [tileKey(99, 99, 0)], -5, -5)).toEqual({
      dColumn: -5,
      dRow: -5,
    });
    const moved = moveItems(square, items, [tileKey(9, 9, 0)], 4, 4);
    expect(moved.some((item) => item.key === tileKey(13, 13, 0))).toBe(true);
  });

  it("wraps sectors when moving on the circular grid", () => {
    const items2 = [tile(2, 35, 0)];
    const moved = moveItems(circular, items2, [tileKey(2, 35, 0)], 1, 2);
    expect(moved[0].key).toBe(tileKey(3, 1, 0));
    // On a 12-sector ring the same relative move leaves 11 and lands on 1.
    const shorter = [tile(2, 11, 0)];
    const wrapped = moveItems(circular12, shorter, [tileKey(2, 11, 0)], 1, 2);
    expect(wrapped[0].key).toBe(tileKey(3, 1, 0));
  });

  it("recolours to a concrete colour and never clears it back to undefined", () => {
    const coloured = recolourItems(square, items, [tileKey(1, 0, 0)], "#00ff00");
    expect(coloured.find((item) => item.key === tileKey(1, 0, 0))).toMatchObject({
      color: "#00ff00",
    });
    // `undefined` resolves to the document ink — it does not clear the colour.
    const inked = recolourItems(square, coloured, [tileKey(1, 0, 0)], undefined);
    expect(inked.find((item) => item.key === tileKey(1, 0, 0))).toHaveProperty(
      "color",
      square.ink,
    );
  });

  it("keeps unlisted and already-resolved items by identity", () => {
    const coloured = recolourItems(square, items, [tileKey(1, 0, 0)], "#00ff00");
    expect(coloured[0]).toBe(items[0]);
    expect(coloured[2]).toBe(items[2]);
    const again = recolourItems(square, coloured, [tileKey(1, 0, 0)], "#00ff00");
    expect(again[1]).toBe(coloured[1]);
  });

  it("does not repaint items already on the board when config.ink changes", () => {
    const onBoard = recolourItems(square, items, [tileKey(1, 0, 0)], "#00ff00");
    const nextInk: ProjectConfig = { ...square, ink: "#222222" };
    // An empty key list leaves the stored fragments exactly as they are.
    const untouched = recolourItems(nextInk, onBoard, [], undefined);
    expect(untouched[1]).toBe(onBoard[1]);
    expect(untouched[1]).toMatchObject({ color: "#00ff00" });
    expect(untouched[0]).toMatchObject({ color: "#ff0000" });
  });

  it("reshapes tiles only", () => {
    const reshaped = reshapeItems(
      [tile(0, 0, 0), makeLine({ column: 0, row: 0 }, { column: 2, row: 0 })],
      [tileKey(0, 0, 0), lineKey({ column: 0, row: 0 }, { column: 2, row: 0 })],
      { shape: "circle", rotation: 2 },
    );
    expect(reshaped[0]).toMatchObject({ shape: "circle", rotation: 2 });
    expect(reshaped[1]).not.toHaveProperty("shape");
    const reset = reshapeItems(reshaped, [tileKey(0, 0, 0)], {
      shape: "square",
      rotation: 0,
    });
    expect("shape" in reset[0]).toBe(false);
    expect("rotation" in reset[0]).toBe(false);
  });

  it("duplicates with an offset and skips taken keys", () => {
    const { items: copy, keys } = duplicateItems(square, items, [
      tileKey(0, 0, 0),
      tileKey(1, 0, 0),
    ]);
    expect(keys).toEqual([tileKey(1, 1, 0), tileKey(2, 1, 0)]);
    expect(copy).toHaveLength(items.length + 2);
  });

  it("never overwrites an existing key when duplicating", () => {
    const board = [tile(0, 0, 0), tile(1, 1, 0)];
    const { items: copy, keys } = duplicateItems(square, board, [tileKey(0, 0, 0)]);
    expect(keys).toEqual([]);
    expect(copy).toEqual(board);
  });

  it("deletes by key", () => {
    const left = deleteItems(items, [tileKey(0, 0, 0)]);
    expect(left.map((item) => item.key)).toEqual([
      tileKey(1, 0, 0),
      tileKey(9, 9, 0),
    ]);
  });
});

describe("1:1 zone-aware moves", () => {
  it("turns a same-cell zone change into a move", () => {
    const from: Anchor = { column: 2, row: 2, zone: 0 };
    const to: Anchor = { column: 2, row: 2, zone: 1 };
    // At 1:1 the two fragments are congruent, so the zone difference is the
    // half-cell translation the item must make.
    expect(moveOffset(equal, from, to)).toEqual({
      dColumn: 0,
      dRow: 0,
      zone: 1,
    });

    const item = tile(2, 2, 0);
    const moved = moveItemsWithSelection(equal, [item], [item.key], 0, 0, 1);
    expect(moved.items).toEqual([tile(2, 2, 1)]);
    expect(moved.keys).toEqual([tileKey(2, 2, 1)]);
  });

  it("toggles every fragment an item carries, anchors included", () => {
    const ink = tile(0, 0, 0);
    const line = makeLine(
      { column: 0, row: 1, zone: 0 },
      { column: 3, row: 1, zone: 0 },
    );
    const arc = makeArc({
      from: { column: 0, row: 2, zone: 0 },
      to: { column: 3, row: 2, zone: 0 },
      direction: "clockwise",
      size: "half",
    });
    const stroke = makeStroke(
      [
        linePoint(0, 3, 0, { x: 0, y: 1 }),
        linePoint(1, 3, 3),
      ],
      false,
    );
    const board = [ink, line, arc, stroke];
    const moved = shiftSelection(
      equal,
      board,
      board.map((item) => item.key),
      0,
      0,
      1,
    );

    expect(moved[0]).toMatchObject({ zone: 1 });
    expect(moved[1]).toMatchObject({
      from: { zone: 1 },
      to: { zone: 1 },
    });
    expect(moved[2]).toMatchObject({
      from: { zone: 1 },
      to: { zone: 1 },
    });
    // A stroke point keeps its anchor relative to the translated fragment.
    expect((moved[3] as StrokeItem).points).toMatchObject([
      { column: 0, row: 3, zone: 1, anchor: { x: 0, y: 1 } },
      { column: 1, row: 3, zone: 2 },
    ]);
  });

  it("combines the cell delta with the zone toggle across cells", () => {
    const from: Anchor = { column: 2, row: 2, zone: 0 };
    const to: Anchor = { column: 4, row: 3, zone: 2 };
    expect(moveOffset(equal, from, to)).toEqual({
      dColumn: 2,
      dRow: 1,
      zone: 2,
    });

    const item = tile(2, 2, 0);
    const moved = moveItemsWithSelection(equal, [item], [item.key], 2, 1, 2);
    expect(moved.items).toEqual([tile(4, 3, 2)]);
    expect(moved.keys).toEqual([tileKey(4, 3, 2)]);
  });

  it("applies one toggle to a multi-selection and remaps every key", () => {
    const first = tile(2, 2, 0);
    const second = tile(3, 2, 1);
    const board = [first, second];
    // The selection order is the user's, the board order is unchanged.
    const moved = moveItemsWithSelection(
      equal,
      board,
      [second.key, first.key],
      1,
      1,
      1,
    );
    expect(moved.items).toEqual([tile(3, 3, 1), tile(4, 3, 0)]);
    expect(moved.keys).toEqual([tileKey(4, 3, 0), tileKey(3, 3, 1)]);
  });

  it("keeps zones on denser grids", () => {
    const from: Anchor = { column: 2, row: 2, zone: 0 };
    // A zone change in the same cell is not a translation at 1:2 and denser.
    expect(moveOffset(square, from, { column: 2, row: 2, zone: 1 })).toEqual({
      dColumn: 0,
      dRow: 0,
      zone: 0,
    });
    expect(moveOffset(square, from, { column: 4, row: 3, zone: 2 })).toEqual({
      dColumn: 2,
      dRow: 1,
      zone: 0,
    });

    const item = tile(2, 2, 0);
    const moved = moveItemsWithSelection(square, [item], [item.key], 2, 1);
    expect(moved.items).toEqual([tile(4, 3, 0)]);
    expect(moved.keys).toEqual([tileKey(4, 3, 0)]);
  });

  it("clamps the cells at the edge but keeps the zone toggle", () => {
    const board = [tile(99, 99, 0)];
    const keys = [board[0].key];
    const offset = clampMoveOffset(equal, board, keys, {
      dColumn: 5,
      dRow: 5,
      zone: 3,
    });
    // The item cannot leave the board, but a fragment toggle lives inside its
    // existing cell and is still a legal translation.
    expect(offset).toEqual({ dColumn: 0, dRow: 0, zone: 3 });

    const moved = moveItemsWithSelection(
      equal,
      board,
      keys,
      offset.dColumn,
      offset.dRow,
      offset.zone,
    );
    expect(moved.items).toEqual([tile(99, 99, 3)]);
    expect(moved.keys).toEqual([tileKey(99, 99, 3)]);
  });
});

describe("arcBetween + linePreview", () => {
  it("takes direction / size from the arc style and the colour from the ink", () => {
    const ctx = context({
      arc: { direction: "counterclockwise", size: "threeQuarter" },
    });
    const arc = arcBetween(ctx, { column: 0, row: 0 }, { column: 4, row: 0 });
    expect(arc).toMatchObject({
      type: "arc",
      from: { column: 0, row: 0 },
      to: { column: 4, row: 0 },
      direction: "counterclockwise",
      size: "threeQuarter",
      color: square.ink,
    });
    expect(arc?.key).toBe(
      arcKey(
        { column: 0, row: 0 },
        { column: 4, row: 0 },
        "counterclockwise",
        "threeQuarter",
      ),
    );
  });

  it("carries both endpoints' anchors into the stored arc", () => {
    const ctx = context();
    const arc = arcBetween(
      ctx,
      { column: 0, row: 0, anchor: { x: 0, y: 0 } },
      { column: 4, row: 0, anchor: { x: 0.5, y: 0.5 } },
    );
    expect(arc).toMatchObject({
      from: { column: 0, row: 0, anchor: { x: 0, y: 0 } },
      to: { column: 4, row: 0, anchor: { x: 0.5, y: 0.5 } },
    });
    // The centre is stored here: absence would mean the legacy spring point.
    expect(arc?.key).toBe(
      arcKey(
        { column: 0, row: 0, anchor: { x: 0, y: 0 } },
        { column: 4, row: 0, anchor: { x: 0.5, y: 0.5 } },
        "clockwise",
        "half",
      ),
    );
  });

  it("paints with the project ink colour", () => {
    const ctx = context({ config: { ...square, ink: "#ff0000" } });
    const arc = arcBetween(ctx, { column: 0, row: 0 }, { column: 0, row: 4 });
    expect(arc).toMatchObject({ color: "#ff0000" });
  });

  it("returns null for a same cell or an unsupported pair", () => {
    const ctx = context();
    expect(
      arcBetween(ctx, { column: 1, row: 1 }, { column: 1, row: 1 }),
    ).toBeNull();
    // Two across, one down: neither one axis nor a 45° diagonal.
    expect(
      arcBetween(ctx, { column: 0, row: 0 }, { column: 2, row: 1 }),
    ).toBeNull();
  });

  it("is empty below two points", () => {
    expect(linePreview(square, [], null)).toEqual([]);
    expect(linePreview(square, [{ column: 1, row: 1 }], null)).toEqual([]);
    // A pending hover on its own is not a run either.
    expect(linePreview(square, [], { column: 1, row: 1 })).toEqual([]);
  });

  it("adds the hovered cell as the pending segment", () => {
    const preview = linePreview(square, [{ column: 1, row: 1 }], {
      column: 3,
      row: 1,
    });
    expect(preview.map((item) => item.key)).toEqual([
      tileKey(1, 1, 0),
      tileKey(2, 1, 0),
      tileKey(3, 1, 0),
    ]);
    expect(preview.every((item) => item.color === square.ink)).toBe(true);
  });

  it("draws a diagonal polyline, closed when the hover returns to the start", () => {
    const points = [
      { column: 0, row: 0 },
      { column: 3, row: 3 },
    ];
    const open = linePreview(square, points, null);
    expect(open[0]).toMatchObject({ type: "stroke", color: square.ink });
    expect((open[0] as StrokeItem).closed).toBeFalsy();
    // Hovering the first point is the closing click of the sequence.
    const closed = linePreview(square, points, { column: 0, row: 0 });
    expect((closed[0] as StrokeItem).closed).toBe(true);
  });

  it("resolves a hover exactly as the click on it would", () => {
    const points = [
      { column: 1, row: 1 },
      { column: 3, row: 1 },
      { column: 3, row: 3 },
    ];
    // Extending: the hover becomes the next point, the run stays open.
    expect(lineRun(points, { column: 1, row: 3 })).toEqual({
      points: [...points, { column: 1, row: 3 }],
      closed: false,
      finished: false,
    });
    // Clicking the last point ends the run where it stands, open.
    expect(lineRun(points, points[2])).toEqual({
      points: [...points],
      closed: false,
      finished: true,
    });
    // Clicking the first point closes it.
    expect(lineRun(points, points[0])).toEqual({
      points: [...points],
      closed: true,
      finished: true,
    });
    // Two points on the same cell but different anchors are not the same
    // point, so the run extends instead of finishing.
    const anchored = [{ column: 2, row: 2, anchor: { x: 0, y: 0 } }];
    expect(lineRun(anchored, { column: 2, row: 2, anchor: { x: 1, y: 1 } })).toEqual(
      {
        points: [...anchored, { column: 2, row: 2, anchor: { x: 1, y: 1 } }],
        closed: false,
        finished: false,
      },
    );
  });

  it("previews exactly the run the click commits, endpoint included", () => {
    // A closing gesture: the last point is the first cell again, one anchor
    // across. The ghost must equal the committed items — same closing
    // segment, same endpoints (the bug this pins: the preview used to draw an
    // open run and nudge both ends to the ink edges).
    const points = [
      { column: 1, row: 1, anchor: { x: 0, y: 0 } },
      { column: 3, row: 1, anchor: { x: 0, y: 0 } },
      { column: 3, row: 3, anchor: { x: 0, y: 0 } },
      { column: 1, row: 3, anchor: { x: 0, y: 0 } },
    ];
    const hover = { column: 1, row: 1, anchor: { x: 0, y: 0 } };
    const run = lineRun(points, hover);
    expect(linePreview(square, points, hover)).toEqual(
      lineItems(square, run.points, run.closed),
    );
  });

  it("previews with the draw style's rounding, border, cap and join", () => {
    const rounding = { radius: 0.2, corners: CORNER_ALL };
    const border = { width: 2, color: "#000000" };
    // Rounding turns the straight run into one roundable bar in the preview,
    // exactly as the commit does.
    const preview = linePreview(
      square,
      [
        { column: 0, row: 0 },
        { column: 2, row: 0 },
      ],
      null,
      { rounding, border, cap: "round", join: "bevel" },
    );
    expect(preview).toHaveLength(1);
    expect(preview[0]).toMatchObject({
      type: "line",
      rounding,
      border,
      cap: "round",
      join: "bevel",
    });
  });
});

describe("strokeStyleApplies", () => {
  const line = makeLine({ column: 0, row: 1 }, { column: 4, row: 1 });
  const stroke = makeStroke(
    [
      { column: 0, row: 0 },
      { column: 2, row: 2 },
    ],
    false,
  );
  const arc = makeArc({
    from: { column: 0, row: 0 },
    to: { column: 2, row: 0 },
    direction: "clockwise",
    size: "half",
  });
  const plain = tile(0, 0);

  it("shows for the line and arc tools with nothing selected", () => {
    expect(strokeStyleApplies("line", [], [])).toBe(true);
    expect(strokeStyleApplies("arc", [], [])).toBe(true);
  });

  it("hides for the pen, select, eraser and hand with nothing selected", () => {
    for (const tool of ["pen", "select", "eraser", "hand"] as const) {
      expect(strokeStyleApplies(tool, [], [])).toBe(false);
    }
  });

  it("shows when the selection contains a line, stroke or arc", () => {
    for (const item of [line, stroke, arc]) {
      expect(strokeStyleApplies("select", [item], [item.key])).toBe(true);
    }
  });

  it("hides for a tiles-only selection even under the line tool", () => {
    expect(strokeStyleApplies("line", [plain], [plain.key])).toBe(false);
  });

  it("shows for a mixed selection when any selected item is stroked", () => {
    expect(
      strokeStyleApplies("select", [plain, stroke], [plain.key, stroke.key]),
    ).toBe(true);
  });

  it("hides a stale selection even under the line tool", () => {
    expect(strokeStyleApplies("line", [line], ["missing-item"])).toBe(false);
  });
});

describe("tileTargetApplies / roundingCornersApplies", () => {
  // One predicate sits behind the corner map, the side map and the shape
  // palette; the rounding wrapper is a thin alias of it.
  const predicates = [tileTargetApplies, roundingCornersApplies] as const;
  const line = makeLine({ column: 0, row: 1 }, { column: 4, row: 1 });
  const stroke = makeStroke(
    [
      { column: 0, row: 0 },
      { column: 2, row: 2 },
    ],
    false,
  );
  const arc = makeArc({
    from: { column: 0, row: 0 },
    to: { column: 2, row: 0 },
    direction: "clockwise",
    size: "half",
  });
  const plain = tile(0, 0);

  it("shows for the tile tools with nothing selected", () => {
    for (const applies of predicates) {
      for (const tool of ["pen", "select", "eraser", "hand"] as const) {
        expect(applies(tool, [], [])).toBe(true);
      }
    }
  });

  it("hides for the line and arc tools with nothing selected", () => {
    for (const applies of predicates) {
      expect(applies("line", [], [])).toBe(false);
      expect(applies("arc", [], [])).toBe(false);
    }
  });

  it("shows when the selection contains a tile", () => {
    for (const applies of predicates) {
      expect(applies("select", [plain], [plain.key])).toBe(true);
    }
  });

  it("hides for a lines-only selection even under the pen", () => {
    for (const applies of predicates) {
      for (const item of [line, stroke, arc]) {
        expect(applies("pen", [item], [item.key])).toBe(false);
      }
    }
  });

  it("shows for a mixed selection when any selected item is a tile", () => {
    for (const applies of predicates) {
      expect(applies("line", [plain, line], [plain.key, line.key])).toBe(true);
    }
  });

  it("hides a stale selection even under the pen", () => {
    for (const applies of predicates) {
      expect(applies("pen", [plain], ["missing-item"])).toBe(false);
    }
  });
});

describe("toggleBorderSide", () => {
  it("starts from all four sides when the mask is absent", () => {
    expect(toggleBorderSide(undefined, BORDER_TOP)).toBe(
      BORDER_ALL & ~BORDER_TOP,
    );
    expect(toggleBorderSide(undefined, BORDER_BOTTOM)).toBe(
      BORDER_ALL & ~BORDER_BOTTOM,
    );
  });

  it("flips exactly the clicked side and leaves the rest", () => {
    expect(toggleBorderSide(BORDER_TOP, BORDER_LEFT)).toBe(
      BORDER_TOP | BORDER_LEFT,
    );
    expect(toggleBorderSide(BORDER_TOP | BORDER_LEFT, BORDER_TOP)).toBe(
      BORDER_LEFT,
    );
  });

  it("can turn every side off, the empty mask the model drops", () => {
    expect(toggleBorderSide(BORDER_TOP, BORDER_TOP)).toBe(0);
  });

  it("clamps a stored mask before flipping it", () => {
    expect(toggleBorderSide(BORDER_TOP | 16, BORDER_TOP)).toBe(0);
  });
});

describe("selectionFillColor", () => {
  it("falls back to the project ink with nothing selected", () => {
    const red = tile(0, 0, 0, { color: "#ff0000" });
    expect(selectionFillColor([red], [], "#123456")).toBe("#123456");
  });

  it("shows the first selected item's own colour, not its list order", () => {
    const blue = tile(0, 0, 0, { color: "#0000ff" });
    const red = tile(0, 1, 0, { color: "#ff0000" });
    expect(
      selectionFillColor([blue, red], [red.key, blue.key], "#123456"),
    ).toBe("#ff0000");
  });

  it("uses the project ink for a selected item without its own colour", () => {
    const plain = tile(1, 0);
    const red = tile(0, 0, 0, { color: "#ff0000" });
    expect(
      selectionFillColor([red, plain], [plain.key, red.key], "#123456"),
    ).toBe("#123456");
  });

  it("falls back when the first selected key no longer exists", () => {
    const red = tile(0, 0, 0, { color: "#ff0000" });
    expect(
      selectionFillColor([red], ["missing-item", red.key], "#123456"),
    ).toBe("#123456");
  });
});

describe("styleForSelection", () => {
  it("shows the draw style when nothing is selected", () => {
    expect(styleForSelection(DEFAULT_STYLE, undefined)).toBe(DEFAULT_STYLE);
    // A fresh draw style has no border, and the one it will create is black.
    expect(DEFAULT_STYLE.border).toEqual(DEFAULT_BORDER);
  });

  it("shows the selected item's own rounding, border, cap and join", () => {
    const rounding = { radius: 0.2, corners: CORNER_ALL };
    const border = { width: 3, color: "#ff0000" };
    const item: CanvasItem = {
      ...makeStroke(
        [
          { column: 0, row: 0 },
          { column: 2, row: 2 },
        ],
        false,
      ),
      rounding,
      border,
      cap: "round",
      join: "bevel",
    };
    expect(styleForSelection(DEFAULT_STYLE, item)).toMatchObject({
      rounding,
      border,
      cap: "round",
      join: "bevel",
    });
    // The draw style itself is never mutated by the panel's view.
    expect(DEFAULT_STYLE.rounding).toEqual({ radius: 0, corners: CORNER_ALL });
    expect(DEFAULT_STYLE.cap).toBe("butt");
    expect(DEFAULT_STYLE.join).toBe("miter");
  });

  it("shows a tile's border side subset so the map reflects the board", () => {
    const masked: CanvasItem = {
      ...tile(0, 0),
      border: { width: 2, color: "#000000", sides: BORDER_TOP | BORDER_LEFT },
    };
    expect(styleForSelection(DEFAULT_STYLE, masked).border).toEqual({
      width: 2,
      color: "#000000",
      sides: BORDER_TOP | BORDER_LEFT,
    });
  });

  it("shows the off states for an item without style and no rounding on an arc", () => {
    expect(styleForSelection(DEFAULT_STYLE, tile(0, 0))).toMatchObject({
      rounding: { radius: 0, corners: CORNER_ALL },
      border: DEFAULT_BORDER,
    });
    const arc = makeArc({
      from: { column: 0, row: 0 },
      to: { column: 2, row: 0 },
      direction: "clockwise",
      size: "half",
      border: { width: 2, color: "#000000" },
    });
    expect(styleForSelection(DEFAULT_STYLE, arc)).toMatchObject({
      rounding: { radius: 0, corners: CORNER_ALL },
      border: { width: 2, color: "#000000" },
      cap: "butt",
      join: "miter",
    });
  });
});

describe("applyDrawStyle", () => {
  it("persists an edit only while nothing is selected", () => {
    const patch: Partial<DrawStyle> = {
      shape: "circle",
      rotation: 2,
      rounding: { radius: 0.2, corners: CORNER_ALL },
      border: { width: 3, color: "#ff0000" },
      cap: "round",
      join: "bevel",
    };

    const persisted = applyDrawStyle(DEFAULT_STYLE, 0, patch);
    expect(persisted).not.toBe(DEFAULT_STYLE);
    expect(persisted).toMatchObject(patch);
    // The source style is a template, never mutated.
    expect(DEFAULT_STYLE.rounding.radius).toBe(0);
    expect(DEFAULT_STYLE.shape).toBe("square");

    // A selection edit is an item patch: it must not leak into the draw style
    // (or the prefs written from it) for every future shape.
    const selected = applyDrawStyle(DEFAULT_STYLE, 1, patch);
    expect(selected).toBe(DEFAULT_STYLE);
    expect(selected).toMatchObject({
      shape: "square",
      rotation: 0,
      rounding: { radius: 0, corners: CORNER_ALL },
      border: DEFAULT_BORDER,
      cap: "butt",
      join: "miter",
    });
  });
});

describe("the equal 1:1 cell", () => {
  it("reads the zone of the half the click is in", () => {
    expect(anchorAt(equal, { x: 2, y: 2 })).toEqual({
      column: 0,
      row: 0,
      zone: 0,
    });
    expect(anchorAt(equal, { x: 8, y: 2 })).toEqual({
      column: 0,
      row: 0,
      zone: 1,
    });
    expect(anchorAt(equal, { x: 2, y: 8 })).toEqual({
      column: 0,
      row: 0,
      zone: 2,
    });
    expect(anchorAt(equal, { x: 8, y: 8 })).toEqual({
      column: 0,
      row: 0,
      zone: 3,
    });
  });

  it("gives each quadrant its own line point — no snap into the ink half", () => {
    expect(linePointAt(equal, { x: 2, y: 2 })).toEqual(
      linePoint(0, 0, undefined, { x: 0.5, y: 0.5 }),
    );
    expect(linePointAt(equal, { x: 8, y: 2 })).toEqual(
      linePoint(0, 0, 1, { x: 0.5, y: 0.5 }),
    );
    expect(linePointAt(equal, { x: 2, y: 8 })).toEqual(
      linePoint(0, 0, 2, { x: 0.5, y: 0.5 }),
    );
    expect(linePointAt(equal, { x: 8, y: 8 })).toEqual(
      linePoint(0, 0, 3, { x: 0.5, y: 0.5 }),
    );
  });

  it("hits only the quadrant a tile actually covers", () => {
    const ink = [tile(0, 0, 0)];
    const space = [tile(0, 0, 3)];
    expect(hitTest(equal, ink, { x: 2, y: 2 })?.key).toBe(tileKey(0, 0, 0));
    expect(hitTest(equal, ink, { x: 8, y: 8 })).toBeNull();
    expect(hitTest(equal, space, { x: 8, y: 8 })?.key).toBe(tileKey(0, 0, 3));
    expect(hitTest(equal, space, { x: 2, y: 2 })).toBeNull();
  });
});

describe("comparison helpers", () => {
  it("projects an item to a stable, colour-aware signature", () => {
    expect(itemSignature(tile(0, 0, 0))).toBe(itemSignature(tile(0, 0, 0)));
    expect(itemSignature(tile(0, 0, 0))).not.toBe(
      itemSignature(tile(0, 0, 0, { color: "#000000" })),
    );
    // Absent optionals and their explicit spelling are the same item.
    expect(itemSignature(tile(0, 0, 0))).toBe(
      itemSignature(
        makeTile({ column: 0, row: 0, zone: 0, shape: "square", rotation: 0 }),
      ),
    );
  });

  it("compares items structurally regardless of object identity", () => {
    expect(itemsEqual([tile(0, 0, 0)], [tile(0, 0, 0)])).toBe(true);
    expect(itemsEqual([tile(0, 0, 0)], [tile(0, 0, 1)])).toBe(false);
    expect(itemsEqual([tile(0, 0, 0, { color: "#000000" })], [tile(0, 0, 0)])).toBe(
      false,
    );
    expect(itemsEqual([], [])).toBe(true);
  });

  it("compares configs field by field", () => {
    expect(configsEqual(square, { ...square })).toBe(true);
    expect(configsEqual(square, { ...square, ratio: 0.5 })).toBe(false);
    expect(configsEqual(circular, { ...circular, circularSectors: 12 })).toBe(false);
  });

  it("guards project ids from the URL", () => {
    // Convex document ids are 12…64 lowercase alphanumerics.
    expect(isProjectId("j57863dx4nchfny4jyta44x7hh8gdsnm")).toBe(true);
    expect(isProjectId("abc123456789")).toBe(true);
    expect(isProjectId("not-an-id")).toBe(false);
    expect(isProjectId("abc12345678")).toBe(false);
    expect(isProjectId("ABC123456789")).toBe(false);
    expect(isProjectId("../../etc/passwd")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Anchor lines (the pen's gap fill)                                   */
/* ------------------------------------------------------------------ */

describe("anchorsAlongLine", () => {
  const at = (column: number, row: number, zone: Zone = 0): Anchor => ({
    column,
    row,
    zone,
  });

  it("fills a far horizontal jump with every cell in between", () => {
    expect(anchorsAlongLine(square, at(1, 2), at(5, 2))).toEqual([
      at(2, 2),
      at(3, 2),
      at(4, 2),
      at(5, 2),
    ]);
  });

  it("walks the same cells back in the reverse direction", () => {
    expect(anchorsAlongLine(square, at(5, 2), at(1, 2))).toEqual([
      at(4, 2),
      at(3, 2),
      at(2, 2),
      at(1, 2),
    ]);
    expect(anchorsAlongLine(square, at(3, 3), at(1, 1))).toEqual([
      at(2, 3),
      at(3, 2),
      at(2, 2),
      at(1, 2),
      at(2, 1),
      at(1, 1),
    ]);
  });

  it("keeps a far diagonal jump free of gaps", () => {
    // Every exact corner crossing reports both cells that share it, so the
    // stroke is edge-connected instead of only touching at corners.
    const anchors = anchorsAlongLine(square, at(0, 0), at(3, 3));
    expect(anchors).toEqual([
      at(1, 0),
      at(0, 1),
      at(1, 1),
      at(2, 1),
      at(1, 2),
      at(2, 2),
      at(3, 2),
      at(2, 3),
      at(3, 3),
    ]);
    for (let index = 1; index < anchors.length; index++) {
      const dColumn = Math.abs(anchors[index].column - anchors[index - 1].column);
      const dRow = Math.abs(anchors[index].row - anchors[index - 1].row);
      expect(Math.max(dColumn, dRow)).toBeLessThanOrEqual(1);
    }
  });

  it("keeps an axis-aligned one-cell step exactly as it was", () => {
    expect(anchorsAlongLine(square, at(4, 4), at(5, 4))).toEqual([at(5, 4)]);
    expect(anchorsAlongLine(square, at(4, 4), at(4, 5))).toEqual([at(4, 5)]);
  });

  it("fills the shared corner of a diagonal one-cell step", () => {
    expect(anchorsAlongLine(square, at(4, 4), at(5, 5))).toEqual([
      at(5, 4),
      at(4, 5),
      at(5, 5),
    ]);
  });

  it("is empty for the same cell, whatever the zone did", () => {
    expect(anchorsAlongLine(square, at(2, 2, 0), at(2, 2, 3))).toEqual([]);
  });

  it("carries the target's zone on the cells in between", () => {
    expect(anchorsAlongLine(square, at(1, 1, 0), at(3, 1, 3))).toEqual([
      at(2, 1, 3),
      at(3, 1, 3),
    ]);
  });

  it("wraps the sectors the short way round on the circular grid", () => {
    expect(anchorsAlongLine(circular, at(0, 35), at(0, 1))).toEqual([
      at(0, 0),
      at(0, 1),
    ]);
    // 11 → 1 is two sectors forwards on a 12-sector ring (11, 0, 1).
    expect(anchorsAlongLine(circular12, at(0, 11), at(0, 1))).toEqual([
      at(0, 0),
      at(0, 1),
    ]);
  });

  it("stays total on degenerate input", () => {
    expect(
      anchorsAlongLine(square, { column: Number.NaN, row: 0, zone: 0 }, at(1, 0)),
    ).toEqual([]);
    expect(
      anchorsAlongLine(square, at(0, 0), { column: 0, row: Infinity, zone: 0 }),
    ).toEqual([]);

    // A jump far outside the board stops at the grid's own cell count, and
    // every cell it did return is a real one.
    const cap = (maxGridIndex(square.base) + 1) ** 2;
    const runaway = anchorsAlongLine(square, at(0, 0), at(1_000_000, 0));
    expect(runaway.length).toBeGreaterThan(0);
    expect(runaway.length).toBeLessThanOrEqual(cap);
    expect(
      runaway.every((anchor) => Number.isFinite(anchor.column + anchor.row)),
    ).toBe(true);
  });
});

describe("anchorsAlongStroke", () => {
  const cell = cellSize(square);
  const ink = inkUnit(square);
  const inkCentre = (column: number, row: number) => ({
    x: column * cell + ink / 2,
    y: row * cell + ink / 2,
  });
  const keys = (anchors: readonly Anchor[]) =>
    anchors.map((anchor) => `${anchor.column}:${anchor.row}:${anchor.zone}`);

  it("paints both fragments of a vertical fast drag, not only the ink", () => {
    // A slow drag down the ink column crosses the ink square, then the y-space
    // strip, of every cell. The fast drag must produce the same fragments:
    // the last cell only reaches its ink half, so it has no y-space anchor.
    expect(
      keys(anchorsAlongStroke(square, inkCentre(1, 1), inkCentre(1, 5))),
    ).toEqual([
      "1:1:0",
      "1:1:2",
      "1:2:0",
      "1:2:2",
      "1:3:0",
      "1:3:2",
      "1:4:0",
      "1:4:2",
      "1:5:0",
    ]);
  });

  it("paints both fragments of a horizontal fast drag", () => {
    expect(
      keys(anchorsAlongStroke(square, inkCentre(1, 2), inkCentre(4, 2))),
    ).toEqual([
      "1:2:0",
      "1:2:1",
      "2:2:0",
      "2:2:1",
      "3:2:0",
      "3:2:1",
      "4:2:0",
    ]);
  });

  it("matches the union of a slow drag over the same path", () => {
    // Off the fragment borders, so the sampling is unambiguous: forty tiny
    // moves must paint exactly the fragments one reported jump paints.
    const from = { x: 1.25 * cell, y: 1.25 * cell };
    const to = { x: 1.25 * cell, y: 5.75 * cell };
    const fast = new Set(keys(anchorsAlongStroke(square, from, to)));

    const slow = new Set<string>();
    let previous = from;
    for (let index = 1; index <= 40; index++) {
      const point = {
        x: from.x,
        y: from.y + ((to.y - from.y) * index) / 40,
      };
      for (const key of keys(anchorsAlongStroke(square, previous, point))) {
        slow.add(key);
      }
      previous = point;
    }

    expect(fast).toEqual(slow);
  });

  it("includes the fragments of the start cell without leaving it", () => {
    // A move from the ink square into the y-space strip of one cell changes
    // the fragment but not the cell; the start cell is part of the walk.
    expect(keys(anchorsAlongStroke(square, inkCentre(2, 2), {
      x: 2 * cell + ink / 2,
      y: 2 * cell + ink + (cell - ink) / 2,
    }))).toEqual(["2:2:0", "2:2:2"]);
  });

  it("samples the circular grid and folds sectors", () => {
    const anchors = anchorsAlongStroke(
      circular12,
      { x: 500, y: 500 },
      { x: 540, y: 500 },
    );
    expect(anchors.length).toBeGreaterThan(1);
    expect(
      anchors.every((anchor) => Number.isFinite(anchor.column + anchor.row)),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Viewport panning and zooming (the hand tool)                        */
/* ------------------------------------------------------------------ */

/**
 * A scroll container stand-in: it clamps offsets like a real one, and can
 * count horizontal offsets the RTL way (`0` at the inline start, negative
 * towards the end) or the LTR way (`0` at the start, positive towards the end).
 */
class FakeScroll implements ScrollLike {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  private left = 0;
  private top = 0;
  private readonly negative: boolean;

  constructor(
    content: { width: number; height: number },
    viewport: { width: number; height: number },
    negative = false,
  ) {
    this.scrollWidth = content.width;
    this.clientWidth = viewport.width;
    this.scrollHeight = content.height;
    this.clientHeight = viewport.height;
    this.negative = negative;
  }

  get scrollLeft(): number {
    return this.left;
  }

  set scrollLeft(value: number) {
    const max = Math.max(0, this.scrollWidth - this.clientWidth);
    const low = this.negative ? -max : 0;
    const high = this.negative ? 0 : max;
    this.left = Math.min(high, Math.max(low, value));
  }

  get scrollTop(): number {
    return this.top;
  }

  set scrollTop(value: number) {
    const max = Math.max(0, this.scrollHeight - this.clientHeight);
    this.top = Math.min(max, Math.max(0, value));
  }
}

describe("viewport scrolling", () => {
  it("detects which way the container counts horizontal offsets", () => {
    const ltr = new FakeScroll({ width: 400, height: 400 }, { width: 200, height: 200 });
    const rtl = new FakeScroll(
      { width: 400, height: 400 },
      { width: 200, height: 200 },
      true,
    );
    expect(horizontalScrollSign(ltr)).toBe(1);
    expect(horizontalScrollSign(rtl)).toBe(-1);
  });

  it("leaves the scroll position alone while probing", () => {
    const view = new FakeScroll({ width: 400, height: 400 }, { width: 200, height: 200 });
    view.scrollLeft = 40;
    expect(horizontalScrollSign(view)).toBe(1);
    expect(view.scrollLeft).toBe(40);
  });

  it("moves the board with the hand, RTL negative scrollLeft included", () => {
    // dir="rtl": the scroller counts scrollLeft from the inline-start (right)
    // edge — 0 at the start, NEGATIVE towards the left — so its reachable
    // range runs down to -(scrollWidth - clientWidth). Dragging right must
    // still move the board right, which decreases the offset in both
    // conventions: in RTL it goes deeper into the negative range rather than
    // back towards zero (the reversed behaviour this test pins against).
    expect(
      panScrollOffset({ left: -100, top: 50 }, { x: 10, y: 10 }, { x: 30, y: 40 }),
    ).toEqual({ left: -120, top: 20 });
    expect(
      panScrollOffset({ left: 100, top: 50 }, { x: 10, y: 10 }, { x: 30, y: 40 }),
    ).toEqual({ left: 80, top: 20 });
  });

  it("centres the content in either convention", () => {
    const ltr = new FakeScroll({ width: 400, height: 300 }, { width: 200, height: 100 });
    centreScroll(ltr);
    expect([ltr.scrollLeft, ltr.scrollTop]).toEqual([100, 100]);

    const rtl = new FakeScroll(
      { width: 400, height: 300 },
      { width: 200, height: 100 },
      true,
    );
    centreScroll(rtl);
    expect([rtl.scrollLeft, rtl.scrollTop]).toEqual([-100, 100]);
  });

  it("stays at the start when the content already fits", () => {
    for (const negative of [false, true]) {
      const view = new FakeScroll(
        { width: 100, height: 100 },
        { width: 200, height: 200 },
        negative,
      );
      centreScroll(view);
      expect(view.scrollLeft === 0).toBe(true);
      expect(view.scrollTop).toBe(0);
    }
  });
});

describe("zoom controls", () => {
  it("steps through the stop ladder", () => {
    // The prefs' range is passed in (`MIN_ZOOM`…`MAX_ZOOM`, 0.1…32), so the
    // ladder works for any configured range.
    expect(nextZoom(1, 1, 0.1, 32)).toBe(1.5);
    expect(nextZoom(1.5, 1, 0.1, 32)).toBe(2);
    expect(nextZoom(3, 1, 0.1, 32)).toBe(4);
    expect(nextZoom(4, 1, 0.1, 32)).toBe(6);
    expect(nextZoom(8, 1, 0.1, 32)).toBe(12);
    expect(nextZoom(24, 1, 0.1, 32)).toBe(32);
    expect(nextZoom(1, -1, 0.1, 32)).toBe(0.75);
    expect(nextZoom(0.5, -1, 0.1, 32)).toBe(0.25);
    expect(nextZoom(0.25, -1, 0.1, 32)).toBe(0.1);
  });

  it("reaches the raised 32× ceiling and stops there", () => {
    expect(ZOOM_STOPS[0]).toBe(0.1);
    expect(ZOOM_STOPS[ZOOM_STOPS.length - 1]).toBe(32);
    // The ± ladder walks every stop above the old 4× ceiling…
    let zoom = 4;
    const walked = [zoom];
    while (zoom < 32) {
      const next = nextZoom(zoom, 1, 0.1, 32);
      expect(next).toBeGreaterThan(zoom);
      zoom = next;
      walked.push(zoom);
    }
    expect(walked).toEqual([4, 6, 8, 12, 16, 24, 32]);
    // …and clamps at the top instead of running past it.
    expect(nextZoom(32, 1, 0.1, 32)).toBe(32);
  });

  it("stops at the bounds and snaps a stale value to the range", () => {
    expect(nextZoom(32, 1, 0.1, 32)).toBe(32);
    expect(nextZoom(0.1, -1, 0.1, 32)).toBe(0.1);
    // A zoom stored while the range was 0.5…2 must not escape the narrower
    // ladder, and vice versa.
    expect(nextZoom(1, 1, 0.5, 2)).toBe(1.5);
    expect(nextZoom(2, 1, 0.5, 2)).toBe(2);
    expect(nextZoom(0.4, -1, 0.5, 2)).toBe(0.5);
    // A zoom stored above the old 4× ceiling walks on instead of being the top.
    expect(nextZoom(8, 1, 0.1, 32)).toBe(12);
    // Between stops: the next one up, the previous one down.
    expect(nextZoom(0.3, 1, 0.1, 32)).toBe(0.5);
    expect(nextZoom(0.3, -1, 0.1, 32)).toBe(0.25);
  });

  it("labels the zoom as a whole percentage", () => {
    expect(zoomPercent(0.1)).toBe(10);
    expect(zoomPercent(0.75)).toBe(75);
    expect(zoomPercent(1)).toBe(100);
    expect(zoomPercent(1.5)).toBe(150);
    expect(zoomPercent(4)).toBe(400);
    expect(zoomPercent(32)).toBe(3200);
  });

  it("keeps the anchored board point under the middle of the pane", () => {
    const pane = { left: 0, top: 0, width: 1000, height: 1000 };
    // RTL scroller, offset still 0 after the surface grew to 1.5× the pane:
    // 0 is the inline-start (right) edge, so the surface's right edge stays on
    // the pane's right edge and its left edge lands at -500. The pane centre
    // (500, 500) sat 0.4 into the board and must stay there: the surface
    // travels right/down onto the target edges, i.e. the offset deepens into
    // its negative range.
    expect(
      zoomScrollOffset(
        { left: 0, top: 0 },
        { left: -500, top: 0, width: 1500, height: 1500 },
        pane,
        { x: 0.4, y: 0.4 },
      ),
    ).toEqual({ left: -400, top: 100 });

    // LTR: the same helper moves the surface by the distance it must travel
    // on screen, so the horizontal convention never enters the maths.
    expect(
      zoomScrollOffset(
        { left: 0, top: 0 },
        { left: 0, top: 0, width: 1500, height: 1500 },
        pane,
        { x: 0.4, y: 0.4 },
      ),
    ).toEqual({ left: 100, top: 100 });
  });

  it("keeps the anchored board point under the pointer when one is given", () => {
    const pane = { left: 0, top: 0, width: 1000, height: 1000 };
    // Same RTL surface and starting offset as above, but the notch landed on
    // the pointer at (750, 250): the fraction under it (0.75, 0.25 of the
    // board) must follow the pointer, not the pane centre. The board point
    // currently sits at 625/375, so the surface travels +125 on x (deeper into
    // the RTL scroller's negative range) and -125 on y.
    expect(
      zoomScrollOffset(
        { left: 0, top: 0 },
        { left: -500, top: 0, width: 1500, height: 1500 },
        pane,
        { x: 0.75, y: 0.25 },
        { x: 750, y: 250 },
      ),
    ).toEqual({ left: -125, top: 125 });
  });
});

describe("wheel zoom normalisation", () => {
  it("zooms only on Ctrl/Cmd + wheel and leaves the rest to the browser", () => {
    const wheel = (overrides: Partial<Parameters<typeof wheelZoomDelta>[0]>) => ({
      deltaX: 0,
      deltaY: 100,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      ...overrides,
    });

    // Plain wheel: no zoom, and the listener must not preventDefault it.
    expect(wheelZoomDelta(wheel({}))).toBeNull();
    expect(wheelZoomDelta(wheel({ deltaY: 0, deltaX: 100 }))).toBeNull();
    // Ctrl + wheel (Cmd on macOS): the travel keeps its sign (down zooms out).
    expect(wheelZoomDelta(wheel({ ctrlKey: true }))).toBe(100);
    expect(wheelZoomDelta(wheel({ ctrlKey: true, deltaY: -100 }))).toBe(-100);
    expect(wheelZoomDelta(wheel({ metaKey: true }))).toBe(100);
    // Some trackpads report a pinch as horizontal travel.
    expect(
      wheelZoomDelta(wheel({ ctrlKey: true, deltaY: 0, deltaX: -80 })),
    ).toBe(-80);
    // Shift + wheel is the browser's horizontal scroll, not our zoom.
    expect(wheelZoomDelta(wheel({ shiftKey: true }))).toBeNull();
    expect(
      wheelZoomDelta(wheel({ shiftKey: true, deltaY: 0, deltaX: 100 })),
    ).toBeNull();
    // Shift wins over Ctrl/Cmd: the modified wheel keeps scrolling.
    expect(wheelZoomDelta(wheel({ shiftKey: true, ctrlKey: true }))).toBeNull();
    expect(wheelZoomDelta(wheel({ shiftKey: true, metaKey: true }))).toBeNull();
    // No travel is not a gesture.
    expect(wheelZoomDelta(wheel({ ctrlKey: true, deltaY: 0 }))).toBeNull();
  });

  it("walks one stop on a gesture's first event, whatever its size or mode", () => {
    // The acceptance criterion: one Ctrl/Cmd + scroll must *visibly* zoom.
    // Banking alone left a 48 px Firefox notch (deltaMode 1) and a ~53 px
    // trackpad event under the 60 px stop — they did nothing at all.
    expect(wheelSteps(WHEEL_IDLE, 53, 0, 0)).toEqual({
      pending: 0,
      direction: 1,
      spent: 1,
      lastAt: 0,
      steps: 1,
      began: true,
    });
    expect(wheelSteps(WHEEL_IDLE, 3, 1, 0).steps).toBe(1); // 3 lines = 48 px
    expect(wheelSteps(WHEEL_IDLE, 1, 2, 0).steps).toBe(1); // a page = 100 px
    expect(wheelSteps(WHEEL_IDLE, 5, 0, 0).steps).toBe(1); // a trackpad nudge
    expect(wheelSteps(WHEEL_IDLE, -5, 0, 0).steps).toBe(-1); // up zooms in
    // The one-stop guarantee charges one stop: the rest of the event is banked.
    expect(wheelSteps(WHEEL_IDLE, 100, 0, 0)).toMatchObject({
      pending: 40,
      steps: 1,
    });
  });

  it("banks a gesture's later events towards further stops", () => {
    // The guarantee is spent on the first event; from there the bank is the old
    // one, so a notched mouse behaves exactly as before: 100 px = one stop.
    let step = wheelSteps(WHEEL_IDLE, 100, 0, 0);
    expect(step).toMatchObject({ pending: 40, steps: 1, began: true });
    step = wheelSteps(step, 100, 0, 80);
    expect(step).toMatchObject({ pending: 20, steps: 2, began: false });

    // A trackpad stream: the first nudge already stepped, the rest add up.
    step = wheelSteps(WHEEL_IDLE, 20, 0, 0);
    expect(step.steps).toBe(1);
    step = wheelSteps(step, 20, 0, 16);
    expect(step).toMatchObject({ pending: 20, steps: 0 });
    step = wheelSteps(step, 20, 0, 32);
    expect(step).toMatchObject({ pending: 40, steps: 0 });
    step = wheelSteps(step, 20, 0, 48);
    expect(step).toMatchObject({ pending: 0, steps: 1 });
  });

  it("normalises line and page deltas (deltaMode 1 / 2)", () => {
    // Firefox's 3-line notch is 48 px. The first one steps (the guarantee);
    // its 12 px shortfall then counts against the next stop, so three quick
    // notches (144 px) are two stops, exactly as 144 px of travel deserves.
    const one = wheelSteps(WHEEL_IDLE, 3, 1, 0);
    expect(one).toMatchObject({ pending: 0, steps: 1 });
    const two = wheelSteps(one, 3, 1, 50);
    expect(two).toMatchObject({ pending: 48, steps: 0 });
    const three = wheelSteps(two, 3, 1, 100);
    expect(three).toMatchObject({ pending: 36, steps: 1 });
    // A page is a whole stop with pixels to spare.
    expect(wheelSteps(WHEEL_IDLE, 1, 2, 0)).toMatchObject({
      pending: 40,
      steps: 1,
    });
  });

  it("starts a fresh gesture when the direction flips", () => {
    // The bank of one direction must never cancel the first stop of the other,
    // and the flip walks its own guaranteed stop even from an empty bank.
    const down = wheelSteps(WHEEL_IDLE, 3, 1, 0); // 48 px: one stop, no bank
    expect(wheelSteps(down, -3, 1, 40)).toEqual({
      pending: 0,
      direction: -1,
      spent: 1,
      lastAt: 40,
      steps: -1,
      began: true,
    });
    // A nonzero bank is dropped, not netted against the new direction.
    const banked = wheelSteps(WHEEL_IDLE, 100, 0, 0);
    expect(wheelSteps(banked, -10, 0, 50)).toMatchObject({
      pending: 0,
      steps: -1,
      began: true,
    });
  });

  it("caps a single gesture at its stop budget", () => {
    // A free-spinning wheel streams events; one gesture may not cross the whole
    // ladder, so the stops stop until a quiet gap (or a flip) starts the next.
    let step = wheelSteps(WHEEL_IDLE, 100, 0, 0);
    let walked = Math.abs(step.steps);
    for (let index = 1; index <= 8; index++) {
      step = wheelSteps(step, 100, 0, index * 10);
      walked += Math.abs(step.steps);
      if (index > 2) expect(step.steps).toBe(0);
    }
    expect(walked).toBe(WHEEL_GESTURE_MAX_STOPS);
    // The cap is per gesture: after the quiet gap the wheel is free again.
    expect(wheelSteps(step, 100, 0, 200)).toMatchObject({
      steps: 1,
      began: true,
    });
  });

  it("ignores zero and non-finite deltas", () => {
    expect(wheelSteps(WHEEL_IDLE, 0, 0, 5)).toEqual({
      ...WHEEL_IDLE,
      steps: 0,
      began: false,
    });
    const live: WheelGesture = {
      pending: 30,
      direction: 1,
      spent: 1,
      lastAt: 5,
    };
    for (const delta of [Number.NaN, Number.POSITIVE_INFINITY, 0]) {
      expect(wheelSteps(live, delta, 0, 90)).toEqual({
        ...live,
        steps: 0,
        began: false,
      });
    }
    // An untravelled event does not split the gesture: the clock of the last
    // real travel still decides when the next one began.
    expect(wheelSteps(wheelSteps(live, 0, 0, 90), 10, 0, 95)).toMatchObject({
      pending: 40,
      steps: 0,
      began: false,
    });
  });

  it("splits gestures at the quiet gap, just under / at / over", () => {
    const banked: WheelGesture = {
      pending: 30,
      direction: 1,
      spent: 1,
      lastAt: 1_000,
    };
    // Just under: still the same scroll, so the pixels join the bank.
    expect(
      wheelSteps(banked, 10, 0, 1_000 + WHEEL_GESTURE_GAP_MS - 1),
    ).toMatchObject({ began: false, steps: 0, pending: 40 });
    // At and over: a new scroll — one stop, whatever its size.
    for (const gap of [WHEEL_GESTURE_GAP_MS, WHEEL_GESTURE_GAP_MS + 1]) {
      expect(wheelSteps(banked, 10, 0, 1_000 + gap)).toMatchObject({
        began: true,
        steps: 1,
        pending: 0,
        spent: 1,
      });
    }
  });

  it("maps one Ctrl/Cmd + scroll-up notch to one ladder stop in", () => {
    const { steps } = wheelSteps(WHEEL_IDLE, -100, 0, 0);
    expect(steps).toBe(-1);
    // The handler's rule: `deltaY > 0` (wheel down) zooms out.
    expect(nextZoom(1, steps > 0 ? -1 : 1, 0.1, 32)).toBe(1.5);
  });
});
