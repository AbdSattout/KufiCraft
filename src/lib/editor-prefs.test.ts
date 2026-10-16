import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_CONFIG, RATIO_PRESETS } from "@/lib/canvas/model";
import {
  DEFAULT_EDITOR_PREFS,
  EDITOR_PREFS_KEY,
  LAST_CONFIG_KEY,
  MAX_INK_SWATCHES,
  type StorageLike,
  loadEditorPrefs,
  loadLastConfig,
  ratioPresetLabel,
  rememberInkSwatch,
  saveEditorPrefs,
  saveLastConfig,
} from "./editor-prefs";

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  constructor(seed: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(seed)) this.items.set(key, value);
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const throwingStorage: StorageLike = {
  getItem() {
    throw new Error("storage blocked");
  },
  setItem() {
    throw new Error("quota exceeded");
  },
};

describe("editor preferences", () => {
  it("falls back to the model defaults with no storage", () => {
    expect(loadEditorPrefs(null)).toEqual(DEFAULT_EDITOR_PREFS);
    // No `window` in the node test environment → the default resolver is null.
    expect(loadEditorPrefs()).toEqual(DEFAULT_EDITOR_PREFS);
  });

  it("round-trips every field", () => {
    const storage = new MemoryStorage();
    const prefs = {
      ...DEFAULT_EDITOR_PREFS,
      tool: "arch" as const,
      shape: "hamza2" as const,
      rotation: 3 as const,
      bulge: 1 as const,
      zoom: 1.25,
      showGrid: true,
      mergeLines: false,
      ratio: RATIO_PRESETS[4].ratio,
      inkSwatches: ["#111827", "#7c2d12"],
    };
    saveEditorPrefs(prefs, storage);
    expect(loadEditorPrefs(storage)).toEqual(prefs);
  });

  it("returns defaults for corrupt JSON and non-object values", () => {
    expect(
      loadEditorPrefs(new MemoryStorage({ [EDITOR_PREFS_KEY]: "{not json" })),
    ).toEqual(DEFAULT_EDITOR_PREFS);
    expect(
      loadEditorPrefs(new MemoryStorage({ [EDITOR_PREFS_KEY]: JSON.stringify([1, 2]) })),
    ).toEqual(DEFAULT_EDITOR_PREFS);
    expect(
      loadEditorPrefs(new MemoryStorage({ [EDITOR_PREFS_KEY]: JSON.stringify(null) })),
    ).toEqual(DEFAULT_EDITOR_PREFS);
  });

  it("replaces unknown fields one by one", () => {
    const storage = new MemoryStorage({
      [EDITOR_PREFS_KEY]: JSON.stringify({
        tool: "wand",
        shape: "star",
        rotation: 7,
        bulge: 2,
        zoom: "big",
        showGrid: "yes",
        mergeLines: 3,
        ratio: "0.75",
        inkSwatches: "red",
      }),
    });
    expect(loadEditorPrefs(storage)).toEqual(DEFAULT_EDITOR_PREFS);
  });

  it("clamps zoom and snaps the ratio to a preset", () => {
    const prefs = loadEditorPrefs(
      new MemoryStorage({
        [EDITOR_PREFS_KEY]: JSON.stringify({ zoom: 99, ratio: 0.79 }),
      }),
    );
    expect(prefs.zoom).toBe(2);
    expect(prefs.ratio).toBe(RATIO_PRESETS[3].ratio);

    const low = loadEditorPrefs(
      new MemoryStorage({ [EDITOR_PREFS_KEY]: JSON.stringify({ zoom: 0.01 }) }),
    );
    expect(low.zoom).toBe(0.5);
  });

  it("snaps NaN ratios to the default instead of storing them", () => {
    const prefs = loadEditorPrefs(
      new MemoryStorage({
        [EDITOR_PREFS_KEY]: JSON.stringify({ ratio: Number.NaN }),
      }),
    );
    expect(prefs.ratio).toBe(DEFAULT_PROJECT_CONFIG.ratio);
  });

  it("keeps at most 8 swatches, most-recent-first, deduped case-insensitively", () => {
    const many = Array.from({ length: 20 }, (_, index) => `#0000${index}`);
    const prefs = loadEditorPrefs(
      new MemoryStorage({
        [EDITOR_PREFS_KEY]: JSON.stringify({
          inkSwatches: ["#AABBCC", "#aabbcc", ...many, 42, ""],
        }),
      }),
    );
    expect(prefs.inkSwatches).toHaveLength(MAX_INK_SWATCHES);
    expect(prefs.inkSwatches[0]).toBe("#AABBCC");
    expect(prefs.inkSwatches.filter((c) => c.toLowerCase() === "#aabbcc")).toHaveLength(1);
    expect(prefs.inkSwatches.every((c) => typeof c === "string")).toBe(true);
  });

  it("never throws when the storage throws", () => {
    expect(loadEditorPrefs(throwingStorage)).toEqual(DEFAULT_EDITOR_PREFS);
    expect(() =>
      saveEditorPrefs(DEFAULT_EDITOR_PREFS, throwingStorage),
    ).not.toThrow();
  });

  it("returns null for a missing or corrupt last config", () => {
    expect(loadLastConfig(null)).toBeNull();
    expect(loadLastConfig(new MemoryStorage())).toBeNull();
    expect(
      loadLastConfig(new MemoryStorage({ [LAST_CONFIG_KEY]: "}" })),
    ).toBeNull();
    expect(
      loadLastConfig(new MemoryStorage({ [LAST_CONFIG_KEY]: JSON.stringify("x") })),
    ).toBeNull();
  });

  it("sanitises the stored last config", () => {
    const storage = new MemoryStorage({
      [LAST_CONFIG_KEY]: JSON.stringify({
        gridType: "circular",
        ratio: 0.79,
        base: 9000,
        ink: "#abcdef",
        background: "transparent",
        showGrid: true,
        mergeLines: false,
        extra: "dropped",
      }),
    });
    const config = loadLastConfig(storage);
    expect(config).toEqual({
      gridType: "circular",
      ratio: RATIO_PRESETS[3].ratio,
      base: 100,
      ink: "#abcdef",
      background: "transparent",
      showGrid: true,
      mergeLines: false,
    });

    saveLastConfig(config!, storage);
    expect(loadLastConfig(storage)).toEqual(config);
  });

  it("remembers swatches at the front without duplicates", () => {
    expect(rememberInkSwatch(["#111827", "#7c2d12"], "#7c2d12")).toEqual([
      "#7c2d12",
      "#111827",
    ]);
    expect(rememberInkSwatch([], "")).toEqual([]);
    const full = Array.from({ length: MAX_INK_SWATCHES }, (_, i) => `#00000${i}`);
    const next = rememberInkSwatch(full, "#ffffff");
    expect(next).toHaveLength(MAX_INK_SWATCHES);
    expect(next[0]).toBe("#ffffff");
    expect(next).not.toContain(full[full.length - 1]);
  });

  it("labels the preset a ratio belongs to", () => {
    expect(ratioPresetLabel(RATIO_PRESETS[2].ratio)).toBe("1:3");
    expect(ratioPresetLabel(0.79)).toBe("1:4");
    expect(ratioPresetLabel(Number.NaN)).toBe("1:3");
  });
});
