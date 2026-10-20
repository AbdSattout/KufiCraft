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
import { DEFAULT_BORDER_COLOR, MAX_BORDER_WIDTH } from "@/lib/canvas/model";
import { borderPaint } from "@/lib/canvas/border";

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
