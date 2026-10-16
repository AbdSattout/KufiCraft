import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_CONFIG,
  MAX_ITEMS,
  MAX_NAME_LENGTH,
  RATIO_PRESETS,
  archKey,
  lineKey,
  tileKey,
} from "@/lib/canvas/model";
import type { CanvasItem, ProjectConfig } from "@/lib/canvas/model";
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
    { t: "tile", k: tileKey(2, 3, 0), i: 2, j: 3, q: 0 },
    { t: "tile", k: tileKey(4, 3, 0), i: 4, j: 3, q: 0, s: "circle", c: "#7c2d12", r: 2 },
    { t: "line", k: lineKey(2, 3, 4, 3), i1: 2, j1: 3, i2: 4, j2: 3 },
    { t: "arch", k: archKey(2, 2, 4, 2, 1), i1: 2, j1: 2, i2: 4, j2: 2, d: 1 },
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
    mergeLines: false,
  };
}

function rawFile(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: "kuficraft",
    version: 1,
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
    expect(parsed.version).toBe(1);
    expect(parsed.name).toBe("لوحة الاختبار");
    expect(parsed.exportedAt).toBe(FIXED_AT);
    expect(parsed.config).toEqual(sampleConfig());
    expect(parsed.items).toEqual(sampleItems());
  });

  it("strips unknown fields from config and items", () => {
    const dirtyItem = {
      t: "tile",
      k: tileKey(0, 0, 0),
      i: 0,
      j: 0,
      q: 0,
      extra: "nope",
    } as unknown as CanvasItem;
    const text = exportProjectFile({
      name: "x",
      config: { ...sampleConfig(), extra: "nope" } as unknown as ProjectConfig,
      items: [dirtyItem],
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
    for (const version of [0, 2, "1", 1.5, null]) {
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
          mergeLines: true,
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
      mergeLines: true,
    });
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

  it("drops bad discriminants, NaN coordinates and missing keys", () => {
    const parsed = parseProjectFile(
      rawFile({
        items: [
          { t: "circle", k: "x", i: 0, j: 0, q: 0 },
          { t: "tile", k: "a", i: 0, j: 3, q: 0 },
          { t: "tile", k: "b", i: Number.NaN, j: 0, q: 0 },
          { t: "tile", k: "c", i: 0, j: 0, q: 9 },
          { t: "tile", i: 0, j: 0, q: 0 },
          { t: "line", k: "d", i1: 0, j1: 0, i2: 0, j2: Infinity },
          { t: "arch", k: "e", i1: 0, j1: 0, i2: 0, j2: 0, d: 7 },
          null,
          "nope",
        ],
      }),
    );
    expect(parsed.items).toEqual([{ t: "tile", k: "a", i: 0, j: 3, q: 0 }]);
  });

  it("dedupes by key (first wins)", () => {
    const first = { t: "tile", k: "same", i: 1, j: 1, q: 0 };
    const second = { t: "tile", k: "same", i: 9, j: 9, q: 3 };
    const parsed = parseProjectFile(rawFile({ items: [first, second] }));
    expect(parsed.items).toEqual([first]);
  });

  it("caps at MAX_ITEMS and reports the excess", () => {
    const items = Array.from({ length: MAX_ITEMS + 5 }, (_, index) => ({
      t: "tile",
      k: tileKey(index, 0, 0),
      i: index,
      j: 0,
      q: 0,
    }));
    const parsed = parseProjectFile(rawFile({ items }));
    expect(parsed.items).toHaveLength(MAX_ITEMS);
    expect(parsed.droppedItems).toBe(5);
  });
});

describe("normalizeItem", () => {
  it("keeps only the model fields of a valid item", () => {
    expect(normalizeItem(sampleItems()[1])).toEqual(sampleItems()[1]);
  });

  it("returns null for anything that is not a model item", () => {
    expect(normalizeItem(undefined)).toBeNull();
    expect(normalizeItem([])).toBeNull();
    expect(normalizeItem({ t: "tile", k: "", i: 0, j: 0, q: 0 })).toBeNull();
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
  it("is exported for the browser call sites", () => {
    expect(typeof downloadProjectFile).toBe("function");
  });
});
