import { describe, expect, it } from "vitest";
import {
  DEFAULT_BORDER,
  DEFAULT_PROJECT_CONFIG,
  MAX_COLOR_LENGTH,
  RATIO_PRESETS,
} from "@/lib/canvas/model";
import {
  DEFAULT_EDITOR_PREFS,
  EDITOR_PREFS_KEY,
  LAST_CONFIG_KEY,
  MAX_INK_SWATCHES,
  MAX_ZOOM,
  MIN_ZOOM,
  type StorageLike,
  loadEditorPrefs,
  loadLastConfig,
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
    expect(DEFAULT_EDITOR_PREFS.border).toEqual(DEFAULT_BORDER);
    expect(DEFAULT_EDITOR_PREFS.border.width).toBe(0);
    expect(DEFAULT_EDITOR_PREFS.cap).toBe("butt");
    expect(DEFAULT_EDITOR_PREFS.join).toBe("miter");
  });

  it("round-trips every field", () => {
    const storage = new MemoryStorage();
    const prefs = {
      ...DEFAULT_EDITOR_PREFS,
      tool: "arc" as const,
      shape: "hamza2" as const,
      rotation: 3 as const,
      arc: {
        direction: "counterclockwise" as const,
        size: "threeQuarter" as const,
      },
      zoom: 1.25,
      showGrid: false,
      inkSwatches: ["#111827", "#7c2d12"],
      rounding: { radius: 0.15, corners: 5 },
      border: { width: 4, color: "#123456" },
      cap: "round" as const,
      join: "bevel" as const,
    };
    saveEditorPrefs(prefs, storage);
    expect(loadEditorPrefs(storage)).toEqual(prefs);
  });

  it("keeps the draw style across boards — it is the user's, not the project's", () => {
    // The editor reads the prefs when it mounts, so the shape + rotation set on
    // one board are what the next board opens with; a document never carries
    // them (docs/UI.md §Editor).
    const storage = new MemoryStorage();
    saveEditorPrefs(
      { ...DEFAULT_EDITOR_PREFS, shape: "curve", rotation: 3 },
      storage,
    );
    const reopened = loadEditorPrefs(storage);
    expect(reopened.shape).toBe("curve");
    expect(reopened.rotation).toBe(3);
  });

  it("clamps rounding and border prefs, including the off width", () => {
    const prefs = loadEditorPrefs(
      new MemoryStorage({
        [EDITOR_PREFS_KEY]: JSON.stringify({
          rounding: { radius: 9, corners: 15 | 16 },
          border: { width: 0, color: "x".repeat(80) },
        }),
      }),
    );
    expect(prefs.rounding).toEqual({ radius: 0.5, corners: 15 });
    expect(prefs.border.width).toBe(0);
    expect(prefs.border.color).toBe("x".repeat(MAX_COLOR_LENGTH));

    const defaulted = loadEditorPrefs(
      new MemoryStorage({
        [EDITOR_PREFS_KEY]: JSON.stringify({ border: { width: 4 } }),
      }),
    );
    expect(defaulted.border).toEqual({ width: 4, color: "#000000" });
  });

  it("resets a pre-width-switch border once, so its old width is not carried", () => {
    const storage = new MemoryStorage({
      [EDITOR_PREFS_KEY]: JSON.stringify({
        border: { sides: 15, width: 2, color: "#123456" },
      }),
    });
    expect(loadEditorPrefs(storage).border).toEqual(DEFAULT_BORDER);
    // Saving writes the current shape, so the stale mask is gone for good.
    saveEditorPrefs(loadEditorPrefs(storage), storage);
    const stored = JSON.parse(storage.getItem(EDITOR_PREFS_KEY) ?? "{}") as {
      border?: Record<string, unknown>;
    };
    expect(stored.border).toEqual(DEFAULT_BORDER);
    expect(stored.border).not.toHaveProperty("sides");
  });

  it("reads stroke caps and joins, falling back to the defaults", () => {
    const explicit = loadEditorPrefs(
      new MemoryStorage({
        [EDITOR_PREFS_KEY]: JSON.stringify({ cap: "round", join: "bevel" }),
      }),
    );
    expect(explicit.cap).toBe("round");
    expect(explicit.join).toBe("bevel");

    const broken = loadEditorPrefs(
      new MemoryStorage({
        [EDITOR_PREFS_KEY]: JSON.stringify({ cap: "bogus", join: 3 }),
      }),
    );
    expect(broken.cap).toBe("butt");
    expect(broken.join).toBe("miter");
  });

  it("remembers the hand tool — it is a rail tool like any other", () => {
    const storage = new MemoryStorage();
    saveEditorPrefs({ ...DEFAULT_EDITOR_PREFS, tool: "hand" }, storage);
    expect(loadEditorPrefs(storage).tool).toBe("hand");
  });

  it("migrates pre-2 prefs (arch tool, bulge) to the new defaults", () => {
    const prefs = loadEditorPrefs(
      new MemoryStorage({
        [EDITOR_PREFS_KEY]: JSON.stringify({ tool: "arch", bulge: 1 }),
      }),
    );
    expect(prefs.tool).toBe(DEFAULT_EDITOR_PREFS.tool);
    expect(prefs.arc).toEqual(DEFAULT_EDITOR_PREFS.arc);
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
        inkSwatches: "red",
      }),
    });
    expect(loadEditorPrefs(storage)).toEqual(DEFAULT_EDITOR_PREFS);
  });

  it("clamps zoom into its range", () => {
    // The ceiling is high enough to draw in: a `base` = 4 cell is ~3 px at
    // zoom 1, so 400 % was not enough (docs/CANVAS.md §6).
    expect(MAX_ZOOM).toBe(32);
    const prefs = loadEditorPrefs(
      new MemoryStorage({
        [EDITOR_PREFS_KEY]: JSON.stringify({ zoom: 99 }),
      }),
    );
    expect(prefs.zoom).toBe(MAX_ZOOM);

    const low = loadEditorPrefs(
      new MemoryStorage({ [EDITOR_PREFS_KEY]: JSON.stringify({ zoom: 0.01 }) }),
    );
    expect(low.zoom).toBe(MIN_ZOOM);
  });

  it("accepts a stored zoom above the old 400 % ceiling", () => {
    // The clamp follows the constants on read — a zoom stored while the top
    // was 4 must not be rounded down to it now the ladder goes to 32.
    const prefs = loadEditorPrefs(
      new MemoryStorage({ [EDITOR_PREFS_KEY]: JSON.stringify({ zoom: 8 }) }),
    );
    expect(prefs.zoom).toBe(8);
    const atTop = loadEditorPrefs(
      new MemoryStorage({ [EDITOR_PREFS_KEY]: JSON.stringify({ zoom: MAX_ZOOM }) }),
    );
    expect(atTop.zoom).toBe(MAX_ZOOM);
  });

  it("defaults the grid guide on and accepts only a boolean", () => {
    expect(DEFAULT_EDITOR_PREFS.showGrid).toBe(true);
    const missing = loadEditorPrefs(
      new MemoryStorage({ [EDITOR_PREFS_KEY]: JSON.stringify({ tool: "pen" }) }),
    );
    expect(missing.showGrid).toBe(true);

    const wrongType = loadEditorPrefs(
      new MemoryStorage({
        [EDITOR_PREFS_KEY]: JSON.stringify({ showGrid: "yes" }),
      }),
    );
    expect(wrongType.showGrid).toBe(true);

    const off = loadEditorPrefs(
      new MemoryStorage({
        [EDITOR_PREFS_KEY]: JSON.stringify({ showGrid: false }),
      }),
    );
    expect(off.showGrid).toBe(false);
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
      // A stored blob written before the sector count existed defaults to 36.
      circularSectors: DEFAULT_PROJECT_CONFIG.circularSectors,
      ink: "#abcdef",
      background: "transparent",
      showGrid: true,
      // The legacy `mergeLines` flag is dropped; the new option defaults on.
      straightLinesAsSquares: true,
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
});
