import { describe, expect, it } from "vitest";
import {
  ANCHOR_GRID,
  BORDER_ALL,
  BORDER_LEFT,
  BORDER_TOP,
  CENTRE_ANCHOR,
  CORNER_ALL,
  CORNER_BOTTOM_LEFT,
  CORNER_TOP_LEFT,
  DEFAULT_BORDER_WIDTH,
  DEFAULT_RATIO,
  MAX_BORDER_WIDTH,
  MAX_COLOR_LENGTH,
  MAX_RATIO,
  MAX_ROUNDING_RADIUS,
  MAX_KEY_LENGTH,
  MIN_BORDER_WIDTH,
  MIN_RATIO,
  RATIO_PRESETS,
  anchorOf,
  arcKey,
  arcPoint,
  clampBorderWidth,
  clampRoundingRadius,
  hasAnchor,
  isCentreAnchor,
  itemSignature,
  lineKey,
  linePoint,
  normalizeAnchor,
  normalizeArcAnchor,
  normalizeArcSize,
  ratioLabel,
  repairArcSize,
  sameLinePoint,
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
import { makeStroke } from "@/lib/canvas/items";

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

describe("line points", () => {
  it("offers the nine anchors of the ink region, row-major", () => {
    expect(ANCHOR_GRID).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 0.5 },
      { x: 0, y: 1 },
      { x: 0.5, y: 1 },
      { x: 1, y: 1 },
    ]);
    // The fourth entry is the ink centre — the point the model used before
    // anchors existed.
    expect(ANCHOR_GRID[4]).toEqual(CENTRE_ANCHOR);
  });

  it("normalises the centre away, whichever way it is written", () => {
    const centre = linePoint(2, 3, undefined, { x: 0.5, y: 0.5 });
    expect(centre).toEqual({ column: 2, row: 3 });
    expect(linePoint(2, 3)).toEqual(centre);
    expect(centre).not.toHaveProperty("anchor");
  });

  it("canonicalises the ink zone away and keeps a space zone", () => {
    // Zone 0 is the ink fragment: canonical storage of nothing, so a stored
    // point is byte-identical to the pre-fragment one.
    expect(linePoint(2, 3, 0)).toEqual({ column: 2, row: 3 });
    expect(linePoint(2, 3, 0, CENTRE_ANCHOR)).toEqual({ column: 2, row: 3 });
    // A space fragment keeps its zone; the centre is still dropped.
    expect(linePoint(2, 3, 2)).toEqual({ column: 2, row: 3, zone: 2 });
    expect(linePoint(2, 3, 2, CENTRE_ANCHOR)).toEqual({
      column: 2,
      row: 3,
      zone: 2,
    });
    expect(linePoint(2, 3, 2, { x: 0, y: 1 })).toEqual({
      column: 2,
      row: 3,
      zone: 2,
      anchor: { x: 0, y: 1 },
    });
  });

  it("keys a space fragment distinctly and leaves the ink key untouched", () => {
    // Ink keys are exactly the pre-fragment strings (old documents re-key to
    // themselves); a space end adds `#<zone>` where it appears.
    expect(lineKey({ column: 2, row: 3 }, { column: 4, row: 3 })).toBe(
      "line:2:3>4:3",
    );
    expect(
      lineKey(
        { column: 2, row: 3, zone: 1 },
        { column: 4, row: 3, zone: 1 },
      ),
    ).toBe("line:2:3#1>4:3#1");
    expect(
      arcKey(
        { column: 2, row: 3, zone: 2 },
        { column: 4, row: 3 },
        "clockwise",
        "half",
      ),
    ).toBe("arc:2:3#2>4:3|clockwise|half");
    const inkStroke = [
      { column: 2, row: 3 },
      { column: 4, row: 3 },
    ];
    expect(
      strokeKey(
        [
          { column: 2, row: 3, zone: 0 },
          { column: 4, row: 3 },
        ],
        false,
      ),
    ).toBe(strokeKey(inkStroke, false));
    expect(
      strokeKey(
        [
          { column: 2, row: 3, zone: 3, anchor: { x: 0.5, y: 0 } },
          { column: 4, row: 3 },
        ],
        false,
      ),
    ).not.toBe(strokeKey(inkStroke, false));
  });

  it("compares two points by cell, zone and anchor together", () => {
    // Same cell and anchor, different fragments: two different points.
    expect(sameLinePoint(linePoint(1, 1), linePoint(1, 1, 2))).toBe(false);
    expect(sameLinePoint(linePoint(1, 1, 2), linePoint(1, 1, 2))).toBe(true);
    // An absent zone and zone 0 are the same fragment.
    expect(sameLinePoint(linePoint(1, 1), linePoint(1, 1, 0))).toBe(true);
  });

  it("keeps a non-centre anchor, copying it rather than aliasing it", () => {
    const anchor = { x: 0, y: 1 };
    const point = linePoint(2, 3, undefined, anchor);
    expect(point).toEqual({ column: 2, row: 3, anchor: { x: 0, y: 1 } });
    expect(point.anchor).not.toBe(anchor);
  });

  it("reads a point's anchor, absent meaning the centre", () => {
    const bare = linePoint(1, 1);
    const centred = linePoint(1, 1, undefined, { x: 0.5, y: 0.5 });
    const corner = linePoint(1, 1, undefined, { x: 1, y: 0 });
    expect(anchorOf(bare)).toEqual(CENTRE_ANCHOR);
    expect(hasAnchor(bare)).toBe(false);
    expect(hasAnchor(centred)).toBe(false);
    expect(anchorOf(centred)).toEqual(CENTRE_ANCHOR);
    expect(hasAnchor(corner)).toBe(true);
    expect(isCentreAnchor(anchorOf(corner))).toBe(false);
  });

  it("compares two points by cell and anchor together", () => {
    const corner = linePoint(1, 1, undefined, { x: 0, y: 0 });
    expect(sameLinePoint(corner, linePoint(1, 1, undefined, { x: 0, y: 0 }))).toBe(true);
    // The same cell, written with an explicit centre, is still the centre.
    expect(sameLinePoint(linePoint(1, 1), linePoint(1, 1, undefined, CENTRE_ANCHOR))).toBe(true);
    expect(sameLinePoint(corner, linePoint(1, 1, undefined, { x: 1, y: 0 }))).toBe(false);
    expect(sameLinePoint(corner, linePoint(1, 2, undefined, { x: 0, y: 0 }))).toBe(false);
  });

  it("repairs a stored anchor: clamps it, drops what is not a point", () => {
    expect(normalizeAnchor({ x: 0, y: 0.5 })).toEqual({ x: 0, y: 0.5 });
    expect(normalizeAnchor({ x: 4, y: -2 })).toEqual({ x: 1, y: 0 });
    // The centre is canonical storage of nothing.
    expect(normalizeAnchor({ x: 0.5, y: 0.5 })).toBeUndefined();
    // Anything that is not two finite numbers is not an anchor.
    expect(normalizeAnchor(undefined)).toBeUndefined();
    expect(normalizeAnchor(4)).toBeUndefined();
    expect(normalizeAnchor({ x: 0 })).toBeUndefined();
    expect(normalizeAnchor({ x: Number.NaN, y: 0 })).toBeUndefined();
    expect(normalizeAnchor({ x: Number.POSITIVE_INFINITY, y: 0 })).toBeUndefined();
  });

  it("keys an anchor-less stroke exactly as the pre-anchor model did", () => {
    const points = [
      { column: 0, row: 0 },
      { column: 1, row: 1 },
    ];
    // The centre is dropped on construction, so a stroke built from an
    // explicit-centre list keys exactly like the old one: files and documents
    // round-trip without their keys moving.
    const throughCentre = points.map((cell) =>
      linePoint(cell.column, cell.row, undefined, CENTRE_ANCHOR),
    );
    expect(strokeKey(throughCentre, false)).toBe(strokeKey(points, false));
    expect(strokeKey(points, true)).not.toBe(strokeKey(points, false));
  });

  it("gives a different key to the same cells with different anchors", () => {
    const bare = [
      { column: 0, row: 0 },
      { column: 1, row: 1 },
    ];
    const corner = [
      linePoint(0, 0, undefined, { x: 0, y: 0 }),
      linePoint(1, 1, undefined, { x: 0, y: 0 }),
    ];
    const edge = [
      linePoint(0, 0, undefined, { x: 0.5, y: 0 }),
      linePoint(1, 1, undefined, { x: 0, y: 0 }),
    ];
    expect(new Set([strokeKey(bare, false), strokeKey(corner, false), strokeKey(edge, false)]).size).toBe(3);
  });

  it("tells anchored strokes apart in the item signature too", () => {
    const points = [
      linePoint(0, 0),
      linePoint(1, 1),
    ];
    const bare = makeStroke(points, false);
    const corner = makeStroke(
      [linePoint(0, 0, undefined, { x: 0, y: 0 }), linePoint(1, 1, undefined, { x: 0, y: 0 })],
      false,
    );
    expect(itemSignature(bare)).toBe(
      itemSignature({ ...bare, points: [...points] }),
    );
    expect(itemSignature(corner)).not.toBe(itemSignature(bare));
  });
});

describe("arc points", () => {
  it("keeps the centre — an arc endpoint's absent anchor is the spring point", () => {
    expect(arcPoint(1, 1, undefined, CENTRE_ANCHOR)).toEqual({
      column: 1,
      row: 1,
      anchor: { x: 0.5, y: 0.5 },
    });
    // Absent stays absent: it is not the centre here.
    expect(arcPoint(1, 1)).toEqual({ column: 1, row: 1 });
    // A space endpoint carries its fragment and its anchor together.
    expect(arcPoint(2, 3, 2, CENTRE_ANCHOR)).toEqual({
      column: 2,
      row: 3,
      zone: 2,
      anchor: { x: 0.5, y: 0.5 },
    });
    const anchor = { x: 0, y: 1 };
    const point = arcPoint(1, 1, undefined, anchor);
    expect(point.anchor).toEqual(anchor);
    expect(point.anchor).not.toBe(anchor); // copied, never aliased
  });

  it("reads a stored arc anchor, the centre surviving and damage falling back", () => {
    expect(normalizeArcAnchor({ x: 0.5, y: 0.5 })).toEqual(CENTRE_ANCHOR);
    expect(normalizeArcAnchor({ x: 4, y: -2 })).toEqual({ x: 1, y: 0 });
    expect(normalizeArcAnchor({ x: 0, y: 1 })).toEqual({ x: 0, y: 1 });
    expect(normalizeArcAnchor(undefined)).toBeUndefined();
    expect(normalizeArcAnchor(null)).toBeUndefined();
    expect(normalizeArcAnchor(4)).toBeUndefined();
    expect(normalizeArcAnchor({ x: 0 })).toBeUndefined();
    expect(normalizeArcAnchor({ x: Number.NaN, y: 0 })).toBeUndefined();
    expect(normalizeArcAnchor({ x: Number.POSITIVE_INFINITY, y: 0 })).toBeUndefined();
  });

  it("keys an arc by its anchors, anchor-less keys unchanged", () => {
    const from = { column: 0, row: 6 };
    const to = { column: 4, row: 6 };
    // A legacy arc (no anchors) keeps the pre-anchor key byte for byte.
    expect(arcKey(from, to, "clockwise", "half")).toBe(
      "arc:0:6>4:6|clockwise|half",
    );
    const centred = arcKey(
      { ...from, anchor: CENTRE_ANCHOR },
      { ...to, anchor: CENTRE_ANCHOR },
      "clockwise",
      "half",
    );
    expect(centred).not.toBe(arcKey(from, to, "clockwise", "half"));
    expect(centred.startsWith("arc:0:6>4:6|clockwise|half|")).toBe(true);
    // Different anchors on the same cells are different arcs.
    const corners = arcKey(
      { ...from, anchor: { x: 0, y: 0 } },
      { ...to, anchor: { x: 1, y: 1 } },
      "clockwise",
      "half",
    );
    expect(corners).not.toBe(centred);
    // Canonical in the cells, the anchors travelling with them.
    expect(
      arcKey(
        { ...to, anchor: { x: 1, y: 1 } },
        { ...from, anchor: { x: 0, y: 0 } },
        "clockwise",
        "half",
      ),
    ).toBe(corners);
  });

  it("keeps an anchored arc's key inside MAX_KEY_LENGTH whatever it carries", () => {
    const far = {
      column: 250,
      row: 250,
      anchor: { x: 0.123456789012345, y: 0.987654321098765 },
    };
    expect(
      arcKey(
        far,
        { column: 249, row: 250, anchor: { x: 1, y: 0 } },
        "counterclockwise",
        "threeQuarter",
      ).length,
    ).toBeLessThanOrEqual(MAX_KEY_LENGTH);
  });

  it("repairs a legacy diagonal half to the quarter that draws the same arc", () => {
    const from = { column: 0, row: 6 };
    const to = { column: 4, row: 10 };
    expect(repairArcSize(from, to, "half")).toBe("quarter");
    // One anchor is enough to select the uniform chord maths: a half is a half.
    expect(repairArcSize({ ...from, anchor: CENTRE_ANCHOR }, to, "half")).toBe(
      "half",
    );
    expect(
      repairArcSize(
        { ...from, anchor: CENTRE_ANCHOR },
        { ...to, anchor: { x: 1, y: 1 } },
        "half",
      ),
    ).toBe("half");
    // Row and column chords are already true halves.
    expect(repairArcSize(from, { column: 4, row: 6 }, "half")).toBe("half");
    expect(repairArcSize(from, { column: 0, row: 10 }, "half")).toBe("half");
    expect(repairArcSize(from, to, "quarter")).toBe("quarter");
    expect(repairArcSize(from, to, "threeQuarter")).toBe("threeQuarter");
  });

  it("reads a stored arc size, anything unrecognised meaning half", () => {
    expect(normalizeArcSize("quarter")).toBe("quarter");
    expect(normalizeArcSize("half")).toBe("half");
    expect(normalizeArcSize("threeQuarter")).toBe("threeQuarter");
    expect(normalizeArcSize(undefined)).toBe("half");
    expect(normalizeArcSize("270")).toBe("half");
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

  it("tells a space-fragment end from the ink one", () => {
    expect(
      itemSignature({ ...line, to: { column: 3, row: 1, zone: 2 } }),
    ).not.toBe(itemSignature(line));
    expect(
      itemSignature({ ...arc, to: { column: 3, row: 0, zone: 1 } }),
    ).not.toBe(itemSignature(arc));
    expect(
      itemSignature({
        ...stroke,
        points: [{ column: 0, row: 0 }, { column: 1, row: 1, zone: 3 }],
      }),
    ).not.toBe(itemSignature(stroke));
  });

  it("gives an arc's anchors their own signature slot", () => {
    const from = { column: 0, row: 0, anchor: CENTRE_ANCHOR };
    const to = { column: 3, row: 0, anchor: CENTRE_ANCHOR };
    const centred: ArcItem = {
      type: "arc",
      key: arcKey(from, to, "clockwise", "half"),
      from,
      to,
      direction: "clockwise",
      size: "half",
    };
    expect(itemSignature(centred)).not.toBe(itemSignature(arc));
    // Same cells, same controls, different anchor: still different items.
    const cornered: ArcItem = { ...centred, to: { ...to, anchor: { x: 1, y: 4 } } };
    expect(itemSignature(cornered)).not.toBe(itemSignature(centred));
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
