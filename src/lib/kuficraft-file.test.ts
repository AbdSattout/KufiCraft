import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORNER_ALL,
  DEFAULT_BORDER_COLOR,
  DEFAULT_PROJECT_CONFIG,
  MAX_CIRCULAR_SECTORS,
  MAX_ITEMS,
  MAX_NAME_LENGTH,
  MIN_CIRCULAR_SECTORS,
  RATIO_PRESETS,
  arcKey,
  lineKey,
  strokeKey,
  tileKey,
} from "@/lib/canvas/model";
import type { CanvasItem, LinePoint, ProjectConfig } from "@/lib/canvas/model";
import {
  FILE_ERRORS,
  FALLBACK_FILE_NAME,
  FALLBACK_PROJECT_NAME,
  downloadProjectFile,
  exportProjectFile,
  normalizeItem,
  parseProjectFile,
  projectFileName,
  readProjectFile,
  sanitizeProjectConfig,
  sanitizeProjectName,
  type ProjectFileInput,
} from "./kuficraft-file";

const FIXED_AT = "2026-10-16T12:00:00.000Z";

function sampleItems(): CanvasItem[] {
  return [
    { type: "tile", key: tileKey(2, 3, 0), column: 2, row: 3, zone: 0 },
    {
      type: "tile",
      key: tileKey(4, 3, 0),
      column: 4,
      row: 3,
      zone: 0,
      shape: "circle",
      color: "#7c2d12",
      rotation: 2,
    },
    {
      type: "line",
      key: lineKey({ column: 2, row: 3 }, { column: 4, row: 3 }),
      from: { column: 2, row: 3 },
      to: { column: 4, row: 3 },
      cap: "round",
      join: "bevel",
    },
    {
      type: "stroke",
      key: strokeKey(
        [
          { column: 1, row: 1 },
          { column: 2, row: 2 },
          { column: 3, row: 1 },
        ],
        false,
      ),
      points: [
        { column: 1, row: 1 },
        { column: 2, row: 2 },
        { column: 3, row: 1 },
      ],
      cap: "square",
      join: "round",
    },
    {
      type: "arc",
      key: arcKey(
        { column: 2, row: 2 },
        { column: 4, row: 2 },
        "counterclockwise",
        "half",
      ),
      from: { column: 2, row: 2 },
      to: { column: 4, row: 2 },
      direction: "counterclockwise",
      size: "half",
      cap: "round",
      join: "bevel",
    },
  ];
}

function sampleConfig(): ProjectConfig {
  return {
    gridType: "circular",
    ratio: RATIO_PRESETS[3].ratio,
    base: 25,
    circularSectors: 24,
    ink: "#0f172a",
    background: "transparent",
    showGrid: true,
    straightLinesAsSquares: false,
  };
}

function rawFile(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: "kuficraft",
    version: 2,
    name: "لوحة الاختبار",
    config: sampleConfig(),
    items: sampleItems(),
    exportedAt: FIXED_AT,
    ...overrides,
  });
}

describe("exportProjectFile", () => {
  it("writes minified JSON with the documented envelope", () => {
    const text = exportProjectFile(
      { name: "لوحة الاختبار", config: sampleConfig(), items: sampleItems() },
      FIXED_AT,
    );
    expect(text).not.toContain("\n");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.format).toBe("kuficraft");
    expect(parsed.version).toBe(2);
    expect(parsed.name).toBe("لوحة الاختبار");
    expect(parsed.exportedAt).toBe(FIXED_AT);
    expect(parsed.config).toEqual(sampleConfig());
    expect(parsed.items).toEqual(sampleItems());
  });

  it("strips unknown fields from config and items", () => {
    const dirtyItem = {
      type: "tile",
      key: tileKey(0, 0, 0),
      column: 0,
      row: 0,
      zone: 0,
      extra: "nope",
    } as unknown as CanvasItem;
    const text = exportProjectFile({
      name: "x",
      config: { ...sampleConfig(), extra: "nope" } as unknown as ProjectConfig,
      items: [normalizeItem(dirtyItem, sampleConfig())!],
    });
    const parsed = JSON.parse(text) as {
      config: Record<string, unknown>;
      items: Array<Record<string, unknown>>;
    };
    expect(parsed.config).not.toHaveProperty("extra");
    expect(parsed.items[0]).not.toHaveProperty("extra");
  });

  it("round-trips through parseProjectFile", () => {
    const input: ProjectFileInput = {
      name: "لوحة الاختبار",
      config: sampleConfig(),
      items: sampleItems(),
    };
    const parsed = parseProjectFile(exportProjectFile(input, FIXED_AT));
    expect(parsed.name).toBe(input.name);
    expect(parsed.config).toEqual(input.config);
    expect(parsed.items).toEqual([...input.items]);
    expect(parsed.droppedItems).toBe(0);
  });

  it("round-trips fragment zones, canonicalising the ink zone", () => {
    const inkPoint: LinePoint = { column: 0, row: 0 };
    const spacePoint: LinePoint = {
      column: 2,
      row: 2,
      zone: 3,
      anchor: { x: 0.5, y: 0 },
    };
    const items: CanvasItem[] = [
      {
        type: "line",
        key: "bogus",
        from: { column: 1, row: 2, zone: 1 },
        to: { column: 4, row: 2, zone: 3 },
      },
      {
        type: "arc",
        key: "bogus",
        from: { column: 2, row: 2, zone: 0 },
        to: { column: 4, row: 2, zone: 2 },
        direction: "clockwise",
        size: "half",
      },
      {
        type: "stroke",
        key: "bogus",
        points: [
          { column: 0, row: 0, zone: 0 },
          { column: 2, row: 2, zone: 3, anchor: { x: 0.5, y: 0 } },
        ],
      },
    ];
    const parsed = parseProjectFile(
      exportProjectFile({ name: "x", config: sampleConfig(), items }, FIXED_AT),
    );
    expect(parsed.items).toEqual([
      {
        type: "line",
        key: lineKey(
          { column: 1, row: 2, zone: 1 },
          { column: 4, row: 2, zone: 3 },
        ),
        from: { column: 1, row: 2, zone: 1 },
        to: { column: 4, row: 2, zone: 3 },
      },
      {
        type: "arc",
        key: arcKey(
          { column: 2, row: 2 },
          { column: 4, row: 2, zone: 2 },
          "clockwise",
          "half",
        ),
        from: { column: 2, row: 2 },
        to: { column: 4, row: 2, zone: 2 },
        direction: "clockwise",
        size: "half",
      },
      {
        type: "stroke",
        key: strokeKey([inkPoint, spacePoint], false),
        points: [inkPoint, spacePoint],
      },
    ]);
  });

  it("skips an item carrying an invalid fragment zone", () => {
    const parsed = parseProjectFile(
      rawFile({
        items: [
          {
            type: "line",
            key: "bogus",
            from: { column: 1, row: 2, zone: 7 },
            to: { column: 4, row: 2, zone: 1 },
          },
          { type: "tile", key: "bogus", column: 0, row: 0, zone: 0 },
        ],
      }),
    );
    // A bad zone is structural — it decides where the point is — so the item
    // is skipped rather than silently moved to the ink fragment.
    expect(parsed.items).toEqual([
      { type: "tile", key: tileKey(0, 0, 0), column: 0, row: 0, zone: 0 },
    ]);
  });

  it("round-trips an anchored stroke, dropping a stored centre", () => {
    const items: CanvasItem[] = [
      {
        type: "stroke",
        key: "bogus",
        points: [
          { column: 0, row: 0, anchor: { x: 0, y: 0.25 } },
          { column: 1, row: 0, anchor: { x: 0.5, y: 0.5 } },
          { column: 2, row: 0 },
        ],
        closed: true,
      },
    ];
    const points: LinePoint[] = [
      { column: 0, row: 0, anchor: { x: 0, y: 0.25 } },
      { column: 1, row: 0 },
      { column: 2, row: 0 },
    ];
    const parsed = parseProjectFile(
      exportProjectFile({ name: "x", config: sampleConfig(), items }, FIXED_AT),
    );
    expect(parsed.items).toEqual([
      { type: "stroke", key: strokeKey(points, true), points, closed: true },
    ]);
  });
});

describe("parseProjectFile — envelope", () => {
  it("rejects invalid JSON and a wrong format literal", () => {
    expect(() => parseProjectFile("{")).toThrow(FILE_ERRORS.notKuficraft);
    expect(() => parseProjectFile("[]")).toThrow(FILE_ERRORS.notKuficraft);
    expect(() => parseProjectFile(JSON.stringify({ format: "svg", version: 1 }))).toThrow(
      FILE_ERRORS.notKuficraft,
    );
    expect(() => parseProjectFile(JSON.stringify({ version: 1 }))).toThrow(
      FILE_ERRORS.notKuficraft,
    );
  });

  it("rejects unknown / non-integer versions", () => {
    for (const version of [0, 3, "1", 1.5, null]) {
      expect(() => parseProjectFile(rawFile({ version }))).toThrow(
        FILE_ERRORS.unknownVersion,
      );
    }
  });
});

describe("parseProjectFile — config and name", () => {
  it("sanitises config like the backend", () => {
    const parsed = parseProjectFile(
      rawFile({
        config: {
          gridType: "spiral",
          ratio: 0.79,
          base: 500,
          ink: "#abcdef",
          background: "transparent",
          showGrid: "yes",
          straightLinesAsSquares: false,
          unknown: 1,
        },
      }),
    );
    expect(parsed.config).toEqual({
      gridType: "square",
      ratio: RATIO_PRESETS[3].ratio,
      base: 100,
      circularSectors: DEFAULT_PROJECT_CONFIG.circularSectors,
      ink: "#abcdef",
      background: "transparent",
      showGrid: DEFAULT_PROJECT_CONFIG.showGrid,
      straightLinesAsSquares: false,
    });
  });

  it("rounds and clamps the circular sector count", () => {
    const sectors = (value: unknown) =>
      parseProjectFile(
        rawFile({ config: { ...sampleConfig(), circularSectors: value } }),
      ).config.circularSectors;
    // An absent or unusable count falls back to the 36-sector default…
    expect(sectors(undefined)).toBe(DEFAULT_PROJECT_CONFIG.circularSectors);
    expect(sectors("12")).toBe(DEFAULT_PROJECT_CONFIG.circularSectors);
    // …a fraction rounds to the nearest sector, and the range clamps.
    expect(sectors(12.4)).toBe(12);
    expect(sectors(3)).toBe(MIN_CIRCULAR_SECTORS);
    expect(sectors(1000)).toBe(MAX_CIRCULAR_SECTORS);
  });

  it("drops the legacy mergeLines flag and fills the new one", () => {
    const parsed = parseProjectFile(
      rawFile({
        config: {
          ...sampleConfig(),
          mergeLines: true,
          straightLinesAsSquares: undefined,
        },
      }),
    );
    expect(parsed.config.straightLinesAsSquares).toBe(
      DEFAULT_PROJECT_CONFIG.straightLinesAsSquares,
    );
    expect(parsed.config).not.toHaveProperty("mergeLines");
  });

  it("defaults missing config fields", () => {
    const parsed = parseProjectFile(rawFile({ config: undefined }));
    expect(parsed.config).toEqual(DEFAULT_PROJECT_CONFIG);
    expect(parsed.config.base).toBe(50);
  });

  it("defaults a missing / empty / oversized name", () => {
    expect(parseProjectFile(rawFile({ name: undefined })).name).toBe(
      FALLBACK_PROJECT_NAME,
    );
    expect(parseProjectFile(rawFile({ name: "   " })).name).toBe(
      FALLBACK_PROJECT_NAME,
    );
    expect(parseProjectFile(rawFile({ name: 42 })).name).toBe(FALLBACK_PROJECT_NAME);
    const long = parseProjectFile(rawFile({ name: "ب".repeat(400) })).name;
    expect(long).toHaveLength(MAX_NAME_LENGTH);
    expect(parseProjectFile(rawFile({ name: "  لوحة   كبيرة  " })).name).toBe(
      "لوحة كبيرة",
    );
  });
});

describe("parseProjectFile — items", () => {
  it("treats missing / non-array items as empty", () => {
    expect(parseProjectFile(rawFile({ items: undefined })).items).toEqual([]);
    expect(parseProjectFile(rawFile({ items: {} })).items).toEqual([]);
    expect(parseProjectFile(rawFile({ items: "nope" })).items).toEqual([]);
  });

  it("upgrades v1 abbreviated items", () => {
    const parsed = parseProjectFile(
      JSON.stringify({
        format: "kuficraft",
        version: 1,
        name: "قديم",
        config: { gridType: "square", base: 10 },
        items: [
          { t: "tile", i: 1, j: 2, q: 0, s: "semi-hexagone", r: 1, c: "#123456" },
          { t: "tile", i: 5, j: 5, q: 0, s: "arc" },
          { t: "line", i1: 0, j1: 0, i2: 3, j2: 0 },
          { t: "arch", i1: 0, j1: 0, i2: 4, j2: 0, d: 1 },
        ],
      }),
    );
    expect(parsed.items).toEqual([
      {
        type: "tile",
        key: tileKey(1, 2, 0),
        column: 1,
        row: 2,
        zone: 0,
        shape: "pentagon",
        rotation: 1,
        color: "#123456",
      },
      {
        type: "tile",
        key: tileKey(5, 5, 0),
        column: 5,
        row: 5,
        zone: 0,
        shape: "curve",
      },
      {
        type: "line",
        key: lineKey({ column: 0, row: 0 }, { column: 3, row: 0 }),
        from: { column: 0, row: 0 },
        to: { column: 3, row: 0 },
      },
      {
        type: "arc",
        key: arcKey(
          { column: 0, row: 0 },
          { column: 4, row: 0 },
          "counterclockwise",
          "half",
        ),
        from: { column: 0, row: 0 },
        to: { column: 4, row: 0 },
        direction: "counterclockwise",
        size: "half",
      },
    ]);
  });

  it("drops bad discriminants, NaN coordinates and missing keys", () => {
    const parsed = parseProjectFile(
      rawFile({
        items: [
          { type: "circle", key: "x", column: 0, row: 0, zone: 0 },
          { type: "tile", key: "a", column: 0, row: 3, zone: 0 },
          { type: "tile", key: "b", column: Number.NaN, row: 0, zone: 0 },
          { type: "tile", key: "c", column: 0, row: 0, zone: 9 },
          { type: "tile", column: 0, row: 0, zone: 0 },
          {
            type: "line",
            key: "d",
            from: { column: 0, row: 0 },
            to: { column: 0, row: Infinity },
          },
          {
            type: "arc",
            key: "e",
            from: { column: 0, row: 0 },
            to: { column: 0, row: 0 },
            direction: "clockwise",
            size: "half",
          },
          null,
          "nope",
        ],
      }),
    );
    // `key` is ignored on read (re-derived), so the item without one is kept.
    expect(parsed.items).toEqual([
      { type: "tile", key: tileKey(0, 3, 0), column: 0, row: 3, zone: 0 },
      { type: "tile", key: tileKey(0, 0, 0), column: 0, row: 0, zone: 0 },
    ]);
  });

  it("clamps and repairs line anchors instead of dropping the point", () => {
    const points: LinePoint[] = [
      { column: 0, row: 0, anchor: { x: 0, y: 0.25 } },
      { column: 1, row: 0, anchor: { x: 1, y: 0 } }, // clamped from (2, -1)
      { column: 2, row: 0 }, // repaired from a non-numeric x
      { column: 3, row: 0 }, // a stored centre is canonical storage of nothing
    ];
    const parsed = parseProjectFile(
      rawFile({
        items: [
          {
            type: "stroke",
            key: "bogus",
            points: [
              { column: 0, row: 0, anchor: { x: 0, y: 0.25 } },
              { column: 1, row: 0, anchor: { x: 2, y: -1 } },
              { column: 2, row: 0, anchor: { x: "nope", y: 0.5 } },
              { column: 3, row: 0, anchor: { x: 0.5, y: 0.5 } },
            ],
          },
        ],
      }),
    );
    expect(parsed.items).toEqual([
      { type: "stroke", key: strokeKey(points, false), points },
    ]);
  });

  it("keeps an arc's anchors — the centre included — and repairs the legacy diagonal", () => {
    const parsed = parseProjectFile(
      rawFile({
        items: [
          {
            type: "arc",
            key: "bogus",
            from: { column: 0, row: 2, anchor: { x: 0.5, y: 0.5 } },
            to: { column: 4, row: 2, anchor: { x: 3, y: -1 } },
            direction: "clockwise",
            size: "quarter",
          },
          {
            type: "arc",
            key: "bogus",
            from: { column: 0, row: 4, anchor: { x: "nope", y: 0 } },
            to: { column: 4, row: 4 },
            direction: "clockwise",
            size: "nope",
          },
          {
            type: "arc",
            key: "bogus",
            from: { column: 0, row: 6 },
            to: { column: 4, row: 10 },
            direction: "clockwise",
            size: "half",
          },
        ],
      }),
    ).items;

    // The centre is a value like any other on an arc endpoint; a damaged
    // anchor is clamped or dropped, never a reason to lose the item.
    expect(parsed[0]).toEqual({
      type: "arc",
      key: arcKey(
        { column: 0, row: 2, anchor: { x: 0.5, y: 0.5 } },
        { column: 4, row: 2, anchor: { x: 1, y: 0 } },
        "clockwise",
        "quarter",
      ),
      from: { column: 0, row: 2, anchor: { x: 0.5, y: 0.5 } },
      to: { column: 4, row: 2, anchor: { x: 1, y: 0 } },
      direction: "clockwise",
      size: "quarter",
    });
    // A damaged anchor reads as absent — the endpoint's legacy spring point —
    // and an unrecognised size means half.
    expect(parsed[1]).toMatchObject({
      from: { column: 0, row: 4 },
      to: { column: 4, row: 4 },
      size: "half",
    });
    // The legacy diagonal half is repaired to the quarter that draws the very
    // same rib (`repairArcSize`).
    expect(parsed[2]).toMatchObject({
      from: { column: 0, row: 6 },
      to: { column: 4, row: 10 },
      size: "quarter",
    });
    expect(parsed[2].key).toBe(
      arcKey({ column: 0, row: 6 }, { column: 4, row: 10 }, "clockwise", "quarter"),
    );
  });

  it("dedupes by key (first wins)", () => {
    const first = {
      type: "tile",
      key: "bogus-one",
      column: 1,
      row: 1,
      zone: 0,
      color: "#111827",
    };
    const second = {
      type: "tile",
      key: "bogus-two",
      column: 1,
      row: 1,
      zone: 0,
      color: "#7c2d12",
    };
    const parsed = parseProjectFile(rawFile({ items: [first, second] }));
    expect(parsed.items).toEqual([
      {
        type: "tile",
        key: tileKey(1, 1, 0),
        column: 1,
        row: 1,
        zone: 0,
        color: "#111827",
      },
    ]);
  });

  it("caps at MAX_ITEMS and reports the excess", () => {
    const items = Array.from({ length: MAX_ITEMS + 5 }, (_, index) => {
      const column = index % 251;
      const row = Math.floor(index / 251);
      const zone = (index % 4) as 0 | 1 | 2 | 3;
      return {
        type: "tile",
        key: tileKey(column, row, zone),
        column,
        row,
        zone,
      };
    });
    const parsed = parseProjectFile(
      rawFile({
        config: { ...sampleConfig(), gridType: "square", base: 4 },
        items,
      }),
    );
    expect(parsed.items).toHaveLength(MAX_ITEMS);
    expect(parsed.droppedItems).toBe(5);
  });
});

describe("normalizeItem", () => {
  it("keeps only the model fields of a valid item", () => {
    expect(normalizeItem(sampleItems()[1], sampleConfig())).toEqual(
      sampleItems()[1],
    );
    expect(normalizeItem(sampleItems()[3], sampleConfig())).toEqual(
      sampleItems()[3],
    );
    expect(normalizeItem(sampleItems()[4], sampleConfig())).toEqual(
      sampleItems()[4],
    );
  });

  it("keeps, clamps and drops the style fields", () => {
    const config = sampleConfig();
    const styled = normalizeItem(
      {
        type: "tile",
        column: 0,
        row: 0,
        zone: 0,
        rounding: { radius: 0.9, corners: CORNER_ALL | 16 },
        border: { width: 99, color: "#ff0000" },
      },
      config,
    );
    expect(styled).toMatchObject({
      rounding: { radius: 0.5, corners: CORNER_ALL },
      border: { width: 12, color: "#ff0000" },
    });

    // Width 0 is the absent state: a reader drops the border instead of
    // storing a no-op style.
    const off = normalizeItem(
      {
        type: "tile",
        column: 0,
        row: 0,
        zone: 0,
        rounding: { radius: 0, corners: CORNER_ALL },
        border: { width: 0, color: "#ff0000" },
      },
      config,
    );
    expect(off).not.toHaveProperty("rounding");
    expect(off).not.toHaveProperty("border");
    // A broken or missing width drops the field rather than guessing a style.
    const broken = normalizeItem(
      {
        type: "tile",
        column: 0,
        row: 0,
        zone: 0,
        rounding: { corners: CORNER_ALL },
        border: { color: "#ff0000" },
      },
      config,
    );
    expect(broken).not.toHaveProperty("rounding");
    expect(broken).not.toHaveProperty("border");
    // A missing colour is black; it is never the item's ink.
    expect(
      normalizeItem(
        {
          type: "tile",
          column: 0,
          row: 0,
          zone: 0,
          border: { width: 2 },
        },
        config,
      )?.border,
    ).toEqual({ width: 2, color: DEFAULT_BORDER_COLOR });
  });

  it("keeps stroke caps and joins, dropping defaults and unknown values", () => {
    const config = sampleConfig();
    const line = sampleItems()[2];
    expect(normalizeItem({ ...line, cap: "round", join: "bevel" }, config)).toMatchObject({
      cap: "round",
      join: "bevel",
    });
    for (const style of [
      { cap: "butt", join: "miter" },
      { cap: "bogus", join: "bogus" },
    ]) {
      const clean = normalizeItem({ ...line, ...style }, config);
      expect(clean).not.toHaveProperty("cap");
      expect(clean).not.toHaveProperty("join");
    }
  });

  it("keeps a border on every item type and rounding where it applies", () => {
    const config = sampleConfig();
    const border = { width: 2, color: "#000000" };
    for (const item of sampleItems().slice(1)) {
      expect(normalizeItem({ ...item, border }, config)).toMatchObject({ border });
    }
    // Rounding applies to tiles, line bars and polylines — not to an arc.
    for (const item of sampleItems().slice(0, 4)) {
      expect(
        normalizeItem(
          { ...item, rounding: { radius: 0.2, corners: CORNER_ALL } },
          config,
        ),
      ).toMatchObject({ rounding: { radius: 0.2, corners: CORNER_ALL } });
    }
    const arcItem = sampleItems()[4];
    expect(
      normalizeItem(
        { ...arcItem, rounding: { radius: 0.2, corners: CORNER_ALL } },
        config,
      ),
    ).toEqual(arcItem);
  });

  it("round-trips style fields through export and parse", () => {
    const config = sampleConfig();
    const items: CanvasItem[] = [
      {
        type: "tile",
        key: tileKey(0, 0, 0),
        column: 0,
        row: 0,
        zone: 0,
        rounding: { radius: 0.15, corners: 5 },
        border: { width: 3, color: "#123456" },
      },
      {
        type: "line",
        key: lineKey({ column: 0, row: 1 }, { column: 4, row: 1 }),
        from: { column: 0, row: 1 },
        to: { column: 4, row: 1 },
        rounding: { radius: 0.2, corners: CORNER_ALL },
        border: { width: 2, color: "#000000" },
      },
    ];
    const parsed = parseProjectFile(exportProjectFile({ name: "أنماط", config, items }));
    expect(parsed.items).toEqual(items);
  });

  it("returns null for anything that is not a model item", () => {
    const config = sampleConfig();
    expect(normalizeItem(undefined, config)).toBeNull();
    expect(normalizeItem([], config)).toBeNull();
    expect(
      normalizeItem({ type: "tile", column: 0, row: 0, zone: 9 }, config),
    ).toBeNull();
    expect(
      normalizeItem(
        { type: "stroke", points: [{ column: 0, row: 0 }] },
        config,
      ),
    ).toBeNull();
  });

  it("bounds the sector index by the board's own sector count", () => {
    const eight = { ...sampleConfig(), circularSectors: 8 };
    const tileAt = (row: number) => ({ type: "tile", column: 0, row, zone: 0 });
    expect(normalizeItem(tileAt(7), eight)).toMatchObject({ row: 7 });
    // Sector 8 is one past the last sector of an 8-sector ring…
    expect(normalizeItem(tileAt(8), eight)).toBeNull();
    // …but inside the ring of the sample board (24 sectors).
    expect(normalizeItem(tileAt(8), sampleConfig())).toMatchObject({ row: 8 });
  });
});

describe("sanitizeProjectConfig / sanitizeProjectName", () => {
  it("totally sanitises unknown input", () => {
    expect(sanitizeProjectConfig(undefined)).toEqual(DEFAULT_PROJECT_CONFIG);
    expect(sanitizeProjectConfig(42)).toEqual(DEFAULT_PROJECT_CONFIG);
    expect(sanitizeProjectConfig({ base: -3 }).base).toBe(4);
  });

  it("totally sanitises names", () => {
    expect(sanitizeProjectName(undefined)).toBe(FALLBACK_PROJECT_NAME);
    expect(sanitizeProjectName("  أ  ب ")).toBe("أ ب");
  });
});

describe("projectFileName", () => {
  it("sanitises the name and appends the extension", () => {
    expect(projectFileName("لوحة الاختبار")).toBe("لوحة-الاختبار.kuficraft");
    expect(projectFileName("a/b:c*d")).toBe("a-b-c-d.kuficraft");
  });

  it("falls back for an empty name", () => {
    expect(projectFileName("")).toBe(FALLBACK_FILE_NAME);
  });
});

describe("readProjectFile", () => {
  it("reads a file-like object and validates it", async () => {
    const file = {
      text: async () => rawFile(),
    } as unknown as File;
    const parsed = await readProjectFile(file);
    expect(parsed.name).toBe("لوحة الاختبار");
    expect(parsed.items).toHaveLength(sampleItems().length);
  });

  it("propagates the Arabic format error", async () => {
    const file = { text: async () => "{}" } as unknown as File;
    await expect(readProjectFile(file)).rejects.toThrow(FILE_ERRORS.notKuficraft);
  });
});

describe("downloadProjectFile", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("clicks a temporary <a download> with the sanitised file name", () => {
    const anchor = {
      href: "",
      download: "",
      rel: "",
      clicks: 0,
      removed: false,
      click() {
        this.clicks += 1;
      },
      remove() {
        this.removed = true;
      },
    };
    const appendChild = vi.fn();
    vi.stubGlobal("document", {
      createElement: () => anchor,
      body: { appendChild },
    });
    vi.stubGlobal("window", { setTimeout: () => 0 });

    downloadProjectFile({
      name: "لوحة الاختبار",
      config: sampleConfig(),
      items: sampleItems(),
    });

    expect(anchor.download).toBe("لوحة-الاختبار.kuficraft");
    expect(anchor.href.startsWith("blob:")).toBe(true);
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.clicks).toBe(1);
    expect(anchor.removed).toBe(true);
  });
});
