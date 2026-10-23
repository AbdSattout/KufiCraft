/**
 * Tests for the border paint.
 *
 * A border is **not** a shadow, a filter or a copy: it is one wider stroke of
 * the item's own path, painted before the item. A filled item's stroke is
 * `2 × width` (the fill covers the inner half); a stroked item's is
 * `itemWidth + 2 × width` (its ink covers the inner half). The width is the
 * switch: `0` paints nothing.
 */

import { describe, expect, it } from "vitest";
import {
  BORDER_ALL,
  BORDER_BOTTOM,
  BORDER_LEFT,
  BORDER_RIGHT,
  BORDER_TOP,
  DEFAULT_BORDER_COLOR,
  MAX_BORDER_WIDTH,
} from "@/lib/canvas/model";
import {
  borderBand,
  borderClipRects,
  borderPaint,
  borderSides,
} from "@/lib/canvas/border";

describe("borderPaint", () => {
  it("outlines a filled item with a stroke of width 2 × width", () => {
    expect(borderPaint({ width: 3, color: "#000" }, 0)).toEqual({
      color: "#000",
      width: 6,
    });
    expect(borderPaint({ width: 1, color: "#000" }, 0)).toEqual({
      color: "#000",
      width: 2,
    });
  });

  it("widens a stroked item by one border width on each side", () => {
    // The band must be exactly `width` on each side of the ink, so the
    // stroke grows by 2 × width around the same centre line.
    expect(borderPaint({ width: 3, color: "#000" }, 7)).toEqual({
      color: "#000",
      width: 13,
    });
    expect(borderPaint({ width: 2, color: "#000" }, 7.5)).toEqual({
      color: "#000",
      width: 11.5,
    });
  });

  it("paints nothing when the width is zero, negative or unusable", () => {
    expect(borderPaint({ width: 0, color: "#000" }, 0)).toBeUndefined();
    expect(borderPaint({ width: -2, color: "#000" }, 0)).toBeUndefined();
    expect(
      borderPaint({ width: Number.NaN, color: "#000" }, 0),
    ).toBeUndefined();
  });

  it("clamps an oversized width", () => {
    expect(borderPaint({ width: 999, color: "#000" }, 0)).toEqual({
      color: "#000",
      width: 2 * MAX_BORDER_WIDTH,
    });
    expect(borderPaint({ width: 999, color: "#000" }, 5)).toEqual({
      color: "#000",
      width: 5 + 2 * MAX_BORDER_WIDTH,
    });
  });

  it("uses the stored colour, defaulting to black when it is empty", () => {
    expect(borderPaint({ width: 2, color: "#ff0000" }, 0)?.color).toBe(
      "#ff0000",
    );
    expect(borderPaint({ width: 2, color: "" }, 0)?.color).toBe(
      DEFAULT_BORDER_COLOR,
    );
  });
});

describe("borderSides / borderBand", () => {
  it("reads an absent mask as all four sides", () => {
    expect(borderSides({ width: 2, color: "#000" })).toBe(BORDER_ALL);
    expect(borderSides({ width: 2, color: "#000", sides: BORDER_ALL })).toBe(
      BORDER_ALL,
    );
  });

  it("masks a stored value to the four real sides", () => {
    expect(
      borderSides({ width: 2, color: "#000", sides: BORDER_TOP | 16 }),
    ).toBe(BORDER_TOP);
    expect(
      borderSides({ width: 2, color: "#000", sides: Number.NaN }),
    ).toBe(BORDER_ALL);
  });

  it("returns the visible band only for a positive usable width", () => {
    expect(borderBand({ width: 3, color: "#000" })).toBe(3);
    expect(borderBand({ width: 0, color: "#000" })).toBeUndefined();
    expect(borderBand({ width: -1, color: "#000" })).toBeUndefined();
    expect(borderBand({ width: Number.NaN, color: "#000" })).toBeUndefined();
    expect(borderBand({ width: 99, color: "#000" })).toBe(MAX_BORDER_WIDTH);
  });
});

describe("borderClipRects", () => {
  const bounds = { x: 10, y: 20, w: 100, h: 50 };

  it("keeps only the outside band of each selected side", () => {
    // Band `w`: starts one band outside the box and stops on the box edge, so
    // the inner half of the native `2 × w` stroke is cut away.
    expect(borderClipRects(bounds, BORDER_TOP, 4)).toEqual([
      { x: 6, y: 16, w: 108, h: 4 },
    ]);
    expect(borderClipRects(bounds, BORDER_RIGHT, 4)).toEqual([
      { x: 110, y: 16, w: 4, h: 58 },
    ]);
    expect(borderClipRects(bounds, BORDER_BOTTOM, 4)).toEqual([
      { x: 6, y: 70, w: 108, h: 4 },
    ]);
    expect(borderClipRects(bounds, BORDER_LEFT, 4)).toEqual([
      { x: 6, y: 16, w: 4, h: 58 },
    ]);
  });

  it("returns the selected sides in top, right, bottom, left order", () => {
    expect(
      borderClipRects(bounds, BORDER_TOP | BORDER_LEFT, 2),
    ).toEqual([
      { x: 8, y: 18, w: 104, h: 2 },
      { x: 8, y: 18, w: 2, h: 54 },
    ]);
  });

  it("returns nothing for a whole border or an empty mask", () => {
    expect(borderClipRects(bounds, BORDER_ALL, 4)).toBeUndefined();
    expect(borderClipRects(bounds, 0, 4)).toBeUndefined();
    expect(borderClipRects(bounds, 16, 4)).toBeUndefined();
  });

  it("returns nothing for a zero or broken band", () => {
    expect(borderClipRects(bounds, BORDER_TOP, 0)).toBeUndefined();
    expect(borderClipRects(bounds, BORDER_TOP, -1)).toBeUndefined();
    expect(borderClipRects(bounds, BORDER_TOP, Number.NaN)).toBeUndefined();
  });
});

describe("borderPaint clipping", () => {
  const clip = [{ x: 0, y: 0, w: 10, h: 10 }];

  it("carries a partial tile border's clip rects", () => {
    expect(
      borderPaint({ width: 2, color: "#000", sides: BORDER_TOP }, 0, clip),
    ).toEqual({ color: "#000", width: 4, clip });
  });

  it("attaches the clip the caller computed", () => {
    expect(
      borderPaint({ width: 2, color: "#000", sides: BORDER_TOP }, 0, clip),
    ).toEqual({ color: "#000", width: 4, clip });
    // A whole border reaches the paint with no clip: the item layer only
    // computes one for a tile's partial mask (see borderClipRects).
    expect(borderPaint({ width: 2, color: "#000" }, 0)).toEqual({
      color: "#000",
      width: 4,
    });
    // A stroked item widens by the band on each side and keeps its clip.
    expect(
      borderPaint({ width: 2, color: "#000", sides: BORDER_TOP }, 7, clip),
    ).toEqual({ color: "#000", width: 11, clip });
  });

  it("paints nothing for an empty side mask", () => {
    expect(
      borderPaint({ width: 2, color: "#000", sides: 0 }, 0),
    ).toBeUndefined();
  });
});
