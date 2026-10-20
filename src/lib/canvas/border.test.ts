/**
 * Tests for the border paint.
 *
 * A border is **not** a shadow, a filter or a copy: it is one wider stroke of
 * the item's own path, painted before the item. A filled item's stroke is
 * `2 × width` (the fill covers the inner half); a stroked item's is
 * `itemWidth + 2 × width` (its ink covers the inner half). The legacy `sides`
 * mask only says on/off — any non-zero mask paints all around.
 */

import { describe, expect, it } from "vitest";
import {
  BORDER_ALL,
  BORDER_BOTTOM,
  BORDER_LEFT,
  BORDER_RIGHT,
  BORDER_TOP,
  MAX_BORDER_WIDTH,
} from "@/lib/canvas/model";
import { borderPaint } from "@/lib/canvas/border";

describe("borderPaint", () => {
  it("outlines a filled item with a stroke of width 2 × width", () => {
    expect(borderPaint({ sides: BORDER_ALL, width: 3 }, "#000", 0)).toEqual({
      color: "#000",
      width: 6,
    });
    expect(borderPaint({ sides: BORDER_ALL, width: 1 }, "#000", 0)).toEqual({
      color: "#000",
      width: 2,
    });
  });

  it("widens a stroked item by one border width on each side", () => {
    // The band must be exactly `width` on each side of the ink, so the
    // stroke grows by 2 × width around the same centre line.
    expect(borderPaint({ sides: BORDER_ALL, width: 3 }, "#000", 7)).toEqual({
      color: "#000",
      width: 13,
    });
    expect(borderPaint({ sides: BORDER_ALL, width: 2 }, "#000", 7.5)).toEqual({
      color: "#000",
      width: 11.5,
    });
  });

  it("treats every non-zero legacy mask as an all-around border", () => {
    const masks = [
      BORDER_TOP,
      BORDER_RIGHT,
      BORDER_BOTTOM,
      BORDER_LEFT,
      BORDER_TOP | BORDER_LEFT,
      BORDER_ALL,
    ];
    for (const sides of masks) {
      expect(borderPaint({ sides, width: 2 }, "#000", 0)).toEqual({
        color: "#000",
        width: 4,
      });
    }
  });

  it("paints nothing when the mask is off or the width is unusable", () => {
    expect(borderPaint({ sides: 0, width: 2 }, "#000", 0)).toBeUndefined();
    expect(
      borderPaint({ sides: Number.NaN, width: 2 }, "#000", 0),
    ).toBeUndefined();
    expect(borderPaint({ sides: BORDER_ALL, width: 0 }, "#000", 0)).toBeUndefined();
    expect(
      borderPaint({ sides: BORDER_ALL, width: -2 }, "#000", 0),
    ).toBeUndefined();
    expect(
      borderPaint({ sides: BORDER_ALL, width: Number.NaN }, "#000", 0),
    ).toBeUndefined();
  });

  it("keeps unknown bits from turning into a border", () => {
    expect(borderPaint({ sides: 16, width: 2 }, "#000", 0)).toBeUndefined();
    expect(borderPaint({ sides: BORDER_ALL | 16, width: 2 }, "#000", 0)).toEqual({
      color: "#000",
      width: 4,
    });
  });

  it("clamps an oversized width", () => {
    expect(borderPaint({ sides: BORDER_ALL, width: 999 }, "#000", 0)).toEqual({
      color: "#000",
      width: 2 * MAX_BORDER_WIDTH,
    });
    expect(borderPaint({ sides: BORDER_ALL, width: 999 }, "#000", 5)).toEqual({
      color: "#000",
      width: 5 + 2 * MAX_BORDER_WIDTH,
    });
  });

  it("resolves the colour from the item, unless the border overrides it", () => {
    expect(borderPaint({ sides: BORDER_ALL, width: 2 }, "#123456", 0)?.color).toBe(
      "#123456",
    );
    expect(
      borderPaint(
        { sides: BORDER_ALL, width: 2, color: "#ff0000" },
        "#123456",
        0,
      )?.color,
    ).toBe("#ff0000");
    // An empty override is not a colour: fall back to the item's own.
    expect(
      borderPaint({ sides: BORDER_ALL, width: 2, color: "" }, "#123456", 0)
        ?.color,
    ).toBe("#123456");
  });
});
