import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_CONFIG,
  arcKey,
  lineKey,
  strokeKey,
  tileKey,
} from "@/lib/canvas/model";
import type {
  Anchor,
  CanvasItem,
  Cell,
  ProjectConfig,
  TileItem,
  Zone,
} from "@/lib/canvas/model";
import type { CanvasState } from "@/lib/canvas/ops";
import {
  addItems,
  lineItems,
  paintItems,
  penItems,
  removeItems,
  replaceItems,
  toOps,
} from "@/lib/canvas/ops";
import { itemColor } from "@/lib/canvas/items";
import { inkUnit, zoneRect } from "@/lib/canvas/geometry";

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return { ...DEFAULT_PROJECT_CONFIG, ...overrides };
}

function tile(
  column: number,
  row: number,
  zone: Zone,
  extra: Partial<TileItem> = {},
): TileItem {
  return {
    type: "tile",
    key: tileKey(column, row, zone),
    column,
    row,
    zone,
    ...extra,
  };
}

function state(items: CanvasItem[]): CanvasState {
  return { items };
}

const A = tile(0, 0, 0);
const B = tile(1, 0, 0);
const C = tile(2, 0, 0);

describe("addItems", () => {
  it("appends new keys and ignores existing ones", () => {
    const next = addItems(state([A]), [B, A, C]);
    expect(next.items.map((item) => item.key)).toEqual([A.key, B.key, C.key]);
  });

  it("keeps the first occurrence of a duplicated key inside the batch", () => {
    const first = tile(3, 3, 1, { color: "#111111" });
    const second = tile(3, 3, 1, { color: "#222222" });
    const next = addItems(state([]), [first, second]);
    expect(next.items).toEqual([first]);
  });

  it("does not mutate its input and returns the same state when nothing is added", () => {
    const before = state([A]);
    expect(addItems(before, [A])).toBe(before);
    expect(before.items).toEqual([A]);
  });
});

describe("removeItems", () => {
  it("removes listed keys and ignores unknown ones", () => {
    const next = removeItems(state([A, B, C]), [B.key, "missing"]);
    expect(next.items).toEqual([A, C]);
  });

  it("returns the same state for an empty key list", () => {
    const before = state([A]);
    expect(removeItems(before, [])).toBe(before);
  });
});

describe("paintItems", () => {
  it("replaces a same-key item in place and leaves the rest untouched", () => {
    const recoloured = tile(0, 0, 0, { color: "#ff0000" });
    const next = paintItems(state([A, B]), [recoloured]);
    expect(next.items).toEqual([recoloured, B]);
    // Untouched items keep their object identity so React can skip them.
    expect(next.items[1]).toBe(B);
  });

  it("appends new keys", () => {
    expect(paintItems(state([A]), [B]).items).toEqual([A, B]);
  });

  it("returns the same state when nothing changes", () => {
    const before = state([A, B]);
    expect(paintItems(before, [])).toBe(before);
    expect(paintItems(before, [A])).toBe(before);
  });
});

describe("replaceItems", () => {
  it("replaces the list and dedupes by key (last occurrence wins)", () => {
    const first = tile(4, 4, 2, { color: "#111111" });
    const second = tile(4, 4, 2, { color: "#222222" });
    expect(replaceItems(state([A, B]), [C, first, second]).items).toEqual([
      C,
      second,
    ]);
  });
});

describe("toOps", () => {
  it("returns no ops for identical lists", () => {
    expect(toOps([A, B], [A, B])).toEqual([]);
  });

  it("diffs appended items as an add batch", () => {
    expect(toOps([A, B], [A, B, C])).toEqual([{ type: "add", items: [C] }]);
  });

  it("re-emits the tail as remove + add when an item is dropped", () => {
    expect(toOps([A, B, C], [A, C])).toEqual([
      { type: "remove", keys: [B.key, C.key] },
      { type: "add", items: [C] },
    ]);
  });

  it("combines remove + add when the run style survives", () => {
    const D = tile(5, 5, 3);
    expect(toOps([A, B, C], [A, C, D])).toEqual([
      { type: "remove", keys: [B.key, C.key] },
      { type: "add", items: [C, D] },
    ]);
  });

  it("re-emits the tail when an item changed under the same key", () => {
    const recoloured = tile(0, 0, 0, { color: "#ff0000" });
    expect(toOps([A, B], [recoloured, B])).toEqual([
      { type: "remove", keys: [A.key, B.key] },
      { type: "add", items: [recoloured, B] },
    ]);
  });

  it("re-emits the tail when the order changed", () => {
    expect(toOps([A, B], [B, A])).toEqual([
      { type: "remove", keys: [A.key, B.key] },
      { type: "add", items: [B, A] },
    ]);
  });

  it("treats default and explicit optional fields as equal", () => {
    const explicit = tile(0, 0, 0, { shape: "square", rotation: 0 });
    expect(toOps([A], [explicit])).toEqual([]);
  });

  it("produces batches the backend applyOps accepts", () => {
    const line = {
      type: "line",
      key: lineKey({ column: 0, row: 1 }, { column: 3, row: 1 }),
      from: { column: 0, row: 1 },
      to: { column: 3, row: 1 },
    } as const;
    const arc = {
      type: "arc",
      key: arcKey(
        { column: 0, row: 2 },
        { column: 3, row: 2 },
        "clockwise",
        "half",
      ),
      from: { column: 0, row: 2 },
      to: { column: 3, row: 2 },
      direction: "clockwise",
      size: "half",
    } as const;
    expect(toOps([], [line, arc])).toEqual([
      { type: "add", items: [line, arc] },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* penItems                                                            */
/* ------------------------------------------------------------------ */

const run = (from: number, to: number, zone: Zone, row = 4): Anchor[] => {
  const anchors: Anchor[] = [];
  const step = from <= to ? 1 : -1;
  for (let column = from; step > 0 ? column <= to : column >= to; column += step) {
    anchors.push({ column, row, zone });
  }
  return anchors;
};

describe("penItems", () => {
  it("paints one tile per anchor, never a merged bar", () => {
    const config = makeConfig();
    const items = penItems(config, run(2, 5, 0));
    expect(items).toEqual([
      {
        type: "tile",
        key: tileKey(2, 4, 0),
        column: 2,
        row: 4,
        zone: 0,
        color: config.ink,
      },
      {
        type: "tile",
        key: tileKey(3, 4, 0),
        column: 3,
        row: 4,
        zone: 0,
        color: config.ink,
      },
      {
        type: "tile",
        key: tileKey(4, 4, 0),
        column: 4,
        row: 4,
        zone: 0,
        color: config.ink,
      },
      {
        type: "tile",
        key: tileKey(5, 4, 0),
        column: 5,
        row: 4,
        zone: 0,
        color: config.ink,
      },
    ]);
  });

  it("keeps the order the pointer moved in", () => {
    const config = makeConfig();
    expect(penItems(config, run(5, 2, 0))).toEqual(
      penItems(config, run(2, 5, 0)).reverse(),
    );
  });

  it("keeps the zone of each anchor", () => {
    const config = makeConfig();
    const anchors: Anchor[] = [
      { column: 2, row: 4, zone: 0 },
      { column: 3, row: 4, zone: 1 },
      { column: 4, row: 4, zone: 3 },
    ];
    expect(penItems(config, anchors).map((item) => item.key)).toEqual([
      tileKey(2, 4, 0),
      tileKey(3, 4, 1),
      tileKey(4, 4, 3),
    ]);
  });

  it("collapses consecutive identical anchors", () => {
    const config = makeConfig();
    const anchors: Anchor[] = [
      { column: 1, row: 1, zone: 0 },
      { column: 1, row: 1, zone: 0 },
      { column: 1, row: 1, zone: 0 },
      { column: 2, row: 1, zone: 0 },
      { column: 2, row: 1, zone: 0 },
    ];
    expect(penItems(config, anchors).map((item) => item.key)).toEqual([
      tileKey(1, 1, 0),
      tileKey(2, 1, 0),
    ]);
  });

  it("draws a single tap as one tile", () => {
    const config = makeConfig();
    expect(penItems(config, [{ column: 3, row: 9, zone: 1 }])).toEqual([
      {
        type: "tile",
        key: tileKey(3, 9, 1),
        column: 3,
        row: 9,
        zone: 1,
        color: config.ink,
      },
    ]);
    expect(penItems(config, [])).toEqual([]);
  });

  it("applies the shape / rotation palette and colour override", () => {
    const config = makeConfig({ ink: "#1a1a2e" });
    const shaped = penItems(config, [{ column: 0, row: 0, zone: 0 }], {
      shape: "circle",
      rotation: 3,
      color: "#ff0000",
    });
    expect(shaped).toEqual([
      {
        type: "tile",
        key: tileKey(0, 0, 0),
        column: 0,
        row: 0,
        zone: 0,
        shape: "circle",
        rotation: 3,
        color: "#ff0000",
      },
    ]);
  });

  it("drops the shape / rotation defaults but always keeps a concrete colour", () => {
    const config = makeConfig({ ink: "#1a1a2e" });
    // The shape / rotation defaults are canonicalised away…
    expect(
      penItems(config, [{ column: 0, row: 0, zone: 0 }], {
        shape: "square",
        rotation: 0,
      }),
    ).toEqual([
      {
        type: "tile",
        key: tileKey(0, 0, 0),
        column: 0,
        row: 0,
        zone: 0,
        color: "#1a1a2e",
      },
    ]);
    // …but the resolved colour is always stored, even when it is the ink.
    expect(penItems(config, run(0, 2, 0))).toEqual([
      {
        type: "tile",
        key: tileKey(0, 4, 0),
        column: 0,
        row: 4,
        zone: 0,
        color: "#1a1a2e",
      },
      {
        type: "tile",
        key: tileKey(1, 4, 0),
        column: 1,
        row: 4,
        zone: 0,
        color: "#1a1a2e",
      },
      {
        type: "tile",
        key: tileKey(2, 4, 0),
        column: 2,
        row: 4,
        zone: 0,
        color: "#1a1a2e",
      },
    ]);
  });

  it("stores the document ink when the pen has no colour of its own", () => {
    const config = makeConfig({ ink: "#101010" });
    expect(penItems(config, [{ column: 0, row: 0, zone: 0 }])).toEqual([
      {
        type: "tile",
        key: tileKey(0, 0, 0),
        column: 0,
        row: 0,
        zone: 0,
        color: "#101010",
      },
    ]);
    expect(penItems(config, run(2, 5, 0))).toEqual([
      {
        type: "tile",
        key: tileKey(2, 4, 0),
        column: 2,
        row: 4,
        zone: 0,
        color: "#101010",
      },
      {
        type: "tile",
        key: tileKey(3, 4, 0),
        column: 3,
        row: 4,
        zone: 0,
        color: "#101010",
      },
      {
        type: "tile",
        key: tileKey(4, 4, 0),
        column: 4,
        row: 4,
        zone: 0,
        color: "#101010",
      },
      {
        type: "tile",
        key: tileKey(5, 4, 0),
        column: 5,
        row: 4,
        zone: 0,
        color: "#101010",
      },
    ]);
  });

  it("stores the tool colour on every fragment it returns", () => {
    const config = makeConfig({ ink: "#101010" });
    expect(
      penItems(config, [{ column: 0, row: 0, zone: 0 }], { color: "#ff0000" }),
    ).toEqual([
      {
        type: "tile",
        key: tileKey(0, 0, 0),
        column: 0,
        row: 0,
        zone: 0,
        color: "#ff0000",
      },
    ]);
    const tiles = penItems(config, run(0, 2, 0), { color: "#ff0000" });
    expect(tiles).toHaveLength(3);
    expect(tiles.every((item) => item.color === "#ff0000")).toBe(true);
  });

  it("uses the same tiles on the circular grid", () => {
    const config = makeConfig({ gridType: "circular" });
    const anchors: Anchor[] = [
      { column: 5, row: 35, zone: 0 },
      { column: 5, row: 0, zone: 0 },
    ];
    expect(penItems(config, anchors)).toEqual([
      {
        type: "tile",
        key: tileKey(5, 35, 0),
        column: 5,
        row: 35,
        zone: 0,
        color: config.ink,
      },
      {
        type: "tile",
        key: tileKey(5, 0, 0),
        column: 5,
        row: 0,
        zone: 0,
        color: config.ink,
      },
    ]);
  });

  it("feeds an applyOps add batch straight from a stroke", () => {
    const config = makeConfig();
    const items = penItems(config, run(2, 5, 0));
    expect(toOps([], items)).toEqual([{ type: "add", items }]);
    expect(addItems(state([]), items).items).toEqual(items);
  });
});

/* ------------------------------------------------------------------ */
/* lineItems                                                           */
/* ------------------------------------------------------------------ */

describe("lineItems", () => {
  /** The option off: a straight run becomes one solid bar. */
  const bars = makeConfig({ straightLinesAsSquares: false });

  it("draws a two-point straight run as one square per cell", () => {
    const config = makeConfig();
    const items = lineItems(
      config,
      [
        { column: 0, row: 4 },
        { column: 2, row: 4 },
      ],
      false,
    );
    expect(items).toEqual([
      {
        type: "tile",
        key: tileKey(0, 4, 0),
        column: 0,
        row: 4,
        zone: 0,
        color: config.ink,
      },
      {
        type: "tile",
        key: tileKey(1, 4, 0),
        column: 1,
        row: 4,
        zone: 0,
        color: config.ink,
      },
      {
        type: "tile",
        key: tileKey(2, 4, 0),
        column: 2,
        row: 4,
        zone: 0,
        color: config.ink,
      },
    ]);
  });

  it("draws the same run as one bar when the option is off", () => {
    expect(
      lineItems(
        bars,
        [
          { column: 0, row: 4 },
          { column: 5, row: 4 },
        ],
        false,
      ),
    ).toEqual([
      {
        type: "line",
        key: lineKey({ column: 0, row: 4 }, { column: 5, row: 4 }),
        from: { column: 0, row: 4 },
        to: { column: 5, row: 4 },
        color: bars.ink,
      },
    ]);
  });

  it("canonicalises the two points of a bar", () => {
    expect(
      lineItems(
        bars,
        [
          { column: 5, row: 4 },
          { column: 0, row: 4 },
        ],
        false,
      ),
    ).toEqual(
      lineItems(
        bars,
        [
          { column: 0, row: 4 },
          { column: 5, row: 4 },
        ],
        false,
      ),
    );
  });

  it("covers the same cells whichever way the run was drawn", () => {
    const config = makeConfig();
    const keys = (points: readonly Cell[]) =>
      lineItems(config, points, false)
        .map((item) => item.key)
        .sort();
    expect(keys([{ column: 5, row: 4 }, { column: 0, row: 4 }])).toEqual(
      keys([{ column: 0, row: 4 }, { column: 5, row: 4 }]),
    );
  });

  it("splits each straight leg of a polyline into squares", () => {
    const items = lineItems(
      makeConfig(),
      [
        { column: 0, row: 0 },
        { column: 2, row: 0 },
        { column: 2, row: 2 },
      ],
      false,
    );
    expect(items.map((item) => item.key)).toEqual([
      tileKey(0, 0, 0),
      tileKey(1, 0, 0),
      tileKey(2, 0, 0),
      tileKey(2, 1, 0),
      tileKey(2, 2, 0),
    ]);
  });

  it("strokes a diagonal instead of squares", () => {
    const items = lineItems(
      makeConfig(),
      [
        { column: 0, row: 0 },
        { column: 3, row: 3 },
      ],
      false,
    );
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("stroke");
  });

  it("strokes a run that has any diagonal leg", () => {
    const items = lineItems(
      makeConfig(),
      [
        { column: 0, row: 0 },
        { column: 2, row: 0 },
        { column: 3, row: 3 },
      ],
      false,
    );
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("stroke");
  });

  it("outlines a closed axis-aligned run with squares", () => {
    const items = lineItems(
      makeConfig(),
      [
        { column: 0, row: 0 },
        { column: 2, row: 0 },
        { column: 2, row: 2 },
        { column: 0, row: 2 },
      ],
      true,
    );
    expect(items.map((item) => item.key)).toEqual([
      tileKey(0, 0, 0),
      tileKey(1, 0, 0),
      tileKey(2, 0, 0),
      tileKey(2, 1, 0),
      tileKey(2, 2, 0),
      tileKey(1, 2, 0),
      tileKey(0, 2, 0),
      tileKey(0, 1, 0),
    ]);
  });

  it("strokes a closed run whose closing segment is diagonal", () => {
    const config = makeConfig();
    const points: Cell[] = [
      { column: 0, row: 0 },
      { column: 2, row: 0 },
      { column: 2, row: 2 },
    ];
    expect(lineItems(config, points, true)).toEqual([
      {
        type: "stroke",
        key: strokeKey(points, true),
        points,
        closed: true,
        color: config.ink,
      },
    ]);
  });

  it("strokes a closed two-point run when the option is off", () => {
    const points: Cell[] = [
      { column: 0, row: 4 },
      { column: 5, row: 4 },
    ];
    expect(lineItems(bars, points, true)).toEqual([
      {
        type: "stroke",
        key: strokeKey(points, true),
        points,
        closed: true,
        color: bars.ink,
      },
    ]);
  });

  it("returns nothing for fewer than two unique points", () => {
    const config = makeConfig();
    expect(lineItems(config, [], false)).toEqual([]);
    expect(lineItems(config, [{ column: 1, row: 1 }], false)).toEqual([]);
    expect(
      lineItems(
        config,
        [
          { column: 1, row: 1 },
          { column: 1, row: 1 },
        ],
        false,
      ),
    ).toEqual([]);
  });

  it("keeps the colour override on squares and on a bar", () => {
    const config = makeConfig();
    const points: Cell[] = [
      { column: 0, row: 0 },
      { column: 2, row: 0 },
    ];
    expect(lineItems(config, points, false, "#00ff00")).toEqual([
      {
        type: "tile",
        key: tileKey(0, 0, 0),
        column: 0,
        row: 0,
        zone: 0,
        color: "#00ff00",
      },
      {
        type: "tile",
        key: tileKey(1, 0, 0),
        column: 1,
        row: 0,
        zone: 0,
        color: "#00ff00",
      },
      {
        type: "tile",
        key: tileKey(2, 0, 0),
        column: 2,
        row: 0,
        zone: 0,
        color: "#00ff00",
      },
    ]);
    expect(lineItems(bars, points, false, "#00ff00")).toEqual([
      {
        type: "line",
        key: lineKey({ column: 0, row: 0 }, { column: 2, row: 0 }),
        from: { column: 0, row: 0 },
        to: { column: 2, row: 0 },
        color: "#00ff00",
      },
    ]);
  });

  it("stores the document ink on squares and on a polyline", () => {
    const config = makeConfig({ ink: "#101010" });
    const squares = lineItems(
      config,
      [
        { column: 0, row: 4 },
        { column: 5, row: 4 },
      ],
      false,
    );
    expect(squares).toHaveLength(6);
    expect(squares.every((item) => item.color === "#101010")).toBe(true);
    // A diagonal is a polyline, and it carries the same resolved colour.
    const stroke = lineItems(
      config,
      [
        { column: 0, row: 0 },
        { column: 3, row: 3 },
      ],
      false,
    );
    expect(stroke).toHaveLength(1);
    expect(stroke[0]).toMatchObject({ type: "stroke", color: "#101010" });
  });
});

/* ------------------------------------------------------------------ */
/* Per-item colour                                                     */
/* ------------------------------------------------------------------ */

describe("per-item colour", () => {
  it("keeps the colour on the fragment when the document ink changes", () => {
    const ink1 = makeConfig({ ink: "#111111" });
    const items: CanvasItem[] = [
      ...penItems(ink1, run(2, 5, 0)),
      ...penItems(ink1, [{ column: 0, row: 0, zone: 0 }]),
    ];
    const ink2 = makeConfig({ ink: "#222222" });
    // The colour is stored on the item, so reading the same fragment under a
    // different document ink does not repaint it.
    for (const item of items) {
      expect(item.color).toBe("#111111");
      expect(itemColor(ink2, item)).toBe("#111111");
    }
    // An item that carries no colour of its own still follows the config.
    expect(itemColor(ink2, tile(7, 7, 0))).toBe("#222222");
  });
});

/* ------------------------------------------------------------------ */
/* ratio 1 (the space-less cell)                                       */
/* ------------------------------------------------------------------ */

describe("ratio 1 (the space-less cell)", () => {
  it("draws one whole-cell tile per anchor of a bent pen stroke", () => {
    const config = makeConfig({ ratio: 1 });
    const anchors: Anchor[] = [
      { column: 0, row: 0, zone: 0 },
      { column: 1, row: 0, zone: 0 },
      { column: 1, row: 1, zone: 0 },
    ];
    const items = penItems(config, anchors);
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.type === "tile")).toBe(true);
    expect(items.map((item) => item.key)).toEqual([
      tileKey(0, 0, 0),
      tileKey(1, 0, 0),
      tileKey(1, 1, 0),
    ]);
    // The ink fills the whole cell, so a fragment is one base × base square.
    expect(inkUnit(config)).toBe(config.base);
    expect(zoneRect(config, 1, 1, 0)).toEqual({
      x: 1 * config.base,
      y: 1 * config.base,
      w: inkUnit(config),
      h: inkUnit(config),
    });
  });

  it("still resolves the document ink on the line tool", () => {
    const config = makeConfig({ ratio: 1 });
    const items = lineItems(
      config,
      [
        { column: 0, row: 0 },
        { column: 4, row: 0 },
      ],
      false,
    );
    expect(items.map((item) => item.key)).toEqual([
      tileKey(0, 0, 0),
      tileKey(1, 0, 0),
      tileKey(2, 0, 0),
      tileKey(3, 0, 0),
      tileKey(4, 0, 0),
    ]);
    expect(items.every((item) => item.color === config.ink)).toBe(true);
  });
});
