import { describe, expect, it } from "vitest";
import {
  BORDER_ALL,
  BORDER_LEFT,
  BORDER_TOP,
  CORNER_ALL,
  CORNER_BOTTOM_LEFT,
  CORNER_TOP_LEFT,
  DEFAULT_BORDER_WIDTH,
  DEFAULT_RATIO,
  MAX_BORDER_WIDTH,
  MAX_COLOR_LENGTH,
  MAX_RATIO,
  MAX_ROUNDING_RADIUS,
  MIN_BORDER_WIDTH,
  MIN_RATIO,
  RATIO_PRESETS,
  arcKey,
  clampBorderWidth,
  clampRoundingRadius,
  itemSignature,
  lineKey,
  ratioLabel,
  sanitizeBorder,
  sanitizeRounding,
  snapRatio,
  strokeKey,
  tileKey,
} from "@/lib/canvas/model";
import type {
  ArcItem,
  LineItem,
  StrokeItem,
  TileItem,
} from "@/lib/canvas/model";

const LAST = RATIO_PRESETS[RATIO_PRESETS.length - 1];
/** The equal cell: half ink beside half space — the lightest preset. */
const EQUAL = RATIO_PRESETS[0];

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

  it("opens with the equal 1:1 cell — half ink beside half space", () => {
    expect(EQUAL.label).toBe("1:1");
    expect(EQUAL.space).toBe(1);
    expect(EQUAL.ink).toBe(1);
    expect(EQUAL.ratio).toBe(1 / 2);
  });

  it("keeps ink the larger part and the space real — no space-less preset", () => {
    for (const preset of RATIO_PRESETS) {
      expect(preset.ink).toBeGreaterThanOrEqual(preset.space);
      expect(preset.space).toBeGreaterThan(0);
      expect(preset.ratio).toBeGreaterThanOrEqual(1 / 2);
      expect(preset.ratio).toBeLessThan(1);
      // The fraction is exactly `ink / (space + ink)` — ink plus space.
      expect(preset.ratio).toBeCloseTo(
        preset.ink / (preset.space + preset.ink),
        12,
      );
    }
  });

  it("fattens towards the end of the scale, in the order designers read it", () => {
    for (let index = 1; index < RATIO_PRESETS.length; index += 1) {
      expect(RATIO_PRESETS[index].ratio).toBeGreaterThan(
        RATIO_PRESETS[index - 1].ratio,
      );
    }
    // The equal 1:1 is the lightest cell of the whole scale.
    expect(EQUAL.ratio).toBeLessThan(RATIO_PRESETS[1].ratio);
  });

  it("bounds the scale at its ends, defaulting to 1:3", () => {
    expect(MIN_RATIO).toBe(EQUAL.ratio);
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
    // 0.52 is 0.02 from the equal 1:1 and 0.14… from 1:2.
    expect(snapRatio(0.52)).toBe(1 / 2);
    expect(snapRatio(0.79)).toBe(4 / 5);
    expect(snapRatio(0.97)).toBe(5 / 6);
  });

  it("resolves a value exactly between two presets to the earlier entry", () => {
    const middle = (RATIO_PRESETS[1].ratio + RATIO_PRESETS[2].ratio) / 2;
    expect(snapRatio(middle)).toBe(RATIO_PRESETS[1].ratio);
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

describe("rounding / border model", () => {
  it("names corners and sides physically, with a full mask of 15", () => {
    expect(CORNER_ALL).toBe(15);
    expect(BORDER_ALL).toBe(15);
    expect(CORNER_TOP_LEFT).toBe(1);
    expect(CORNER_BOTTOM_LEFT).toBe(8);
    expect(BORDER_TOP).toBe(1);
    expect(BORDER_LEFT).toBe(8);
    expect(MAX_ROUNDING_RADIUS).toBe(0.5);
  });

  it("clamps a radius to [0, half the shorter side] and drops zero", () => {
    expect(clampRoundingRadius(-1)).toBe(0);
    expect(clampRoundingRadius(0.9)).toBe(MAX_ROUNDING_RADIUS);
    expect(clampRoundingRadius(Number.NaN)).toBe(0);
    expect(
      sanitizeRounding({ radius: 0, corners: CORNER_ALL }),
    ).toBeUndefined();
    expect(
      sanitizeRounding({ radius: -2, corners: CORNER_ALL }),
    ).toBeUndefined();
    expect(
      sanitizeRounding({ radius: 0.25, corners: CORNER_ALL | 16 }),
    ).toEqual({ radius: 0.25, corners: CORNER_ALL });
  });

  it("clamps a border and drops the empty state", () => {
    expect(clampBorderWidth(0)).toBe(MIN_BORDER_WIDTH);
    expect(clampBorderWidth(99)).toBe(MAX_BORDER_WIDTH);
    expect(clampBorderWidth(Number.NaN)).toBe(DEFAULT_BORDER_WIDTH);
    expect(sanitizeBorder({ sides: 0, width: 2 })).toBeUndefined();
    expect(
      sanitizeBorder({ sides: BORDER_TOP | 16, width: 0, color: "" }),
    ).toEqual({ sides: BORDER_TOP, width: MIN_BORDER_WIDTH });
    expect(
      sanitizeBorder({ sides: BORDER_ALL, width: 2, color: "#ff0000" }),
    ).toEqual({ sides: BORDER_ALL, width: 2, color: "#ff0000" });

    const long = `#${"a".repeat(MAX_COLOR_LENGTH)}`;
    expect(
      sanitizeBorder({ sides: BORDER_TOP, width: 2, color: long })?.color,
    ).toBe(long.slice(0, MAX_COLOR_LENGTH));
  });
});

describe("itemSignature", () => {
  const tile: TileItem = {
    type: "tile",
    key: tileKey(1, 2, 0),
    column: 1,
    row: 2,
    zone: 0,
    shape: "circle",
    rotation: 2,
    color: "#ff0000",
  };
  const line: LineItem = {
    type: "line",
    key: lineKey({ column: 0, row: 1 }, { column: 3, row: 1 }),
    from: { column: 0, row: 1 },
    to: { column: 3, row: 1 },
  };
  const stroke: StrokeItem = {
    type: "stroke",
    key: strokeKey(
      [
        { column: 0, row: 0 },
        { column: 1, row: 1 },
      ],
      false,
    ),
    points: [
      { column: 0, row: 0 },
      { column: 1, row: 1 },
    ],
  };
  const arc: ArcItem = {
    type: "arc",
    key: arcKey({ column: 0, row: 0 }, { column: 3, row: 0 }, "clockwise", "half"),
    from: { column: 0, row: 0 },
    to: { column: 3, row: 0 },
    direction: "clockwise",
    size: "half",
  };

  it("is stable for the spelled-out field names", () => {
    expect(itemSignature(tile)).toBe(itemSignature({ ...tile }));
    expect(itemSignature(tile)).toContain("1|2|0|circle|2|#ff0000");
  });

  it("reads absent optional fields as their defaults", () => {
    const bare: TileItem = {
      type: "tile",
      key: tileKey(0, 0, 0),
      column: 0,
      row: 0,
      zone: 0,
    };
    const explicit: TileItem = { ...bare, shape: "square", rotation: 0 };
    expect(itemSignature(bare)).toBe(itemSignature(explicit));
  });

  it("gives rounding and borders their own signature slot", () => {
    const rounded: TileItem = {
      ...tile,
      rounding: { radius: 0.2, corners: CORNER_ALL },
    };
    const bordered: TileItem = {
      ...tile,
      border: { sides: BORDER_TOP, width: 2 },
    };
    expect(itemSignature(rounded)).not.toBe(itemSignature(tile));
    expect(itemSignature(bordered)).not.toBe(itemSignature(tile));
    expect(
      itemSignature({
        ...rounded,
        rounding: { ...rounded.rounding!, corners: CORNER_BOTTOM_LEFT },
      }),
    ).not.toBe(itemSignature(rounded));
    // A line's border is part of its signature too.
    expect(
      itemSignature({ ...line, border: { sides: BORDER_TOP, width: 2 } }),
    ).not.toBe(itemSignature(line));
  });

  it("distinguishes every item type and is deterministic", () => {
    const items: (TileItem | LineItem | StrokeItem | ArcItem)[] = [
      tile,
      line,
      stroke,
      arc,
    ];
    expect(new Set(items.map(itemSignature)).size).toBe(items.length);
    for (const item of items) {
      expect(itemSignature(item)).toBe(itemSignature(item));
    }
  });
});
