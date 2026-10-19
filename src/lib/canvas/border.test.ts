/**
 * Tests for the border duplicates.
 *
 * A border is not a shadow or a filter: every enabled side is one translated
 * copy of the item's own shape, painted behind it. The tests therefore check
 * the count (one copy per side), the exact translation (by the border width)
 * and the resolved colour.
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
import { borderCopies } from "@/lib/canvas/border";

describe("borderCopies", () => {
  it("makes one copy per side, translated by the border width", () => {
    expect(borderCopies({ sides: BORDER_TOP, width: 2 }, "#000")).toEqual([
      { dx: 0, dy: -2, color: "#000" },
    ]);
    expect(borderCopies({ sides: BORDER_RIGHT, width: 3 }, "#000")).toEqual([
      { dx: 3, dy: 0, color: "#000" },
    ]);
    expect(borderCopies({ sides: BORDER_BOTTOM, width: 4 }, "#000")).toEqual([
      { dx: 0, dy: 4, color: "#000" },
    ]);
    expect(borderCopies({ sides: BORDER_LEFT, width: 5 }, "#000")).toEqual([
      { dx: -5, dy: 0, color: "#000" },
    ]);
  });

  it("uses four copies for four sides — never a combined outline", () => {
    expect(borderCopies({ sides: BORDER_ALL, width: 2 }, "#000")).toEqual([
      { dx: 0, dy: -2, color: "#000" },
      { dx: 2, dy: 0, color: "#000" },
      { dx: 0, dy: 2, color: "#000" },
      { dx: -2, dy: 0, color: "#000" },
    ]);
    expect(
      borderCopies({ sides: BORDER_TOP | BORDER_LEFT, width: 3 }, "#000"),
    ).toEqual([
      { dx: 0, dy: -3, color: "#000" },
      { dx: -3, dy: 0, color: "#000" },
    ]);
  });

  it("resolves the colour from the item, unless the border overrides it", () => {
    expect(
      borderCopies({ sides: BORDER_TOP, width: 2 }, "#123456"),
    ).toEqual([{ dx: 0, dy: -2, color: "#123456" }]);
    expect(
      borderCopies(
        { sides: BORDER_TOP, width: 2, color: "#ff0000" },
        "#123456",
      )[0].color,
    ).toBe("#ff0000");
    // An empty override is not a colour: fall back to the item's own.
    expect(
      borderCopies(
        { sides: BORDER_TOP, width: 2, color: "" },
        "#123456",
      )[0].color,
    ).toBe("#123456");
  });

  it("makes no copy when there is no side or no width", () => {
    expect(borderCopies({ sides: 0, width: 2 }, "#000")).toEqual([]);
    expect(borderCopies({ sides: Number.NaN, width: 2 }, "#000")).toEqual([]);
    expect(borderCopies({ sides: BORDER_TOP, width: 0 }, "#000")).toEqual([]);
    expect(borderCopies({ sides: BORDER_TOP, width: -2 }, "#000")).toEqual([]);
    expect(
      borderCopies({ sides: BORDER_TOP, width: Number.NaN }, "#000"),
    ).toEqual([]);
  });

  it("masks unknown side bits and clamps an oversized width", () => {
    const plain = borderCopies({ sides: BORDER_ALL, width: 2 }, "#000");
    const noisy = borderCopies({ sides: BORDER_ALL | 16, width: 2 }, "#000");
    expect(noisy).toEqual(plain);
    expect(
      borderCopies({ sides: BORDER_TOP, width: 999 }, "#000")[0].dy,
    ).toBe(-MAX_BORDER_WIDTH);
  });
});
