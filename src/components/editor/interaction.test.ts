import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_CONFIG, archKey, lineKey, tileKey } from "@/lib/canvas/model";
import type { CanvasItem, ProjectConfig, TileItem } from "@/lib/canvas/model";
import {
  anchorsBetween,
  cellLimits,
  clampDelta,
  clampToCanvas,
  clientToViewBox,
  configsEqual,
  deleteItems,
  duplicateItems,
  finishGesture,
  hitTest,
  isProjectId,
  itemBounds,
  itemsEqual,
  marqueeSelection,
  moveItems,
  previewItems,
  previewKeys,
  previewMarquee,
  recolourItems,
  rectFromPoints,
  reshapeItems,
  startGesture,
  updateGesture,
} from "./interaction";
import type { GestureContext } from "./interaction";
import { DEFAULT_STYLE } from "./interaction";

const square: ProjectConfig = { ...DEFAULT_PROJECT_CONFIG };
const squareNoMerge: ProjectConfig = { ...square, mergeLines: false };
const circular: ProjectConfig = { ...square, gridType: "circular" };

function tile(i: number, j: number, q: 0 | 1 | 2 | 3 = 0, extra: Partial<TileItem> = {}): TileItem {
  return { t: "tile", k: tileKey(i, j, q), i, j, q, ...extra };
}

function context(
  items: readonly CanvasItem[],
  overrides: Partial<GestureContext> = {},
): GestureContext {
  return {
    config: square,
    items,
    selection: [],
    tool: "pen",
    style: DEFAULT_STYLE,
    bulge: 0,
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
    expect(cellLimits(square)).toEqual({ maxI: 99, maxJ: 99 });
    expect(cellLimits(circular)).toEqual({ maxI: 49, maxJ: 35 });
  });
});

describe("anchorsBetween", () => {
  it("fills the cells a fast horizontal drag skipped", () => {
    const swept = anchorsBetween({ i: 2, j: 3, q: 0 }, { i: 5, j: 3, q: 0 });
    expect(swept).toEqual([
      { i: 2, j: 3, q: 0 },
      { i: 3, j: 3, q: 0 },
      { i: 4, j: 3, q: 0 },
      { i: 5, j: 3, q: 0 },
    ]);
  });

  it("walks backwards and vertically", () => {
    expect(anchorsBetween({ i: 1, j: 4, q: 2 }, { i: 1, j: 2, q: 2 })).toEqual([
      { i: 1, j: 4, q: 2 },
      { i: 1, j: 3, q: 2 },
      { i: 1, j: 2, q: 2 },
    ]);
    expect(anchorsBetween({ i: 0, j: 0, q: 0 }, { i: 0, j: 0, q: 0 })).toEqual([
      { i: 0, j: 0, q: 0 },
    ]);
  });
});

describe("hit testing", () => {
  it("respects the zone rectangles of a tile", () => {
    const items = [tile(0, 0, 0), tile(1, 0, 3)];
    expect(hitTest(square, items, { x: 2, y: 2 })?.k).toBe(tileKey(0, 0, 0));
    // Inside cell (0, 0) but in the space zone → no item there.
    expect(hitTest(square, items, { x: 8, y: 8 })).toBeNull();
    // Cell (1, 0) space-space fragment.
    expect(hitTest(square, items, { x: 18, y: 8 })?.k).toBe(tileKey(1, 0, 3));
  });

  it("returns the topmost item", () => {
    const items = [tile(0, 0, 0), tile(0, 0, 0, { c: "#ff0000" })];
    expect(hitTest(square, items, { x: 3, y: 3 })?.c).toBe("#ff0000");
  });

  it("hits lines and arches on their ink", () => {
    const line: CanvasItem = { t: "line", k: lineKey(0, 0, 4, 0), i1: 0, j1: 0, i2: 4, j2: 0 };
    expect(hitTest(square, [line], { x: 25, y: 5 })?.k).toBe(line.k);
    expect(hitTest(square, [line], { x: 25, y: 40 })).toBeNull();

    const arch: CanvasItem = {
      t: "arch",
      k: archKey(0, 0, 4, 0, 0),
      i1: 0,
      j1: 0,
      i2: 4,
      j2: 0,
      d: 0,
    };
    // Apex of the rib: the midpoint cell centre raised by the sagitta.
    const apex = itemBounds(square, arch);
    expect(hitTest(square, [arch], { x: 25, y: apex.y + apex.h / 2 })?.k).toBe(arch.k);
    expect(hitTest(square, [arch], { x: 25, y: 95 })).toBeNull();
  });

  it("hits circular slices by radius and angle", () => {
    const items = [tile(10, 0, 0)];
    // Band 10 covers radius 100…110; sector 0 is 0°…10°.
    expect(hitTest(circular, items, { x: 500 + 103, y: 500 + 5 })?.k).toBe(
      tileKey(10, 0, 0),
    );
    expect(hitTest(circular, items, { x: 500 + 103, y: 500 - 5 })).toBeNull();
    expect(hitTest(circular, items, { x: 500 + 60, y: 500 })).toBeNull();
  });

  it("computes item bounds that contain the item", () => {
    const item = tile(2, 3, 0);
    const bounds = itemBounds(square, item);
    expect(bounds).toEqual({ x: 20, y: 30, w: 7.5, h: 7.5 });
  });
});

describe("marquee selection", () => {
  it("selects every touched item", () => {
    const items = [tile(0, 0), tile(5, 5), tile(30, 30)];
    const keys = marqueeSelection(square, items, rectFromPoints({ x: -5, y: -5 }, { x: 80, y: 80 }));
    expect(keys).toEqual([tileKey(0, 0, 0), tileKey(5, 5, 0)]);
  });
});

describe("selection operations", () => {
  const items: CanvasItem[] = [
    tile(0, 0, 0, { s: "circle", r: 1, c: "#ff0000" }),
    tile(1, 0, 0),
    tile(9, 9, 0),
  ];

  it("moves items with their shape, rotation, colour and relative offset", () => {
    const moved = moveItems(square, items, [tileKey(0, 0, 0), tileKey(1, 0, 0)], 2, 3);
    const circle = moved.find((item) => item.k === tileKey(2, 3, 0));
    expect(circle).toMatchObject({ i: 2, j: 3, s: "circle", r: 1, c: "#ff0000" });
    expect(moved.some((item) => item.k === tileKey(3, 3, 0))).toBe(true);
    // Untouched items keep their identity.
    expect(moved.some((item) => item === items[2])).toBe(true);
  });

  it("clamps a move to the grid", () => {
    const corner = [tile(99, 99, 0)];
    expect(clampDelta(square, corner, [tileKey(99, 99, 0)], 5, 5)).toEqual({
      di: 0,
      dj: 0,
    });
    expect(clampDelta(square, corner, [tileKey(99, 99, 0)], -5, -5)).toEqual({
      di: -5,
      dj: -5,
    });
    const moved = moveItems(square, items, [tileKey(9, 9, 0)], 4, 4);
    expect(moved.some((item) => item.k === tileKey(13, 13, 0))).toBe(true);
  });

  it("wraps sectors when moving on the circular grid", () => {
    const items2 = [tile(2, 35, 0)];
    const moved = moveItems(circular, items2, [tileKey(2, 35, 0)], 1, 2);
    expect(moved[0].k).toBe(tileKey(3, 1, 0));
  });

  it("recolours and clears the override when the colour is the ink", () => {
    const coloured = recolourItems(square, items, [tileKey(1, 0, 0)], "#00ff00");
    expect(coloured.find((item) => item.k === tileKey(1, 0, 0))).toMatchObject({
      c: "#00ff00",
    });
    const cleared = recolourItems(
      square,
      coloured,
      [tileKey(1, 0, 0)],
      square.ink,
    );
    expect("c" in cleared.find((item) => item.k === tileKey(1, 0, 0))!).toBe(false);
  });

  it("reshapes tiles only", () => {
    const reshaped = reshapeItems(
      [tile(0, 0, 0), { t: "line", k: lineKey(0, 0, 2, 0), i1: 0, j1: 0, i2: 2, j2: 0 }],
      [tileKey(0, 0, 0), lineKey(0, 0, 2, 0)],
      { shape: "hexagon", rotation: 2 },
    );
    expect(reshaped[0]).toMatchObject({ s: "hexagon", r: 2 });
    expect(reshaped[1]).not.toHaveProperty("s");
    const reset = reshapeItems(reshaped, [tileKey(0, 0, 0)], {
      shape: "square",
      rotation: 0,
    });
    expect("s" in reset[0]).toBe(false);
    expect("r" in reset[0]).toBe(false);
  });

  it("duplicates with an offset and skips taken keys", () => {
    const { items: copy, keys } = duplicateItems(
      square,
      items,
      [tileKey(0, 0, 0), tileKey(1, 0, 0)],
    );
    expect(keys).toEqual([tileKey(1, 1, 0), tileKey(2, 1, 0)]);
    expect(copy).toHaveLength(items.length + 2);
  });

  it("deletes by key", () => {
    const left = deleteItems(items, [tileKey(0, 0, 0)]);
    expect(left.map((item) => item.k)).toEqual([tileKey(1, 0, 0), tileKey(9, 9, 0)]);
  });
});

describe("gesture reducer", () => {
  it("draws one tile on a click", () => {
    const ctx = context([]);
    const start = startGesture(ctx, { x: 5, y: 5 }, { shift: false });
    const finish = finishGesture(ctx, start.gesture);
    expect(finish.commit?.items).toEqual([tile(0, 0, 0)]);
    expect(finish.commit?.label).toBe("رسم");
  });

  it("merges a straight stroke into one line", () => {
    const ctx = context([]);
    let gesture = startGesture(ctx, { x: 5, y: 5 }, { shift: false }).gesture;
    gesture = updateGesture(ctx, gesture, { x: 15, y: 5 });
    gesture = updateGesture(ctx, gesture, { x: 45, y: 5 });
    const preview = previewItems(ctx, gesture);
    expect(preview).toHaveLength(1);
    expect(preview[0]).toMatchObject({ t: "line", i1: 0, i2: 4, j1: 0, j2: 0 });
    const finish = finishGesture(ctx, gesture);
    expect(finish.commit?.items).toHaveLength(1);
    expect(finish.commit?.items[0].t).toBe("line");
  });

  it("keeps tiles when merging is off or the run is not straight", () => {
    const noMerge = context([], { config: squareNoMerge });
    let gesture = startGesture(noMerge, { x: 5, y: 5 }, { shift: false }).gesture;
    gesture = updateGesture(noMerge, gesture, { x: 25, y: 5 });
    expect(previewItems(noMerge, gesture)).toHaveLength(3);

    const ctx = context([]);
    let bent = startGesture(ctx, { x: 5, y: 5 }, { shift: false }).gesture;
    bent = updateGesture(ctx, bent, { x: 25, y: 25 });
    const items = previewItems(ctx, bent);
    expect(items.every((item) => item.t === "tile")).toBe(true);
    expect(items.length).toBeGreaterThan(2);
  });

  it("applies the draw style to new items", () => {
    const ctx = context([], {
      style: { shape: "hexagon", rotation: 3, color: "#00ff00" },
    });
    const gesture = startGesture(ctx, { x: 5, y: 5 }, { shift: false }).gesture;
    const [item] = finishGesture(ctx, gesture).commit?.items ?? [];
    expect(item).toMatchObject({ s: "hexagon", r: 3, c: "#00ff00" });
  });

  it("erases on click and along a drag", () => {
    const items = [tile(0, 0, 0), tile(1, 0, 0), tile(2, 0, 0)];
    const ctx = context(items, { tool: "eraser" });
    let gesture = startGesture(ctx, { x: 5, y: 5 }, { shift: false }).gesture;
    expect(previewKeys(gesture)).toEqual([tileKey(0, 0, 0)]);
    gesture = updateGesture(ctx, gesture, { x: 15, y: 5 });
    gesture = updateGesture(ctx, gesture, { x: 25, y: 5 });
    expect(previewKeys(gesture)).toHaveLength(3);
    const finish = finishGesture(ctx, gesture);
    expect(finish.commit?.items).toHaveLength(0);
    expect(finish.commit?.label).toBe("مسح");
  });

  it("snaps an arch to one row or column and keeps the bulge flag", () => {
    const ctx = context([], { tool: "arch", bulge: 1 });
    let gesture = startGesture(ctx, { x: 5, y: 5 }, { shift: false }).gesture;
    // Diagonal drag → snapped onto the row of the first anchor.
    gesture = updateGesture(ctx, gesture, { x: 55, y: 45 });
    expect(gesture).toMatchObject({ kind: "arch", to: { i: 5, j: 0 } });
    const preview = previewItems(ctx, gesture);
    expect(preview[0]).toMatchObject({ t: "arch", i1: 0, j1: 0, i2: 5, j2: 0, d: 1 });
    const finish = finishGesture(ctx, gesture);
    expect(finish.commit?.items[0]).toMatchObject({ t: "arch", d: 1 });
    expect(finish.commit?.label).toBe("قوس");
  });

  it("does not create a degenerate arch", () => {
    const ctx = context([], { tool: "arch" });
    const gesture = startGesture(ctx, { x: 5, y: 5 }, { shift: false }).gesture;
    expect(finishGesture(ctx, gesture).commit).toBeNull();
  });

  it("selects with a click, extends with shift and clears on empty space", () => {
    const items = [tile(0, 0, 0), tile(1, 0, 0)];
    const ctx = context(items, { tool: "select" });
    const first = startGesture(ctx, { x: 5, y: 5 }, { shift: false });
    expect(first.selection).toEqual([tileKey(0, 0, 0)]);
    expect(first.gesture.kind).toBe("move");
    expect(finishGesture(ctx, first.gesture).commit).toBeNull();

    const extended = startGesture(
      { ...ctx, selection: [tileKey(0, 0, 0)] },
      { x: 15, y: 5 },
      { shift: true },
    );
    expect(extended.selection).toEqual([tileKey(0, 0, 0), tileKey(1, 0, 0)]);

    const empty = startGesture(ctx, { x: 500, y: 500 }, { shift: false });
    expect(empty.gesture.kind).toBe("marquee");
    expect(empty.selection).toEqual([]);
    expect(previewMarquee(empty.gesture)).toEqual({ x: 500, y: 500, w: 0, h: 0 });
  });

  it("selects with the marquee box and highlights the hits live", () => {
    const items = [tile(0, 0, 0), tile(1, 0, 0), tile(50, 50, 0)];
    const ctx = context(items, { tool: "select" });
    let gesture = startGesture(ctx, { x: 200, y: 200 }, { shift: false }).gesture;
    gesture = updateGesture(ctx, gesture, { x: -20, y: -20 });
    const finish = finishGesture(ctx, gesture);
    expect(finish.commit).toBeNull();
    expect(finish.selection).toEqual([tileKey(0, 0, 0), tileKey(1, 0, 0)]);
    expect(previewItems(ctx, gesture)).toHaveLength(2);
  });

  it("moves the selection by dragging and snaps to whole cells", () => {
    const items = [tile(0, 0, 0), tile(1, 0, 0)];
    const ctx = context(items, {
      tool: "select",
      selection: items.map((item) => item.k),
    });
    let gesture = startGesture(ctx, { x: 5, y: 5 }, { shift: false }).gesture;
    gesture = updateGesture(ctx, gesture, { x: 25, y: 15 });
    expect(previewItems(ctx, gesture).map((item) => item.k)).toEqual([
      tileKey(2, 1, 0),
      tileKey(3, 1, 0),
    ]);
    const finish = finishGesture(ctx, gesture);
    expect(finish.commit?.label).toBe("تحريك");
    expect(finish.commit?.items.map((item) => item.k)).toEqual([
      tileKey(2, 1, 0),
      tileKey(3, 1, 0),
    ]);
  });
});

describe("comparison helpers", () => {
  it("compares items structurally regardless of object identity", () => {
    expect(itemsEqual([tile(0, 0, 0)], [tile(0, 0, 0)])).toBe(true);
    expect(itemsEqual([tile(0, 0, 0)], [tile(0, 0, 1)])).toBe(false);
    expect(itemsEqual([tile(0, 0, 0, { c: "#000" })], [tile(0, 0, 0)])).toBe(false);
    expect(itemsEqual([], [])).toBe(true);
  });

  it("compares configs field by field", () => {
    expect(configsEqual(square, { ...square })).toBe(true);
    expect(configsEqual(square, { ...square, ratio: 0.5 })).toBe(false);
  });

  it("guards project ids from the URL", () => {
    expect(isProjectId("j57863dx4nchfny4jyta44x7hh8gdsnm")).toBe(true);
    expect(isProjectId("not-an-id")).toBe(false);
    expect(isProjectId("../../etc/passwd")).toBe(false);
  });
});
