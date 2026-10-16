import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATIO,
  MAX_RATIO,
  MIN_RATIO,
  RATIO_PRESETS,
  ratioLabel,
  snapRatio,
} from "@/lib/canvas/model";

const LAST = RATIO_PRESETS[RATIO_PRESETS.length - 1];

describe("the ratio axis", () => {
  it("is the five ratios kufi is drawn in, written space:ink", () => {
    expect(RATIO_PRESETS.map((preset) => preset.label)).toEqual([
      "1:1",
      "1:2",
      "1:3",
      "1:4",
      "1:5",
    ]);
    expect(RATIO_PRESETS.map((preset) => preset.ink / preset.space)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("never lets ink be the smaller part", () => {
    for (const preset of RATIO_PRESETS) {
      expect(preset.ink).toBeGreaterThanOrEqual(preset.space);
      expect(preset.ratio).toBeGreaterThanOrEqual(1 / 2);
      expect(preset.ratio).toBeLessThan(1);
      // The fraction is exactly `ink / (space + ink)` — ink plus space.
      expect(preset.ratio).toBeCloseTo(
        preset.ink / (preset.space + preset.ink),
        12,
      );
    }
  });

  it("rises with the ink parts, in the order designers read it", () => {
    for (let index = 1; index < RATIO_PRESETS.length; index += 1) {
      expect(RATIO_PRESETS[index].ratio).toBeGreaterThan(
        RATIO_PRESETS[index - 1].ratio,
      );
    }
  });

  it("bounds the scale at its ends, defaulting to 1:3", () => {
    expect(MIN_RATIO).toBe(RATIO_PRESETS[0].ratio);
    expect(MAX_RATIO).toBe(LAST.ratio);
    expect(DEFAULT_RATIO).toBe(3 / 4);
    expect(RATIO_PRESETS.some((preset) => preset.ratio === DEFAULT_RATIO)).toBe(
      true,
    );
  });
});

describe("snapRatio", () => {
  it("keeps every preset exactly as it is", () => {
    for (const preset of RATIO_PRESETS) {
      expect(snapRatio(preset.ratio)).toBe(preset.ratio);
    }
  });

  it("moves a value between two presets to the nearer one", () => {
    // 0.6 is 0.1 from 1:1 and 0.066… from 1:2.
    expect(snapRatio(0.6)).toBe(2 / 3);
    expect(snapRatio(0.52)).toBe(1 / 2);
    expect(snapRatio(0.79)).toBe(4 / 5);
  });

  it("resolves a value exactly between two presets to the lower one", () => {
    const middle = (RATIO_PRESETS[0].ratio + RATIO_PRESETS[1].ratio) / 2;
    expect(snapRatio(middle)).toBe(RATIO_PRESETS[0].ratio);
  });

  it("sends values beyond the scale to its nearest end", () => {
    expect(snapRatio(0)).toBe(MIN_RATIO);
    expect(snapRatio(-4)).toBe(MIN_RATIO);
    expect(snapRatio(9)).toBe(MAX_RATIO);
    expect(snapRatio(1)).toBe(MAX_RATIO);
  });

  it("falls back to the default for a non-finite value", () => {
    // Nothing directional is stored for NaN; a file that carries it is
    // rewritten in the tool's own ratio rather than in a made-up one.
    expect(snapRatio(Number.NaN)).toBe(DEFAULT_RATIO);
    expect(snapRatio(Number.POSITIVE_INFINITY)).toBe(DEFAULT_RATIO);
    expect(snapRatio(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_RATIO);
  });
});

describe("ratioLabel", () => {
  it("names every preset the way a designer writes it", () => {
    expect(ratioLabel(1 / 2)).toBe("1:1");
    expect(ratioLabel(3 / 4)).toBe("1:3");
    expect(ratioLabel(LAST.ratio)).toBe("1:5");
  });

  it("names the preset a stray value snaps to", () => {
    expect(ratioLabel(0.79)).toBe("1:4");
    expect(ratioLabel(0)).toBe("1:1");
    expect(ratioLabel(Number.NaN)).toBe("1:3");
  });
});
