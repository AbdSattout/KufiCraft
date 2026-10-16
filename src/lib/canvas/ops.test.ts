import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_CONFIG,
  archKey,
  lineKey,
  tileKey,
} from "@/lib/canvas/model";
import type {
  CanvasItem,
  ProjectConfig,
  TileItem,
} from "@/lib/canvas/model";
import type { CanvasState } from "@/lib/canvas/ops";
import {
  addItems,
  removeItems,
  replaceItems,
  strokeToItems,
  toOps,
} from "@/lib/canvas/ops";
import type { Anchor } from "@/lib/canvas/grid";

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return { ...DEFAULT_PROJECT_CONFIG, ...overrides };
}

function tile(i: number, j: number, q: 0 | 1 | 2 | 3, extra: Partial<TileItem> = {}): TileItem {
  return { t: "tile", k: tileKey(i, j, q), i, j, q, ...extra };
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
    expect(next.items.map((item) => item.k)).toEqual([A.k, B.k, C.k]);
  });

  it("keeps the first occurrence of a duplicated key inside the batch", () => {
    const first = tile(3, 3, 1, { c: "#111111" });
    const second = tile(3, 3, 1, { c: "#222222" });
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
    const next = removeItems(state([A, B, C]), [B.k, "missing"]);
    expect(next.items).toEqual([A, C]);
  });

  it("returns the same state for an empty key list", () => {
    const before = state([A]);
    expect(removeItems(before, [])).toBe(before);
  });
});

describe("replaceItems", () => {
  it("replaces the list and dedupes by key (last occurrence wins)", () => {
    const first = tile(4, 4, 2, { c: "#111111" });
    const second = tile(4, 4, 2, { c: "#222222" });
    expect(replaceItems(state([A, B]), [C, first, second]).items).toEqual([C, second]);
  });
});

describe("toOps", () => {
  it("returns no ops for identical lists", () => {
    expect(toOps([A, B], [A, B])).toEqual([]);
  });

  it("diffs appended items as an add batch", () => {
    expect(toOps([A, B], [A, B, C])).toEqual([{ type: "add", items: [C] }]);
  });

  it("diffs removed items as a remove batch", () => {
    expect(toOps([A, B, C], [A, C])).toEqual([
      { type: "remove", keys: [B.k] },
    ]);
  });

  it("combines remove + add when the run style survives", () => {
    const D = tile(5, 5, 3);
    expect(toOps([A, B, C], [A, C, D])).toEqual([
      { type: "remove", keys: [B.k] },
      { type: "add", items: [D] },
    ]);
  });

  it("replaces when an item changed under the same key", () => {
    const recoloured = { ...A, c: "#ff0000" } as CanvasItem;
    expect(toOps([A, B], [recoloured, B])).toEqual([
      { type: "replace", items: [recoloured, B] },
    ]);
  });

  it("replaces when the order changed", () => {
    expect(toOps([A, B], [B, A])).toEqual([{ type: "replace", items: [B, A] }]);
  });

  it("treats default and explicit optional fields as equal", () => {
    const explicit = { ...A, s: "square", r: 0 } as CanvasItem;
    expect(toOps([A], [explicit])).toEqual([]);
  });

  it("produces batches the backend applyOps accepts", () => {
    const line = {
      t: "line",
      k: lineKey(0, 1, 3, 1),
      i1: 0,
      j1: 1,
      i2: 3,
      j2: 1,
    } as const;
    const arch = {
      t: "arch",
      k: archKey(0, 2, 3, 2, 1),
      i1: 0,
      j1: 2,
      i2: 3,
      j2: 2,
      d: 1,
    } as const;
    expect(toOps([], [line, arch])).toEqual([
      { type: "add", items: [line, arch] },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* strokeToItems                                                       */
/* ------------------------------------------------------------------ */

const run = (from: number, to: number, q: 0 | 1 | 2 | 3, j = 4): Anchor[] => {
  const anchors: Anchor[] = [];
  const step = from <= to ? 1 : -1;
  for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
    anchors.push({ i, j, q });
  }
  return anchors;
};

describe("strokeToItems", () => {
  it("merges a straight run into one line", () => {
    const config = makeConfig();
    const items = strokeToItems(config, run(2, 5, 0));
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      t: "line",
      k: lineKey(2, 4, 5, 4),
      i1: 2,
      j1: 4,
      i2: 5,
      j2: 4,
    });
  });

  it("canonicalises the run direction", () => {
    const config = makeConfig();
    expect(strokeToItems(config, run(5, 2, 0))).toEqual(
      strokeToItems(config, run(2, 5, 0)),
    );
  });

  it("merges vertical runs into a column line", () => {
    const config = makeConfig();
    const anchors: Anchor[] = [
      { i: 3, j: 7, q: 2 },
      { i: 3, j: 6, q: 2 },
      { i: 3, j: 5, q: 2 },
    ];
    expect(strokeToItems(config, anchors)).toEqual([
      { t: "line", k: lineKey(3, 5, 3, 7), i1: 3, j1: 5, i2: 3, j2: 7 },
    ]);
  });

  it("keeps tiles for an L-shaped run", () => {
    const config = makeConfig();
    const anchors: Anchor[] = [
      { i: 0, j: 0, q: 0 },
      { i: 1, j: 0, q: 0 },
      { i: 1, j: 1, q: 0 },
    ];
    const items = strokeToItems(config, anchors);
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.t === "tile")).toBe(true);
    expect(items.map((item) => item.k)).toEqual([
      tileKey(0, 0, 0),
      tileKey(1, 0, 0),
      tileKey(1, 1, 0),
    ]);
  });

  it("keeps tiles when mergeLines is off", () => {
    const config = makeConfig();
    const items = strokeToItems(config, run(2, 5, 0), { mergeLines: false });
    expect(items).toHaveLength(4);
    expect(items.every((item) => item.t === "tile")).toBe(true);
  });

  it("keeps tiles when the zone quadrant changes inside the run", () => {
    const config = makeConfig();
    const anchors: Anchor[] = [
      { i: 2, j: 4, q: 0 },
      { i: 3, j: 4, q: 0 },
      { i: 4, j: 4, q: 1 },
    ];
    expect(strokeToItems(config, anchors)).toHaveLength(3);
  });

  it("collapses consecutive identical anchors", () => {
    const config = makeConfig();
    const anchors: Anchor[] = [
      { i: 1, j: 1, q: 0 },
      { i: 1, j: 1, q: 0 },
      { i: 1, j: 1, q: 0 },
      { i: 2, j: 1, q: 0 },
      { i: 2, j: 1, q: 0 },
    ];
    expect(strokeToItems(config, anchors)).toEqual([
      { t: "line", k: lineKey(1, 1, 2, 1), i1: 1, j1: 1, i2: 2, j2: 1 },
    ]);
  });

  it("draws a single tap as one tile", () => {
    const config = makeConfig();
    expect(strokeToItems(config, [{ i: 3, j: 9, q: 1 }])).toEqual([
      { t: "tile", k: tileKey(3, 9, 1), i: 3, j: 9, q: 1 },
    ]);
    expect(strokeToItems(config, [])).toEqual([]);
  });

  it("applies the shape / rotation palette and colour override", () => {
    const config = makeConfig({ ink: "#1a1a2e" });
    const shaped = strokeToItems(config, [{ i: 0, j: 0, q: 0 }], {
      shape: "circle",
      rotation: 3,
      color: "#ff0000",
    });
    expect(shaped).toEqual([
      {
        t: "tile",
        k: tileKey(0, 0, 0),
        i: 0,
        j: 0,
        q: 0,
        s: "circle",
        r: 3,
        c: "#ff0000",
      },
    ]);
  });

  it("drops defaults and the config ink colour from the payload", () => {
    const config = makeConfig({ ink: "#1a1a2e" });
    expect(
      strokeToItems(config, [{ i: 0, j: 0, q: 0 }], {
        shape: "square",
        rotation: 0,
        color: "#1a1a2e",
      }),
    ).toEqual([{ t: "tile", k: tileKey(0, 0, 0), i: 0, j: 0, q: 0 }]);
    expect(
      strokeToItems(config, run(0, 2, 0), { color: "#00ff00" }),
    ).toEqual([
      {
        t: "line",
        k: lineKey(0, 4, 2, 4),
        i1: 0,
        j1: 4,
        i2: 2,
        j2: 4,
        c: "#00ff00",
      },
    ]);
  });

  it("merges circular runs of one band, wrapping sectors", () => {
    const config = makeConfig({ gridType: "circular" });
    const anchors: Anchor[] = [
      { i: 5, j: 35, q: 0 },
      { i: 5, j: 0, q: 0 },
    ];
    expect(strokeToItems(config, anchors)).toEqual([
      {
        t: "line",
        k: lineKey(5, 0, 5, 35),
        i1: 5,
        j1: 0,
        i2: 5,
        j2: 35,
      },
    ]);
  });

  it("feeds an applyOps add batch straight from a stroke", () => {
    const config = makeConfig();
    const items = strokeToItems(config, run(2, 5, 0));
    expect(toOps([], items)).toEqual([{ type: "add", items }]);
    expect(addItems(state([]), items).items).toEqual(items);
  });
});
