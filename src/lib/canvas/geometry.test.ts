/**
 * Tests for the geometry kernel — the pure plumbing the canvas, tools and grid
 * build their paths from. Everything is deterministic maths on the fixed
 * `0 0 1000 1000` viewBox, so assertions are exact numbers (plus `toBeCloseTo`
 * for transcendental values). The canonical fixture is `ratio: 3/4`, `base: 10`
 * → the drawn cell (`cellSize`) with a `3/4` ink square.
 */

import { describe, expect, it } from "vitest";
import {
  CIRCULAR_ANGULAR_UNIT,
  DEFAULT_PROJECT_CONFIG,
  RATIO_PRESETS,
  cellSize,
} from "@/lib/canvas/model";
import type { ProjectConfig, Zone } from "@/lib/canvas/model";
import {
  A,
  CENTER,
  L,
  M,
  Z,
  arcCentre,
  baseFrame,
  boundsOfPoints,
  circularSlice,
  cmdsToPath,
  composeFrames,
  distanceToArc,
  distanceToPolyline,
  distanceToSegment,
  expandRect,
  inkUnit,
  mapCommands,
  polar,
  quarterTurnFrame,
  rectContains,
  rectPath,
  rectsIntersect,
  sectorPath,
  sectorSpan,
  shortestSectorDelta,
  slicePath,
  unionRect,
  zoneRect,
} from "@/lib/canvas/geometry";
import type { CircularSlice, Point, Rect } from "@/lib/canvas/geometry";

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return { ...DEFAULT_PROJECT_CONFIG, base: 10, ...overrides };
}

/** The default cell: ratio 3/4, base 10 → 100 drawn cells (the last cell's
 * space cropped), so the drawn cell is 1000 / 99.75 units. */
const CANONICAL = makeConfig();
/** The equal `1:1` cell: half ink beside half space → 5 units of ink. */
const EQUAL = makeConfig({ ratio: RATIO_PRESETS[0].ratio });
/** The same two, on the polar grid. */
const CANONICAL_CIRCULAR = makeConfig({ gridType: "circular" });
const EQUAL_CIRCULAR = makeConfig({
  gridType: "circular",
  ratio: RATIO_PRESETS[0].ratio,
});

const QUADRANTS: readonly Zone[] = [0, 1, 2, 3];

/** Asserts an annular slice field by field (angles are transcendental). */
function expectSlice(slice: CircularSlice, expected: CircularSlice): void {
  expect(slice.cx).toBe(expected.cx);
  expect(slice.cy).toBe(expected.cy);
  expect(slice.r1).toBeCloseTo(expected.r1, 12);
  expect(slice.r2).toBeCloseTo(expected.r2, 12);
  expect(slice.a1).toBeCloseTo(expected.a1, 12);
  expect(slice.a2).toBeCloseTo(expected.a2, 12);
}

/* ------------------------------------------------------------------ */
/* zones                                                               */
/* ------------------------------------------------------------------ */

describe("inkUnit", () => {
  it("is the ratio · drawn-cell thickness of one cell", () => {
    expect(inkUnit(CANONICAL)).toBe(0.75 * cellSize(CANONICAL));
    expect(inkUnit(EQUAL)).toBe(0.5 * cellSize(EQUAL));
    const thin = makeConfig({ ratio: 0.5, base: 20 });
    expect(inkUnit(thin)).toBe(0.5 * cellSize(thin));
    const fifths = makeConfig({ ratio: 5 / 6, base: 30 });
    expect(inkUnit(fifths)).toBe((5 / 6) * cellSize(fifths));
  });
});

describe("zoneRect", () => {
  const cell = cellSize(CANONICAL);
  const ink = inkUnit(CANONICAL);
  const space = cell - ink;

  it("splits the four zones of the canonical cell at the ink thickness", () => {
    expect(zoneRect(CANONICAL, 0, 0, 0)).toEqual({ x: 0, y: 0, w: ink, h: ink });
    expect(zoneRect(CANONICAL, 0, 0, 1)).toEqual({ x: ink, y: 0, w: space, h: ink });
    expect(zoneRect(CANONICAL, 0, 0, 2)).toEqual({ x: 0, y: ink, w: ink, h: space });
    expect(zoneRect(CANONICAL, 0, 0, 3)).toEqual({ x: ink, y: ink, w: space, h: space });
  });

  it("keeps the ink at the top-left of every cell", () => {
    for (const zone of QUADRANTS) {
      const rect = zoneRect(CANONICAL, 4, 7, zone);
      expect(rect.x).toBeGreaterThanOrEqual(4 * cell);
      expect(rect.y).toBeGreaterThanOrEqual(7 * cell);
      expect(rect.x + rect.w).toBeLessThanOrEqual(5 * cell + 1e-9);
      expect(rect.y + rect.h).toBeLessThanOrEqual(8 * cell + 1e-9);
    }
    expect(zoneRect(CANONICAL, 4, 7, 0)).toEqual({ x: 4 * cell, y: 7 * cell, w: ink, h: ink });
    expect(zoneRect(CANONICAL, 4, 7, 3)).toEqual({
      x: 4 * cell + ink,
      y: 7 * cell + ink,
      w: space,
      h: space,
    });
  });

  it("splits the equal 1:1 cell into four congruent quadrants", () => {
    // Half ink beside half space: every fragment has the same positive area,
    // and the four of them tile the drawn cell.
    const equalCell = cellSize(EQUAL);
    const half = inkUnit(EQUAL);
    expect(half).toBe(equalCell / 2);
    expect(zoneRect(EQUAL, 2, 3, 0)).toEqual({ x: 2 * equalCell, y: 3 * equalCell, w: half, h: half });
    expect(zoneRect(EQUAL, 2, 3, 1)).toEqual({ x: 2 * equalCell + half, y: 3 * equalCell, w: half, h: half });
    expect(zoneRect(EQUAL, 2, 3, 2)).toEqual({ x: 2 * equalCell, y: 3 * equalCell + half, w: half, h: half });
    expect(zoneRect(EQUAL, 2, 3, 3)).toEqual({ x: 2 * equalCell + half, y: 3 * equalCell + half, w: half, h: half });
  });

  it("honours a ratio thinner than the default", () => {
    const thin = makeConfig({ ratio: 0.25, base: 20 });
    const thinCell = cellSize(thin);
    const thinInk = inkUnit(thin);
    expect(zoneRect(thin, 2, 3, 0)).toEqual({
      x: 2 * thinCell,
      y: 3 * thinCell,
      w: thinInk,
      h: thinInk,
    });
    expect(zoneRect(thin, 2, 3, 3)).toEqual({
      x: 2 * thinCell + thinInk,
      y: 3 * thinCell + thinInk,
      w: thinCell - thinInk,
      h: thinCell - thinInk,
    });
  });
});

describe("circularSlice", () => {
  const U = CIRCULAR_ANGULAR_UNIT;
  const cell = cellSize(CANONICAL_CIRCULAR);
  const ink = inkUnit(CANONICAL_CIRCULAR);
  const slice = (
    config: ProjectConfig,
    band: number,
    sector: number,
    zone: Zone,
    r1: number,
    r2: number,
    a1: number,
    a2: number,
  ) => expectSlice(circularSlice(config, band, sector, zone), { cx: 500, cy: 500, r1, r2, a1, a2 });

  it("places the radial / angular zones of the canonical band", () => {
    slice(CANONICAL_CIRCULAR, 1, 0, 0, cell, cell + ink, 0, 0.75 * U);
    slice(CANONICAL_CIRCULAR, 1, 0, 1, cell + ink, 2 * cell, 0, 0.75 * U);
    slice(CANONICAL_CIRCULAR, 1, 0, 2, cell, cell + ink, 0.75 * U, U);
    slice(CANONICAL_CIRCULAR, 1, 0, 3, cell + ink, 2 * cell, 0.75 * U, U);
  });

  it("offsets by band and sector, including the last sector", () => {
    slice(CANONICAL_CIRCULAR, 2, 35, 0, 2 * cell, 2 * cell + ink, 35 * U, 35.75 * U);
  });

  it("splits the equal 1:1 slice into four congruent quadrants", () => {
    const equalCell = cellSize(EQUAL_CIRCULAR);
    const half = inkUnit(EQUAL_CIRCULAR);
    slice(EQUAL_CIRCULAR, 1, 0, 0, equalCell, equalCell + half, 0, 0.5 * U);
    slice(EQUAL_CIRCULAR, 1, 0, 1, equalCell + half, 2 * equalCell, 0, 0.5 * U);
    slice(EQUAL_CIRCULAR, 1, 0, 2, equalCell, equalCell + half, 0.5 * U, U);
    slice(EQUAL_CIRCULAR, 1, 0, 3, equalCell + half, 2 * equalCell, 0.5 * U, U);
  });

  it("takes the angular unit from the board's own sector count", () => {
    const twelve = makeConfig({ gridType: "circular", circularSectors: 12 });
    const eight = makeConfig({ gridType: "circular", circularSectors: 8 });
    const seventyTwo = makeConfig({ gridType: "circular", circularSectors: 72 });
    const u12 = (2 * Math.PI) / 12;
    const u8 = (2 * Math.PI) / 8;
    const u72 = (2 * Math.PI) / 72;
    const cell12 = cellSize(twelve);
    const cell72 = cellSize(seventyTwo);
    slice(twelve, 1, 3, 0, cell12, cell12 + inkUnit(twelve), 3 * u12, 3.75 * u12);
    slice(twelve, 1, 11, 2, cell12, cell12 + inkUnit(twelve), 11.75 * u12, 12 * u12);
    slice(eight, 0, 5, 0, 0, inkUnit(eight), 5 * u8, 5.75 * u8);
    slice(
      seventyTwo,
      2,
      71,
      3,
      2 * cell72 + inkUnit(seventyTwo),
      3 * cell72,
      71.75 * u72,
      72 * u72,
    );
  });
});

/* ------------------------------------------------------------------ */
/* polar / sectors                                                     */
/* ------------------------------------------------------------------ */

describe("polar", () => {
  it("places a point at radius and angle in atan2 convention", () => {
    expect(polar(0, 0, 2, 0)).toEqual({ x: 2, y: 0 });
    expect(polar(0, 0, 2, Math.PI / 2).y).toBeCloseTo(2, 12);
    expect(polar(0, 0, 2, Math.PI / 2).x).toBeCloseTo(0, 12);
    // A negative angle simply lands below the centre; `polar` never wraps
    // (grid.ts normalises angles at the addressing layer).
    expect(polar(0, 0, 5, -Math.PI / 2).y).toBeCloseTo(-5, 12);
    expect(polar(CENTER, CENTER, 10, 2 * Math.PI).x).toBeCloseTo(CENTER + 10, 12);
  });
});

describe("shortestSectorDelta / sectorSpan", () => {
  it("measures the shortest signed run", () => {
    expect(shortestSectorDelta(CANONICAL_CIRCULAR, 0, 0)).toBe(0);
    expect(shortestSectorDelta(CANONICAL_CIRCULAR, 0, 1)).toBe(1);
    expect(shortestSectorDelta(CANONICAL_CIRCULAR, 1, 0)).toBe(-1);
    expect(shortestSectorDelta(CANONICAL_CIRCULAR, 10, 4)).toBe(-6);
    // 35 and 0 are adjacent *through the seam*, so the delta is ±1.
    expect(shortestSectorDelta(CANONICAL_CIRCULAR, 0, 35)).toBe(-1);
    expect(shortestSectorDelta(CANONICAL_CIRCULAR, 35, 0)).toBe(1);
    // A negative index is normalised into the 36-sector ring.
    expect(shortestSectorDelta(CANONICAL_CIRCULAR, 0, -1)).toBe(-1);
  });

  it("wraps both ways through the seam", () => {
    expect(shortestSectorDelta(CANONICAL_CIRCULAR, 34, 1)).toBe(3);
    expect(shortestSectorDelta(CANONICAL_CIRCULAR, 1, 34)).toBe(-3);
    // Exactly half the ring stays positive (the code uses a strict `>`).
    expect(shortestSectorDelta(CANONICAL_CIRCULAR, 0, 18)).toBe(18);
    expect(shortestSectorDelta(CANONICAL_CIRCULAR, 0, 19)).toBe(-17);
  });

  it("wraps around the seam of a shorter ring", () => {
    const twelve = makeConfig({ gridType: "circular", circularSectors: 12 });
    expect(shortestSectorDelta(twelve, 0, 11)).toBe(-1);
    expect(shortestSectorDelta(twelve, 11, 0)).toBe(1);
    // Half of 12 is 6, and the tie stays positive.
    expect(shortestSectorDelta(twelve, 0, 6)).toBe(6);
    expect(shortestSectorDelta(twelve, 0, 7)).toBe(-5);
  });

  it("counts the sectors the run covers, signed", () => {
    expect(sectorSpan(CANONICAL_CIRCULAR, 0, 0)).toBe(1);
    expect(sectorSpan(CANONICAL_CIRCULAR, 0, 1)).toBe(2);
    expect(sectorSpan(CANONICAL_CIRCULAR, 1, 0)).toBe(-2);
    expect(sectorSpan(CANONICAL_CIRCULAR, 0, 35)).toBe(-2);
    expect(sectorSpan(CANONICAL_CIRCULAR, 35, 0)).toBe(2);
    expect(sectorSpan(CANONICAL_CIRCULAR, 10, 4)).toBe(-7);
    expect(sectorSpan(CANONICAL_CIRCULAR, 0, 17)).toBe(18);
    expect(sectorSpan(CANONICAL_CIRCULAR, 0, 19)).toBe(-18);
  });

  it("spans the board's own sector count", () => {
    const twelve = makeConfig({ gridType: "circular", circularSectors: 12 });
    // 0°→11 is one step backwards through the seam of a 12-sector ring.
    expect(sectorSpan(twelve, 0, 11)).toBe(-2);
    expect(sectorSpan(twelve, 11, 0)).toBe(2);
    // On a 36-sector ring the same pair is a longer trip.
    expect(sectorSpan(CANONICAL_CIRCULAR, 0, 11)).toBe(12);
    expect(sectorSpan(CANONICAL_CIRCULAR, 11, 0)).toBe(-12);
  });
});

describe("sectorPath / slicePath", () => {
  it("draws the outer arc forwards and the inner arc backwards", () => {
    const o1 = polar(500, 500, 20, 0);
    const o2 = polar(500, 500, 20, Math.PI / 2);
    const i2 = polar(500, 500, 10, Math.PI / 2);
    const i1 = polar(500, 500, 10, 0);
    const expected = [M(o1.x, o1.y), A(20, 20, 0, 1, o2.x, o2.y), L(i2.x, i2.y), A(10, 10, 0, 0, i1.x, i1.y), Z];
    expect(sectorPath(500, 500, 10, 20, 0, Math.PI / 2)).toBe(cmdsToPath(expected));
  });

  it("flips the flags for a backwards sweep", () => {
    const path = sectorPath(500, 500, 10, 20, CIRCULAR_ANGULAR_UNIT, 0);
    expect(path).toContain("A 20 20 0 0 0"); // sweep 0: runs backwards
    expect(path).not.toContain("A 20 20 0 1 0");
  });

  it("sets the large-arc flag past half a turn", () => {
    const path = sectorPath(500, 500, 10, 20, 0, Math.PI * 1.5);
    expect(path).toContain("A 20 20 0 1 1");
  });

  it("splits a full ring into two half arcs so it cannot collapse", () => {
    const ring = [M(520, 500), A(20, 20, 0, 1, 480, 500), A(20, 20, 0, 1, 520, 500), L(510, 500), A(10, 10, 0, 0, 490, 500), A(10, 10, 0, 0, 510, 500), Z];
    expect(sectorPath(500, 500, 10, 20, 0, 2 * Math.PI)).toBe(cmdsToPath(ring));
  });

  it("matches sectorPath for the matching slice", () => {
    const slice = circularSlice(CANONICAL_CIRCULAR, 2, 5, 1);
    expect(slicePath(slice)).toBe(sectorPath(slice.cx, slice.cy, slice.r1, slice.r2, slice.a1, slice.a2));
    expect(slicePath(slice)).not.toBe("");
  });

  it("draws the slices of any board sector count", () => {
    const eight = makeConfig({ gridType: "circular", circularSectors: 8 });
    const last = circularSlice(eight, 1, 7, 0);
    const u8 = (2 * Math.PI) / 8;
    expect(last.a1).toBeCloseTo(7 * u8, 12);
    expect(last.a2).toBeCloseTo(7.75 * u8, 12);
    expect(slicePath(last)).toBe(
      sectorPath(500, 500, last.r1, last.r2, last.a1, last.a2),
    );
  });
});

/* ------------------------------------------------------------------ */
/* circular arcs                                                       */
/* ------------------------------------------------------------------ */

describe("arcCentre / distanceToArc", () => {
  it("converts a semicircle's endpoints to centre form", () => {
    const arc = arcCentre({ x: 0, y: 0 }, { x: 10, y: 0 }, 5, 0, 1);
    expect([arc.cx, arc.cy, arc.r]).toEqual([5, 0, 5]);
    expect(arc.start).toBeCloseTo(Math.PI, 12);
    expect(arc.delta).toBeCloseTo(Math.PI, 12);
  });

  it("grows a too-small radius to half the chord", () => {
    const arc = arcCentre({ x: 0, y: 0 }, { x: 10, y: 0 }, 2, 0, 1);
    expect(arc.r).toBe(5);
    expect(arc.cx).toBeCloseTo(5, 12);
  });

  it("measures 0 on the arc, the radial gap inside it, and an endpoint otherwise", () => {
    const arc = arcCentre({ x: 0, y: 0 }, { x: 10, y: 0 }, 5, 0, 1);
    // On the arc: radius 5 around (5, 0).
    expect(distanceToArc({ x: 5, y: -5 }, arc)).toBeCloseTo(0, 12);
    // Inside the swept range but 2 short of the ring.
    expect(distanceToArc({ x: 5, y: -2 }, arc)).toBeCloseTo(3, 12);
    // On the ring but outside the sweep → nearest endpoint, √50 away.
    expect(distanceToArc({ x: 5, y: 5 }, arc)).toBeCloseTo(Math.SQRT2 * 5, 12);
  });

  it("reads a point on a large arc as distance 0", () => {
    // `large = 1` with an oversized radius picks the major arc (|Δ| > π).
    const arc = arcCentre({ x: -10, y: 0 }, { x: 10, y: 0 }, 20, 1, 1);
    expect(Math.abs(arc.delta)).toBeGreaterThan(Math.PI);
    expect(distanceToArc(polar(arc.cx, arc.cy, arc.r, arc.start + arc.delta / 2), arc)).toBeCloseTo(0, 12);
  });
});

/* ------------------------------------------------------------------ */
/* distances                                                           */
/* ------------------------------------------------------------------ */

describe("distanceToSegment / distanceToPolyline", () => {
  it("projects onto the segment and clamps at the ends", () => {
    expect(distanceToSegment({ x: 0, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distanceToSegment({ x: 12, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(2);
    // A degenerate segment is a point.
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });

  it("measures an open polyline and closes it on request", () => {
    const triangle: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    // (-3, 5) is nearest the open diagonal…
    expect(distanceToPolyline({ x: -3, y: 5 }, triangle, false)).toBeCloseTo(8 / Math.SQRT2, 12);
    // …but nearest the closing edge once the loop is closed.
    expect(distanceToPolyline({ x: -3, y: 5 }, triangle, true)).toBe(3);
  });

  it("handles the empty and single-point cases", () => {
    expect(distanceToPolyline({ x: 0, y: 0 }, [], false)).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }], true)).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
/* rects                                                               */
/* ------------------------------------------------------------------ */

describe("rect helpers", () => {
  it("bounds a point list, collapsing an empty one to a zero rect", () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }];
    expect(boundsOfPoints(points)).toEqual({ x: 0, y: 0, w: 10, h: 5 });
    // The declared return type is `Rect`, so an empty list is `0 0 0 0`
    // rather than `null` (item-level "no bounds" is `itemsBounds`, in items.ts).
    expect(boundsOfPoints([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(boundsOfPoints([{ x: 4, y: -2 }])).toEqual({ x: 4, y: -2, w: 0, h: 0 });
  });

  it("expands a rect on every side", () => {
    const rect: Rect = { x: 10, y: 20, w: 30, h: 40 };
    expect(expandRect(rect, 5)).toEqual({ x: 5, y: 15, w: 40, h: 50 });
    // A negative amount shrinks, mirroring the same formula.
    expect(expandRect(rect, -5)).toEqual({ x: 15, y: 25, w: 20, h: 30 });
  });

  it("contains points inclusively on the edges", () => {
    const rect: Rect = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectContains(rect, { x: 0, y: 0 })).toBe(true);
    expect(rectContains(rect, { x: 10, y: 10 })).toBe(true);
    expect(rectContains(rect, { x: 5, y: 10 })).toBe(true);
    expect(rectContains(rect, { x: 10.001, y: 5 })).toBe(false);
    expect(rectContains(rect, { x: -0.001, y: 5 })).toBe(false);
  });

  it("treats touching edges as an intersection", () => {
    const rect: Rect = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectsIntersect(rect, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect(rect, { x: 10, y: 10, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect(rect, { x: 10, y: 0, w: 5, h: 5 })).toBe(true);
    expect(rectsIntersect(rect, { x: 10.001, y: 0, w: 5, h: 5 })).toBe(false);
    expect(rectsIntersect(rect, { x: 0, y: 20, w: 5, h: 5 })).toBe(false);
  });

  it("unions two rects", () => {
    const rect: Rect = { x: 0, y: 0, w: 10, h: 10 };
    expect(unionRect(rect, { x: 5, y: 5, w: 10, h: 10 })).toEqual({ x: 0, y: 0, w: 15, h: 15 });
    expect(unionRect(rect, { x: 2, y: 2, w: 1, h: 1 })).toEqual(rect);
  });
});

/* ------------------------------------------------------------------ */
/* path plumbing                                                       */
/* ------------------------------------------------------------------ */

describe("cmdsToPath / rectPath", () => {
  it("formats every command and rounds away float noise", () => {
    expect(cmdsToPath([M(1, 2), L(3, 4), Z])).toBe("M 1 2 L 3 4 Z");
    expect(cmdsToPath([A(5, 6, 0, 1, 7, 8)])).toBe("A 5 6 0 0 1 7 8");
    // `rot` is always written out, then the two flags.
    expect(cmdsToPath([A(1, 2, 1, 0, 3, 4)])).toBe("A 1 2 0 1 0 3 4");
    // 0.1 + 0.2 snaps to 0.3, and -0 prints as 0.
    expect(cmdsToPath([M(-0, 0.1 + 0.2), L(-3, -4)])).toBe("M 0 0.3 L -3 -4");
    expect(cmdsToPath([])).toBe("");
  });

  it("draws an axis-aligned rectangle path", () => {
    expect(rectPath({ x: 20, y: 30, w: 10, h: 5 })).toBe("M 20 30 L 30 30 L 30 35 L 20 35 Z");
  });
});

describe("frames", () => {
  it("builds an identity translation and a quarter turn about a centre", () => {
    expect(baseFrame(7, 9)).toEqual({ ox: 7, oy: 9, cos: 1, sin: 0 });
    const turn = quarterTurnFrame(25, 40, 1);
    expect(turn.cos).toBeCloseTo(0, 12);
    expect(turn.sin).toBeCloseTo(1, 12);
    // The centre is a fixed point of the turn.
    expect(turn.ox + (25 * turn.cos - 40 * turn.sin)).toBeCloseTo(25, 12);
    expect(turn.oy + (25 * turn.sin + 40 * turn.cos)).toBeCloseTo(40, 12);
  });

  it("composes frames right-to-left", () => {
    // inner(base) then outer(base) is just the outer translation.
    const translation = composeFrames(baseFrame(0, 0), baseFrame(5, 5));
    expect(translation).toEqual({ ox: 5, oy: 5, cos: 1, sin: 0 });
    // Two quarter turns are a half turn.
    const half = composeFrames(quarterTurnFrame(0, 0, 1), quarterTurnFrame(0, 0, 1));
    expect(half.cos).toBeCloseTo(-1, 12);
    expect(half.sin).toBeCloseTo(0, 12);
    expect(half.ox).toBeCloseTo(0, 12);
    expect(half.oy).toBeCloseTo(0, 12);
  });

  it("maps a local box through a composed quarter turn about its centre", () => {
    // A 10×20 box at (20, 30), authored 0…w × 0…h, turned a quarter clockwise
    // about its centre (25, 40): the corners land on the expected grid.
    const frame = composeFrames(quarterTurnFrame(5, 10, 1), baseFrame(20, 30));
    const square = [M(0, 0), L(10, 0), L(10, 20), L(0, 20), Z];
    expect(cmdsToPath(mapCommands(square, frame, 0))).toBe("M 35 35 L 35 45 L 15 45 L 15 35 Z");
  });

  it("shifts an arc's x-axis-rotation by the caller's degrees, mod 180", () => {
    const command = A(1, 1, 0, 1, 2, 3);
    const at = (deg: number) => mapCommands([command], baseFrame(0, 0), deg)[0];
    expect(at(90)).toEqual({ ...command, rot: 90 });
    expect(at(180)).toEqual({ ...command, rot: 0 });
    expect(at(-90)).toEqual({ ...command, rot: 90 });
    expect(at(270)).toEqual({ ...command, rot: 90 });
  });
});
