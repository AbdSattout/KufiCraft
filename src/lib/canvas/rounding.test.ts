/**
 * Tests for corner rounding.
 *
 * The contract is geometric, so the assertions are too: a rounded corner must
 * be a cubic whose controls sit halfway between the trimmed endpoints and the
 * corner, a mask must select exactly the physical corners it names (also on a
 * rotated non-square shape, while the square stays unrotated), and the trim
 * must never exceed half an edge.
 */

import { describe, expect, it } from "vitest";
import {
  CORNER_ALL,
  CORNER_BOTTOM_LEFT,
  CORNER_BOTTOM_RIGHT,
  CORNER_TOP_LEFT,
  CORNER_TOP_RIGHT,
  MAX_ROUNDING_RADIUS,
} from "@/lib/canvas/model";
import type { PathCmd, Point, Rect } from "@/lib/canvas/geometry";
import {
  C,
  L,
  M,
  Z,
  baseFrame,
  cmdsToPath,
  composeFrames,
  mapCommands,
  quarterTurnFrame,
  rectPath,
} from "@/lib/canvas/geometry";
import {
  roundCorners,
  roundingRadius,
  rotateCornerMask,
} from "@/lib/canvas/rounding";
import { shapeById } from "@/lib/canvas/shapes";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** One curve together with the point its subpath had reached before it. */
interface Curve {
  start: Point;
  end: Point;
  cmd: Extract<PathCmd, { c: "C" }>;
}

function curves(cmds: readonly PathCmd[]): Curve[] {
  const found: Curve[] = [];
  let point: Point = { x: 0, y: 0 };
  for (const cmd of cmds) {
    if (cmd.c === "C") {
      found.push({
        start: { ...point },
        end: { x: cmd.x, y: cmd.y },
        cmd,
      });
    }
    if (cmd.c !== "Z") point = { x: cmd.x, y: cmd.y };
  }
  return found;
}

/** Every point a command list passes through or uses as a control. */
function coordinates(cmds: readonly PathCmd[]): Point[] {
  const points: Point[] = [];
  for (const cmd of cmds) {
    if (cmd.c === "Z") continue;
    points.push({ x: cmd.x, y: cmd.y });
    if (cmd.c === "C") {
      points.push({ x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 });
    }
  }
  return points;
}

const BOX: Rect = { x: 0, y: 0, w: 10, h: 10 };
const SQUARE: readonly PathCmd[] = [M(0, 0), L(10, 0), L(10, 10), L(0, 10), Z];

/* ------------------------------------------------------------------ */
/* rotateCornerMask                                                    */
/* ------------------------------------------------------------------ */

describe("rotateCornerMask", () => {
  it("turns a physical corner one quarter clockwise at a time", () => {
    expect(rotateCornerMask(CORNER_TOP_LEFT, 1)).toBe(CORNER_TOP_RIGHT);
    expect(rotateCornerMask(CORNER_TOP_RIGHT, 1)).toBe(CORNER_BOTTOM_RIGHT);
    expect(rotateCornerMask(CORNER_BOTTOM_RIGHT, 1)).toBe(CORNER_BOTTOM_LEFT);
    expect(rotateCornerMask(CORNER_BOTTOM_LEFT, 1)).toBe(CORNER_TOP_LEFT);
  });

  it("is periodic, accepts negative turns and keeps the empty / full masks", () => {
    expect(rotateCornerMask(CORNER_TOP_LEFT, 4)).toBe(CORNER_TOP_LEFT);
    expect(rotateCornerMask(CORNER_TOP_LEFT, -1)).toBe(CORNER_BOTTOM_LEFT);
    expect(rotateCornerMask(0, 3)).toBe(0);
    expect(rotateCornerMask(CORNER_ALL, 2)).toBe(CORNER_ALL);
  });
});

/* ------------------------------------------------------------------ */
/* roundingRadius                                                      */
/* ------------------------------------------------------------------ */

describe("roundingRadius", () => {
  it("is a fraction of the shorter side", () => {
    expect(roundingRadius({ radius: 0.1, corners: CORNER_ALL }, 40, 80)).toBe(
      4,
    );
    expect(roundingRadius({ radius: 0.1, corners: CORNER_ALL }, 80, 40)).toBe(
      4,
    );
  });

  it("clamps to half the shorter side and treats off / broken as zero", () => {
    expect(
      roundingRadius({ radius: 0.9, corners: CORNER_ALL }, 40, 80),
    ).toBe(MAX_ROUNDING_RADIUS * 40);
    expect(roundingRadius({ radius: 0, corners: CORNER_ALL }, 40, 80)).toBe(0);
    expect(
      roundingRadius({ radius: Number.NaN, corners: CORNER_ALL }, 40, 80),
    ).toBe(0);
    expect(roundingRadius(undefined, 40, 80)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* roundCorners                                                        */
/* ------------------------------------------------------------------ */

describe("roundCorners", () => {
  it("replaces each corner with one cubic whose controls are the midpoints", () => {
    const rounded = roundCorners(SQUARE, BOX, 2, CORNER_ALL);
    expect(rounded).toEqual([
      M(2, 0),
      L(8, 0),
      C(9, 0, 10, 1, 10, 2),
      L(10, 8),
      C(10, 9, 9, 10, 8, 10),
      L(2, 10),
      C(1, 10, 0, 9, 0, 8),
      L(0, 2),
      // The closing corner: the `Z` edge is drawn explicitly, then the curve
      // finishes on the point the subpath starts from.
      C(0, 1, 1, 0, 2, 0),
      Z,
    ]);
    // A rounded corner is a Bézier, never an arc.
    expect(rounded.some((cmd) => cmd.c === "A")).toBe(false);
    // The input is not mutated.
    expect(SQUARE).toEqual([M(0, 0), L(10, 0), L(10, 10), L(0, 10), Z]);
  });

  it("rounds exactly the physical corners named by the mask", () => {
    const cases = [
      {
        bit: CORNER_TOP_LEFT,
        ends: [
          { x: 0, y: 2 },
          { x: 2, y: 0 },
        ],
      },
      {
        bit: CORNER_TOP_RIGHT,
        ends: [
          { x: 8, y: 0 },
          { x: 10, y: 2 },
        ],
      },
      {
        bit: CORNER_BOTTOM_RIGHT,
        ends: [
          { x: 10, y: 8 },
          { x: 8, y: 10 },
        ],
      },
      {
        bit: CORNER_BOTTOM_LEFT,
        ends: [
          { x: 2, y: 10 },
          { x: 0, y: 8 },
        ],
      },
    ];

    for (const { bit, ends } of cases) {
      const found = curves(roundCorners(SQUARE, BOX, 2, bit));
      expect(found).toHaveLength(1);
      expect([found[0].start, found[0].end]).toEqual(ends);
    }
    expect(curves(roundCorners(SQUARE, BOX, 2, 0))).toHaveLength(0);
  });

  it("rounds interior vertices regardless of the corner mask", () => {
    // Hamza-like notch: four vertices inside the box have axis-aligned edges but
    // are not box corners, so no mask bit governs them.
    const notched: PathCmd[] = [
      M(0, 0),
      L(10, 0),
      L(10, 3),
      L(3, 3),
      L(3, 7),
      L(10, 7),
      L(10, 10),
      L(0, 10),
      Z,
    ];
    expect(curves(roundCorners(notched, BOX, 1, 0))).toHaveLength(4);
    expect(curves(roundCorners(SQUARE, BOX, 2, 0))).toHaveLength(0);
  });

  it("clamps each edge's trim at half its length", () => {
    const smallBox: Rect = { x: 0, y: 0, w: 2, h: 2 };
    const small: PathCmd[] = [M(0, 0), L(2, 0), L(2, 2), L(0, 2), Z];
    const huge = roundCorners(small, smallBox, 5, CORNER_ALL);
    expect(huge).toEqual(roundCorners(small, smallBox, 1, CORNER_ALL));
    for (const point of coordinates(huge)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(2);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(2);
    }

    // A wide, short box is clamped by its short side, not its long one.
    const wideBox: Rect = { x: 0, y: 0, w: 10, h: 2 };
    const wide: PathCmd[] = [M(0, 0), L(10, 0), L(10, 2), L(0, 2), Z];
    expect(roundCorners(wide, wideBox, 5, CORNER_ALL)).toEqual(
      roundCorners(wide, wideBox, 1, CORNER_ALL),
    );
  });

  it("returns a copy untouched when it cannot round anything", () => {
    const straight = roundCorners(SQUARE, BOX, 0, CORNER_ALL);
    expect(straight).toEqual(SQUARE);
    expect(straight).not.toBe(SQUARE);

    const twoSubpaths: PathCmd[] = [M(0, 0), L(1, 0), M(2, 2), L(3, 3)];
    expect(roundCorners(twoSubpaths, BOX, 2, CORNER_ALL)).toEqual(twoSubpaths);

    // A circle is arcs all the way round: no straight-to-straight vertex.
    const circle = shapeById("circle").commands(10, 10);
    expect(roundCorners(circle, BOX, 2, CORNER_ALL)).toEqual(circle);
  });

  it("leaves the open ends of an open subpath square", () => {
    const open: PathCmd[] = [M(0, 0), L(10, 0), L(10, 10)];
    const found = curves(roundCorners(open, BOX, 2, CORNER_ALL));
    expect(found).toHaveLength(1);
    expect(found[0].start).toEqual({ x: 8, y: 0 });
    expect(found[0].end).toEqual({ x: 10, y: 2 });
  });

  it("rounds through the shape palette, rotating the physical mask with non-square shapes", () => {
    const triangle = shapeById("triangle");
    const box: Rect = { x: 5, y: 7, w: 10, h: 10 };
    const local = roundCorners(
      triangle.commands(box.w, box.h),
      { x: 0, y: 0, w: box.w, h: box.h },
      2,
      CORNER_BOTTOM_LEFT,
    );
    const turned = composeFrames(
      quarterTurnFrame(box.w / 2, box.h / 2, 1),
      baseFrame(box.x, box.y),
    );
    expect(
      triangle.path(box, 1, { radius: 0.2, corners: CORNER_TOP_LEFT }),
    ).toBe(cmdsToPath(mapCommands(local, turned, 90)));
  });

  it("keeps the square's box and physical mask through every turn", () => {
    const square = shapeById("square");
    for (const turn of [0, 1, 2, 3] as const) {
      expect(square.path(BOX, turn)).toBe(rectPath(BOX));
    }

    const rounded = square.path(BOX, 0, { radius: 0.2, corners: CORNER_ALL });
    expect(rounded).not.toBe(rectPath(BOX));
    expect(rounded).toContain(" C ");
    expect(rounded).not.toContain(" A ");

    // A rotation-invariant square keeps the physical top-left corner at the
    // top-left: the mask is not carried around the box with the turn.
    const box: Rect = { x: 5, y: 7, w: 10, h: 10 };
    const topLeft = square.path(box, 0, {
      radius: 0.2,
      corners: CORNER_TOP_LEFT,
    });
    for (const turn of [1, 2, 3] as const) {
      expect(
        square.path(box, turn, { radius: 0.2, corners: CORNER_TOP_LEFT }),
      ).toBe(topLeft);
    }
    expect(topLeft).not.toBe(
      square.path(box, 0, { radius: 0.2, corners: CORNER_BOTTOM_LEFT }),
    );
  });

  it("rounds interior vertices of the pentagon but leaves a circle alone", () => {
    const pentagon = shapeById("pentagon");
    const plain = pentagon.path(BOX, 0);
    const rounded = pentagon.path(BOX, 0, { radius: 0.1, corners: 0 });
    expect(rounded).not.toBe(plain);
    expect(rounded).toContain(" C ");

    const circle = shapeById("circle");
    expect(circle.path(BOX, 0, { radius: 0.2, corners: CORNER_ALL })).toBe(
      circle.path(BOX, 0),
    );
  });
});
