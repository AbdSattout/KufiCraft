/**
 * Tests for outside borders.
 *
 * A border must sit **outside** the item's box: the inner edge of the stroke
 * lies on the box and no part of it reaches inside. The tests therefore check
 * the centre-line geometry (`box ± width / 2`) and the joined-corner geometry
 * (`box ± width`), and never just "a stroke exists".
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
import type { Rect } from "@/lib/canvas/geometry";
import { borderOutline, borderPath } from "@/lib/canvas/border";

const RECT: Rect = { x: 10, y: 20, w: 30, h: 40 };

describe("borderPath", () => {
  it("puts a lone side's centre line half a stroke outside the box", () => {
    // width 2 → the stroke covers exactly [box - 2, box], so the inner edge is
    // the box outline itself.
    expect(borderPath(RECT, BORDER_TOP, 2)).toBe("M 10 19 L 40 19");
    expect(borderPath(RECT, BORDER_RIGHT, 2)).toBe("M 41 20 L 41 60");
    expect(borderPath(RECT, BORDER_BOTTOM, 2)).toBe("M 10 61 L 40 61");
    expect(borderPath(RECT, BORDER_LEFT, 2)).toBe("M 9 20 L 9 60");
  });

  it("joins enabled neighbours into an exact square outer corner", () => {
    // All four sides, width 2: each bar reaches a full width past the box
    // corner, so the outer corner is (box - 2 … box + width).
    expect(borderPath(RECT, BORDER_ALL, 2)).toBe(
      "M 8 19 L 42 19" +
        " M 41 18 L 41 62" +
        " M 8 61 L 42 61" +
        " M 9 18 L 9 62",
    );
  });

  it("stops a side on the box corner when its neighbour is off", () => {
    // Top + right: the top bar ends at the right bar's outer edge, the right bar
    // starts at the top bar's outer edge; no overshoot in either direction.
    expect(borderPath(RECT, BORDER_TOP | BORDER_RIGHT, 2)).toBe(
      "M 10 19 L 42 19 M 41 18 L 41 60",
    );
  });

  it("scales both the offset and the corner extension with the width", () => {
    for (const width of [1, 2, 4, MAX_BORDER_WIDTH]) {
      const expected =
        `M ${RECT.x - width} ${RECT.y - width / 2}` +
        ` L ${RECT.x + RECT.w + width} ${RECT.y - width / 2}` +
        ` M ${RECT.x + RECT.w + width / 2} ${RECT.y - width}` +
        ` L ${RECT.x + RECT.w + width / 2} ${RECT.y + RECT.h + width}` +
        ` M ${RECT.x - width} ${RECT.y + RECT.h + width / 2}` +
        ` L ${RECT.x + RECT.w + width} ${RECT.y + RECT.h + width / 2}` +
        ` M ${RECT.x - width / 2} ${RECT.y - width}` +
        ` L ${RECT.x - width / 2} ${RECT.y + RECT.h + width}`;
      expect(borderPath(RECT, BORDER_ALL, width)).toBe(expected);
    }
  });

  it("returns an empty path when no side is on", () => {
    expect(borderPath(RECT, 0, 2)).toBe("");
  });
});

describe("borderOutline", () => {
  it("resolves the colour from the item, unless the border overrides it", () => {
    expect(
      borderOutline(RECT, { sides: BORDER_TOP, width: 2 }, "#123456"),
    ).toEqual({
      path: "M 10 19 L 40 19",
      width: 2,
      color: "#123456",
    });
    expect(
      borderOutline(
        RECT,
        { sides: BORDER_TOP, width: 2, color: "#ff0000" },
        "#123456",
      )?.color,
    ).toBe("#ff0000");
    // An empty override is not a colour: fall back to the item's own.
    expect(
      borderOutline(
        RECT,
        { sides: BORDER_TOP, width: 2, color: "" },
        "#123456",
      )?.color,
    ).toBe("#123456");
  });

  it("drops a border that paints nothing", () => {
    expect(borderOutline(RECT, { sides: 0, width: 2 }, "#000")).toBeUndefined();
    expect(
      borderOutline(RECT, { sides: Number.NaN, width: 2 }, "#000"),
    ).toBeUndefined();
    expect(
      borderOutline(RECT, { sides: BORDER_TOP, width: 0 }, "#000"),
    ).toBeUndefined();
    expect(
      borderOutline(RECT, { sides: BORDER_TOP, width: -2 }, "#000"),
    ).toBeUndefined();
    expect(
      borderOutline(RECT, { sides: BORDER_TOP, width: Number.NaN }, "#000"),
    ).toBeUndefined();
  });

  it("masks unknown side bits and clamps an oversized width", () => {
    const plain = borderOutline(RECT, { sides: BORDER_ALL, width: 2 }, "#000");
    const noisy = borderOutline(
      RECT,
      { sides: BORDER_ALL | 16, width: 2 },
      "#000",
    );
    expect(noisy).toEqual(plain);

    const wide = borderOutline(
      RECT,
      { sides: BORDER_TOP, width: 999 },
      "#000",
    );
    expect(wide?.width).toBe(MAX_BORDER_WIDTH);
    expect(wide?.path).toBe(borderPath(RECT, BORDER_TOP, MAX_BORDER_WIDTH));
  });
});
