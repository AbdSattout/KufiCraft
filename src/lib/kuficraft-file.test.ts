import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BORDER_ALL,
  BORDER_BOTTOM,
  BORDER_LEFT,
  BORDER_TOP,
  CORNER_ALL,
  DEFAULT_PROJECT_CONFIG,
  MAX_ITEMS,
  MAX_NAME_LENGTH,
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
    },
  ];
}

function sampleConfig(): ProjectConfig {
  return {
    gridType: "circular",
    ratio: RATIO_PRESETS[3].ratio,
    base: 25,
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
      ink: "#abcdef",
      background: "transparent",
      showGrid: DEFAULT_PROJECT_CONFIG.showGrid,
      straightLinesAsSquares: false,
    });
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
        border: { sides: BORDER_TOP | 16, width: 99, color: "#ff0000" },
      },
      config,
    );
    expect(styled).toMatchObject({
      rounding: { radius: 0.5, corners: CORNER_ALL },
      border: { sides: BORDER_TOP, width: 12, color: "#ff0000" },
    });

    // Zero is the absent state for both fields: a reader drops them instead of
    // storing a no-op style.
    const off = normalizeItem(
      {
        type: "tile",
        column: 0,
        row: 0,
        zone: 0,
        rounding: { radius: 0, corners: CORNER_ALL },
        border: { sides: 0, width: 2 },
      },
      config,
    );
    expect(off).not.toHaveProperty("rounding");
    expect(off).not.toHaveProperty("border");
    // A broken value drops its field rather than guessing a style.
    const broken = normalizeItem(
      {
        type: "tile",
        column: 0,
        row: 0,
        zone: 0,
        rounding: { corners: CORNER_ALL },
        border: { width: 2 },
      },
      config,
    );
    expect(broken).not.toHaveProperty("rounding");
    expect(broken).not.toHaveProperty("border");
  });

  it("keeps a border on every item type but rounding only on tiles", () => {
    const config = sampleConfig();
    const border = { sides: BORDER_ALL, width: 2 };
    for (const item of sampleItems().slice(1)) {
      expect(normalizeItem({ ...item, border }, config)).toMatchObject({ border });
    }
    const lineItem = sampleItems()[2];
    expect(
      normalizeItem(
        { ...lineItem, rounding: { radius: 0.2, corners: CORNER_ALL } },
        config,
      ),
    ).toEqual(lineItem);
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
        border: { sides: BORDER_LEFT, width: 3, color: "#123456" },
      },
      {
        type: "line",
        key: lineKey({ column: 0, row: 1 }, { column: 4, row: 1 }),
        from: { column: 0, row: 1 },
        to: { column: 4, row: 1 },
        border: { sides: BORDER_BOTTOM, width: 2 },
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
