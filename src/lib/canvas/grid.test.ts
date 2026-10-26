/**
 * Tests for grid addressing and the construction grid.
 *
 * Addressing is the inverse of the drawing: a pointer becomes an anchor
 * (cell + zone), an anchor becomes the ink-square centre every line / arc /
 * polyline is drawn through, and a drag becomes the list of cells it sweeps.
 * The construction grid is the two line families drawn behind the artwork —
 * the cell borders and the inner edges that close each cell's ink square.
 */

import { describe, expect, it } from "vitest";
import {
  ANCHOR_GRID,
  CIRCULAR_ANGULAR_UNIT,
  DEFAULT_PROJECT_CONFIG,
  RATIO_PRESETS,
  VIEWBOX_SIZE,
  cellSize,
  circularAngularUnit,
  gridCount,
  linePoint,
} from "@/lib/canvas/model";
import type { Anchor, Cell, ProjectConfig, Zone } from "@/lib/canvas/model";
import {
  CENTER,
  circularSlice,
  inkUnit,
  polar,
  zoneRect,
} from "@/lib/canvas/geometry";
import {
  anchorToCell,
  cellCentre,
  cellsBetween,
  gridPaths,
  isSameAxis,
  linePointPosition,
  pointToAnchor,
  pointToArcPoint,
  pointToCell,
  pointToLinePoint,
  runOf,
  smartArcPoints,
} from "@/lib/canvas/grid";

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return { ...DEFAULT_PROJECT_CONFIG, base: 10, ...overrides };
}

const SQUARE = makeConfig();
/** The equal `1:1` cell: half ink beside half space, the lightest preset. */
const EQUAL = makeConfig({ ratio: RATIO_PRESETS[0].ratio });
const CIRCULAR = makeConfig({ gridType: "circular" });
const CIRCULAR_EQUAL = makeConfig({
  gridType: "circular",
  ratio: RATIO_PRESETS[0].ratio,
});
/** A board that divides the circle into 12 sectors of 30° instead of 36 of 10°. */
const TWELVE = makeConfig({ gridType: "circular", circularSectors: 12 });

/** A point on the polar grid: radius in viewBox units, angle in sectors. */
function at(radius: number, sectors: number): { x: number; y: number } {
  return polar(CENTER, CENTER, radius, sectors * CIRCULAR_ANGULAR_UNIT);
}

/** The `fmt` in geometry.ts rounds to 1e-6; mirror it for path assertions. */
function f(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

/** The same, on a board whose sector count is not the default 36. */
function atSectors(
  config: ProjectConfig,
  radius: number,
  sectors: number,
): { x: number; y: number } {
  return polar(CENTER, CENTER, radius, sectors * circularAngularUnit(config));
}

/* ------------------------------------------------------------------ */
/* pointToCell                                                         */
/* ------------------------------------------------------------------ */

describe("pointToCell", () => {
  it("floors each axis on the square grid", () => {
    const cell = cellSize(SQUARE);
    expect(pointToCell(SQUARE, { x: 1.5 * cell, y: 2.5 * cell })).toEqual({ column: 1, row: 2 });
    expect(pointToCell(SQUARE, { x: 0, y: 0 })).toEqual({ column: 0, row: 0 });
    // The right / bottom edge of a cell belongs to the next cell.
    expect(pointToCell(SQUARE, { x: cell, y: cell })).toEqual({ column: 1, row: 1 });
    expect(pointToCell(SQUARE, { x: cell - 1e-6, y: cell - 1e-6 })).toEqual({ column: 0, row: 0 });
  });

  it("keeps negative coordinates on the same floor rule", () => {
    expect(pointToCell(SQUARE, { x: -0.5, y: -0.5 })).toEqual({ column: -1, row: -1 });
    expect(pointToCell(SQUARE, { x: -10, y: 5 })).toEqual({ column: -1, row: 0 });
  });

  it("addresses the circular band and sector", () => {
    expect(pointToCell(CIRCULAR, { x: 500, y: 500 })).toEqual({ column: 0, row: 0 });
    // 15 units straight down: band 1, sector 9 (90°).
    expect(pointToCell(CIRCULAR, { x: 500, y: 515 })).toEqual({ column: 1, row: 9 });
    expect(pointToCell(CIRCULAR, at(25, 0))).toEqual({ column: 2, row: 0 });
  });

  it("wraps the angle across the 0 / 2π seam", () => {
    // Just before the seam the point is still in the last sector…
    expect(pointToCell(CIRCULAR, at(15, -0.01 / CIRCULAR_ANGULAR_UNIT))).toEqual({
      column: 1,
      row: 35,
    });
    // …and just after it, in the first.
    expect(pointToCell(CIRCULAR, at(15, 0.01 / CIRCULAR_ANGULAR_UNIT))).toEqual({
      column: 1,
      row: 0,
    });
  });

  it("divides the circle by the board's own sector count", () => {
    // Mid-sector 3 (105°) is sector 3 of a 12-sector ring; the fixed 10°
    // division would have called the very same point sector 10.
    expect(pointToCell(TWELVE, atSectors(TWELVE, 15, 3.5))).toEqual({
      column: 1,
      row: 3,
    });
    expect(pointToCell(CIRCULAR, atSectors(TWELVE, 15, 3.5))).toEqual({
      column: 1,
      row: 10,
    });
  });

  it("wraps the seam of a shorter ring", () => {
    expect(pointToCell(TWELVE, polar(CENTER, CENTER, 15, 2 * Math.PI - 0.001))).toEqual({
      column: 1,
      row: 11,
    });
    expect(pointToCell(TWELVE, polar(CENTER, CENTER, 15, 0.001))).toEqual({
      column: 1,
      row: 0,
    });
  });
});

/* ------------------------------------------------------------------ */
/* pointToAnchor                                                       */
/* ------------------------------------------------------------------ */

describe("pointToAnchor", () => {
  it("reads the ink / space split of each axis (>= ratio is space)", () => {
    const ink = inkUnit(SQUARE);
    expect(pointToAnchor(SQUARE, { x: ink - 0.01, y: ink - 0.01 })).toEqual({
      column: 0,
      row: 0,
      zone: 0,
    });
    expect(pointToAnchor(SQUARE, { x: ink, y: 0 })).toEqual({ column: 0, row: 0, zone: 1 });
    expect(pointToAnchor(SQUARE, { x: 0, y: ink })).toEqual({ column: 0, row: 0, zone: 2 });
    expect(pointToAnchor(SQUARE, { x: ink, y: ink })).toEqual({ column: 0, row: 0, zone: 3 });
  });

  it("tags all four zones with their cell", () => {
    const zones: Zone[] = [0, 1, 2, 3];
    for (const zone of zones) {
      const rect = zoneRect(SQUARE, 1, 2, zone);
      const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      expect(pointToAnchor(SQUARE, centre)).toEqual({ column: 1, row: 2, zone });
    }
  });

  it("keeps the four zones distinct in the equal 1:1 cell", () => {
    for (const zone of [0, 1, 2, 3] as Zone[]) {
      const rect = zoneRect(EQUAL, 0, 0, zone);
      const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      expect(pointToAnchor(EQUAL, centre)).toEqual({ column: 0, row: 0, zone });
    }
    // The ink edge belongs to the space side (`>= ratio`), like every preset.
    expect(pointToAnchor(EQUAL, { x: inkUnit(EQUAL), y: 0 })).toEqual({
      column: 0,
      row: 0,
      zone: 1,
    });
  });

  it("splits the circular band and sector the same way", () => {
    // Mid-band / mid-sector is the ink fragment…
    expect(pointToAnchor(CIRCULAR, at(25, 0.3))).toEqual({ column: 2, row: 0, zone: 0 });
    // …the outer radial fifth is radial space…
    expect(pointToAnchor(CIRCULAR, at(29, 0.3))).toEqual({ column: 2, row: 0, zone: 1 });
    // …the trailing angular fifth is angular space…
    expect(pointToAnchor(CIRCULAR, at(25, 0.9))).toEqual({ column: 2, row: 0, zone: 2 });
    // …and both together are zone 3.
    expect(pointToAnchor(CIRCULAR, at(29, 0.9))).toEqual({ column: 2, row: 0, zone: 3 });
  });

  it("keeps all four circular zones reachable in the equal 1:1 cell", () => {
    const zones = [
      at(22, 0.2), // inner radius, leading half of the sector → ink / ink
      at(28, 0.2), // outer radius → radial space
      at(22, 0.7), // trailing half of the sector → angular space
      at(28, 0.7), // both
    ].map((point) => pointToAnchor(CIRCULAR_EQUAL, point).zone);
    expect(zones).toEqual([0, 1, 2, 3]);
    // Past the band's mid-radius the fragment is radial space at 1:1, and the
    // trailing half of the sector is angular space.
    expect(pointToAnchor(CIRCULAR_EQUAL, at(26, 0.3))).toEqual({
      column: 2,
      row: 0,
      zone: 1,
    });
  });

  it("splits the band and sector of the board's own ring", () => {
    // The ink / space rule is angle-independent, so the zones land the same
    // way on a 12-sector ring — only the sector index follows the board.
    expect(pointToAnchor(TWELVE, atSectors(TWELVE, 25, 3.3))).toEqual({
      column: 2,
      row: 3,
      zone: 0,
    });
    expect(pointToAnchor(TWELVE, atSectors(TWELVE, 29, 3.3))).toEqual({
      column: 2,
      row: 3,
      zone: 1,
    });
    expect(pointToAnchor(TWELVE, atSectors(TWELVE, 25, 3.9))).toEqual({
      column: 2,
      row: 3,
      zone: 2,
    });
    expect(pointToAnchor(TWELVE, atSectors(TWELVE, 29, 3.9))).toEqual({
      column: 2,
      row: 3,
      zone: 3,
    });
  });
});

/* ------------------------------------------------------------------ */
/* cellCentre / anchorToCell                                           */
/* ------------------------------------------------------------------ */

describe("anchorToCell", () => {
  it("drops the zone", () => {
    const anchor: Anchor = { column: 2, row: 3, zone: 3 };
    expect(anchorToCell(anchor)).toEqual({ column: 2, row: 3 });
  });
});

describe("cellCentre", () => {
  const cell = cellSize(SQUARE);
  const ink = inkUnit(SQUARE);

  it("sits at the centre of the ink square", () => {
    expect(cellCentre(SQUARE, { column: 0, row: 0 })).toEqual({ x: ink / 2, y: ink / 2 });
    expect(cellCentre(SQUARE, { column: 2, row: 3 })).toEqual({
      x: 2 * cell + ink / 2,
      y: 3 * cell + ink / 2,
    });
  });

  it("is the ink-square centre in the equal 1:1 cell too", () => {
    const half = inkUnit(EQUAL) / 2;
    expect(cellCentre(EQUAL, { column: 0, row: 0 })).toEqual({ x: half, y: half });
    expect(cellCentre(EQUAL, { column: 2, row: 3 })).toEqual({
      x: 2 * cellSize(EQUAL) + half,
      y: 3 * cellSize(EQUAL) + half,
    });
  });

  it("uses the band mid-radius and the sector mid-angle on the polar grid", () => {
    const config = makeConfig({ gridType: "circular", base: 20 });
    const band = cellSize(config);
    const bandInk = inkUnit(config);
    const centre = cellCentre(config, { column: 3, row: 6 });
    const radius = 3 * band + bandInk / 2;
    const expected = polar(CENTER, CENTER, radius, 6.5 * CIRCULAR_ANGULAR_UNIT);
    expect(centre.x).toBeCloseTo(expected.x, 9);
    expect(centre.y).toBeCloseTo(expected.y, 9);
    expect(Math.hypot(centre.x - CENTER, centre.y - CENTER)).toBeCloseTo(radius, 6);
  });
});

/* ------------------------------------------------------------------ */
/* line points                                                         */
/* ------------------------------------------------------------------ */

describe("linePointPosition", () => {
  it("puts a point without an anchor exactly on the cell centre", () => {
    // The back-compat pin: a document written before anchors existed must
    // render on the same pixels.
    expect(linePointPosition(SQUARE, { column: 2, row: 3 })).toEqual(
      cellCentre(SQUARE, { column: 2, row: 3 }),
    );
    expect(linePointPosition(CIRCULAR, { column: 3, row: 6 })).toEqual(
      cellCentre(CIRCULAR, { column: 3, row: 6 }),
    );
  });

  it("puts the explicit centre exactly there too, however it is written", () => {
    const centre = { x: 0.5, y: 0.5 };
    expect(linePointPosition(SQUARE, { column: 2, row: 3, anchor: centre })).toEqual(
      cellCentre(SQUARE, { column: 2, row: 3 }),
    );
    expect(linePointPosition(CIRCULAR, { column: 3, row: 6, anchor: centre })).toEqual(
      cellCentre(CIRCULAR, { column: 3, row: 6 }),
    );
  });

  it("spreads the nine anchors evenly over the ink square", () => {
    const cell = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    const at0 = linePointPosition(SQUARE, {
      column: 1,
      row: 2,
      anchor: { x: 0, y: 0 },
    });
    const at1 = linePointPosition(SQUARE, {
      column: 1,
      row: 2,
      anchor: { x: 1, y: 1 },
    });
    // The ink origin of the **drawn** cell is its top-left corner…
    expect(at0).toEqual({ x: cell, y: 2 * cell });
    // …its far corner is one ink away, in half-ink steps between.
    expect(at1).toEqual({ x: cell + ink, y: 2 * cell + ink });
    expect(
      linePointPosition(SQUARE, { column: 1, row: 2, anchor: { x: 0.5, y: 0 } }),
    ).toEqual({ x: cell + ink / 2, y: 2 * cell });
    expect(
      linePointPosition(SQUARE, { column: 1, row: 2, anchor: { x: 0, y: 1 } }),
    ).toEqual({ x: cell, y: 2 * cell + ink });
  });

  it("reads the circular anchor in the sector's own frame", () => {
    const config = makeConfig({ gridType: "circular", base: 20 });
    const cell = cellSize(config);
    const ink = inkUnit(config);
    const origin = linePointPosition(config, {
      column: 3,
      row: 6,
      anchor: { x: 0, y: 0 },
    });
    const expected = at(3 * cell, 6);
    expect(origin.x).toBeCloseTo(expected.x, 9);
    expect(origin.y).toBeCloseTo(expected.y, 9);
    // x runs outwards along the radius, y around the sector: the far corner of
    // the ink region is one ink-thickness out and one whole sector round.
    const far = linePointPosition(config, {
      column: 3,
      row: 6,
      anchor: { x: 1, y: 1 },
    });
    const farExpected = at(3 * cell + ink, 7);
    expect(far.x).toBeCloseTo(farExpected.x, 9);
    expect(far.y).toBeCloseTo(farExpected.y, 9);
  });
});

describe("pointToLinePoint", () => {
  it("round-trips every anchor of the square grid", () => {
    for (const cell of [
      { column: 0, row: 0 },
      { column: 4, row: 7 },
    ]) {
      for (const anchor of ANCHOR_GRID) {
        // An ink origin on an interior cell sits exactly on that cell's
        // leading border, and the drawn cell size is not a binary fraction
        // (§1), so its computed position can floor into the previous cell by
        // one ulp. A real pointer is never exactly on a border; the origin
        // is nudged the same hair inside its own cell.
        const point = linePointPosition(SQUARE, { ...cell, anchor });
        // The zone convention is half-open, so a point exactly on a fragment
        // border addresses the neighbouring (space) square: a real pointer
        // never is, so an edge anchor is nudged a hair inside its fragment.
        const nudge = (index: number, edge: number) => {
          if (edge === 1) return -1e-6;
          if (edge === 0 && index > 0) return 1e-6;
          return 0;
        };
        expect(
          pointToLinePoint(SQUARE, {
            x: point.x + nudge(cell.column, anchor.x),
            y: point.y + nudge(cell.row, anchor.y),
          }),
        ).toEqual(linePoint(cell.column, cell.row, undefined, anchor));
      }
    }
  });

  it("round-trips the anchors that are not on a cell boundary", () => {
    // The radial origin of a band sits on the boundary between two cells, and
    // the circular addressing goes through `atan2`/`hypot`: there the last bit
    // decides which of the two equally-correct addresses comes back. The
    // *position* is identical either way (that is the point), only the address
    // may flip, so the round-trip is pinned away from cell boundaries.
    const config = makeConfig({ gridType: "circular", base: 20 });
    for (const x of [0.5, 1]) {
      const anchor = { x, y: 0.5 };
      expect(
        pointToLinePoint(config, linePointPosition(config, { column: 3, row: 6, anchor })),
      ).toEqual(linePoint(3, 6, undefined, anchor));
    }
  });

  it("snaps to the nearest anchor inside the fragment under the cursor", () => {
    const cell = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    // 1/8 into the ink: the nearest anchor is the origin.
    expect(pointToLinePoint(SQUARE, { x: ink / 8, y: ink / 8 })).toEqual({
      column: 0,
      row: 0,
      anchor: { x: 0, y: 0 },
    });
    // 3/8: the nearest is the middle — which the model canonicalises to the
    // point without an anchor, exactly as it always stored a centre point.
    expect(pointToLinePoint(SQUARE, { x: (3 * ink) / 8, y: (3 * ink) / 8 })).toEqual(
      linePoint(0, 0, undefined, { x: 0.5, y: 0.5 }),
    );
    // The space strip is a fragment of its own: the pointer snaps to one of
    // its nine anchors, measured inside that square — it does not snap across
    // into the ink edge.
    const spaceMiddle = ink + (cell - ink) / 2;
    expect(pointToLinePoint(SQUARE, { x: spaceMiddle, y: 2 * cell })).toEqual({
      column: 0,
      row: 2,
      zone: 1,
      anchor: { x: 0.5, y: 0 },
    });
    // …and a point exactly on a cell border belongs to the higher cell.
    expect(pointToLinePoint(SQUARE, { x: cell, y: 2 * cell })).toEqual({
      column: 1,
      row: 2,
      anchor: { x: 0, y: 0 },
    });
  });

  it("uses the fragment centre in smart mode, ignoring the nearest anchor", () => {
    const ink = inkUnit(SQUARE);
    // A precise click 1/8 into the ink snaps to the corner; smart mode keeps
    // the same fragment but stores the centre (canonical absence of an anchor).
    expect(pointToLinePoint(SQUARE, { x: ink / 8, y: ink / 8 })).toEqual(
      linePoint(0, 0, undefined, { x: 0, y: 0 }),
    );
    expect(pointToLinePoint(SQUARE, { x: ink / 8, y: ink / 8 }, true)).toEqual(
      linePoint(0, 0),
    );
    // A space fragment stays that space fragment; only its inner point moves.
    const cell = cellSize(SQUARE);
    const spaceMiddle = ink + (cell - ink) / 2;
    expect(
      pointToLinePoint(SQUARE, { x: spaceMiddle, y: 2 * cell }, true),
    ).toEqual(linePoint(0, 2, 1));
  });

  it("rounds a tie towards the higher anchor", () => {
    const ink = inkUnit(SQUARE);
    // ¼ of the ink is exactly between 0 and ½: ½ wins.
    expect(pointToLinePoint(SQUARE, { x: ink / 4, y: 0 })).toEqual({
      column: 0,
      row: 0,
      anchor: { x: 0.5, y: 0 },
    });
    // ¾ is between ½ and 1: 1 wins.
    expect(pointToLinePoint(SQUARE, { x: (3 * ink) / 4, y: 0 })).toEqual({
      column: 0,
      row: 0,
      anchor: { x: 1, y: 0 },
    });
  });

  it("snaps in the circular frame of the cell under the cursor", () => {
    const config = makeConfig({ gridType: "circular", base: 20 });
    // The cell centre (mid-sector angle) is the centre point.
    expect(pointToLinePoint(config, cellCentre(config, { column: 3, row: 6 }))).toEqual(
      { column: 3, row: 6 },
    );
    // 0.9 of the sector is past the ink's angular share: the point is on the
    // space slice, so `y` is measured inside *that* slice (0.6 of it → ½).
    expect(pointToLinePoint(config, at(67.5, 6.9))).toEqual(
      linePoint(3, 6, 2),
    );
  });

  it("takes the mid-angle from the board's own sector count", () => {
    const config = makeConfig({ gridType: "circular", base: 20, circularSectors: 8 });
    const centre = cellCentre(config, { column: 3, row: 2 });
    const expected = atSectors(
      config,
      3 * cellSize(config) + inkUnit(config) / 2,
      2.5,
    );
    expect(centre.x).toBeCloseTo(expected.x, 9);
    expect(centre.y).toBeCloseTo(expected.y, 9);
  });
});

describe("line points on space fragments", () => {
  it("maps a square point onto its own fragment's box", () => {
    // Every fragment, ink or space: the anchor's fractions are measured inside
    // that fragment's own rect. Ink points reproduce the pre-fragment pixels.
    for (const zone of [0, 1, 2, 3] as Zone[]) {
      const rect = zoneRect(SQUARE, 4, 7, zone);
      const position = linePointPosition(
        SQUARE,
        linePoint(4, 7, zone, { x: 0.5, y: 1 }),
      );
      expect(position.x).toBeCloseTo(rect.x + rect.w / 2, 12);
      expect(position.y).toBeCloseTo(rect.y + rect.h, 12);
    }
    // …and the addressing from a fragment's centre names that fragment again.
    for (const zone of [0, 1, 2, 3] as Zone[]) {
      const rect = zoneRect(SQUARE, 4, 7, zone);
      const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      expect(pointToLinePoint(SQUARE, centre)).toEqual(linePoint(4, 7, zone));
    }
  });

  it("maps a circular point onto its own slice", () => {
    const unit = circularAngularUnit(CIRCULAR);
    for (const zone of [0, 1, 2, 3] as Zone[]) {
      const slice = circularSlice(CIRCULAR, 3, 6, zone);
      const position = linePointPosition(CIRCULAR, linePoint(3, 6, zone));
      // The radius spans the fragment's radial band…
      const radius = (slice.r1 + slice.r2) / 2;
      // …and the angle spans the whole sector for an ink-angular point (the
      // pre-fragment rule) or the space slice for a space-angular one.
      const angle =
        (zone & 2) !== 0 ? (slice.a1 + slice.a2) / 2 : 6.5 * unit;
      const expected = polar(CENTER, CENTER, radius, angle);
      expect(position.x).toBeCloseTo(expected.x, 12);
      expect(position.y).toBeCloseTo(expected.y, 12);
      expect(pointToLinePoint(CIRCULAR, position)).toEqual(
        linePoint(3, 6, zone),
      );
    }
  });

  it("keeps an anchored space point on its own square at the equal 1:1", () => {
    // All four quadrants are congruent here, so this is where a snap across
    // into the ink half would be most visible (and was the reported bug).
    for (const zone of [0, 1, 2, 3] as Zone[]) {
      const rect = zoneRect(EQUAL, 0, 0, zone);
      const point = linePoint(0, 0, zone, { x: 0, y: 1 });
      const position = linePointPosition(EQUAL, point);
      expect(position.x).toBeCloseTo(rect.x, 12);
      expect(position.y).toBeCloseTo(rect.y + rect.h, 12);
    }
    for (const zone of [0, 1, 2, 3] as Zone[]) {
      const rect = zoneRect(EQUAL, 0, 0, zone);
      expect(
        pointToLinePoint(EQUAL, {
          x: rect.x + rect.w / 2,
          y: rect.y + rect.h / 2,
        }),
      ).toEqual(linePoint(0, 0, zone));
    }
  });
});

describe("pointToArcPoint", () => {
  it("keeps the centre the line point drops", () => {
    const cell = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    const centre = { x: cell + ink / 2, y: 2 * cell + ink / 2 };
    // The line point canonicalises the centre away…
    expect(pointToLinePoint(SQUARE, centre)).toEqual({ column: 1, row: 2 });
    // …the arc endpoint stores it: absence means the legacy spring point.
    expect(pointToArcPoint(SQUARE, centre)).toEqual({
      column: 1,
      row: 2,
      anchor: { x: 0.5, y: 0.5 },
    });
  });

  it("resolves the same nine anchors the line point does", () => {
    const cell = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    // A fragment border is half-open, so an edge anchor is nudged a hair
    // inside the ink square it belongs to (a real pointer never lands on it).
    const along = (fraction: number) =>
      fraction === 1 ? ink - 1e-6 : fraction * ink;
    for (const anchor of ANCHOR_GRID) {
      const point = {
        x: cell + along(anchor.x),
        y: 2 * cell + along(anchor.y),
      };
      expect(pointToArcPoint(SQUARE, point)).toEqual({
        column: 1,
        row: 2,
        anchor,
      });
      expect(pointToLinePoint(SQUARE, point)).toEqual(
        linePoint(1, 2, undefined, anchor),
      );
    }
  });

  it("keeps a pointer in the space strip on that space fragment", () => {
    // The merged point model is zone-aware: an arc endpoint on the space strip
    // stores `zone: 1`, never a clamped ink edge (that was the pre-zone rule).
    const cell = cellSize(SQUARE);
    const ink = inkUnit(SQUARE);
    const spaceMiddle = ink + (cell - ink) / 2;
    expect(pointToArcPoint(SQUARE, { x: spaceMiddle, y: 2 * cell })).toEqual({
      column: 0,
      row: 2,
      zone: 1,
      anchor: { x: 0.5, y: 0 },
    });
  });
});

describe("smartArcPoints", () => {
  it("puts a same-row chord on the bottom or top middle by direction", () => {
    const from = linePoint(1, 1);
    const to = linePoint(4, 1);
    expect(smartArcPoints(from, to, "clockwise")).toEqual({
      from: { column: 1, row: 1, anchor: { x: 0.5, y: 1 } },
      to: { column: 4, row: 1, anchor: { x: 0.5, y: 1 } },
    });
    expect(smartArcPoints(from, to, "counterclockwise")).toEqual({
      from: { column: 1, row: 1, anchor: { x: 0.5, y: 0 } },
      to: { column: 4, row: 1, anchor: { x: 0.5, y: 0 } },
    });
  });

  it("puts a same-column chord on the left or right middle by direction", () => {
    const from = linePoint(1, 1);
    const to = linePoint(1, 4);
    expect(smartArcPoints(from, to, "clockwise")).toEqual({
      from: { column: 1, row: 1, anchor: { x: 0, y: 0.5 } },
      to: { column: 1, row: 4, anchor: { x: 0, y: 0.5 } },
    });
    expect(smartArcPoints(from, to, "counterclockwise")).toEqual({
      from: { column: 1, row: 1, anchor: { x: 1, y: 0.5 } },
      to: { column: 1, row: 4, anchor: { x: 1, y: 0.5 } },
    });
  });

  it("uses both fragment centres for a diagonal chord", () => {
    expect(
      smartArcPoints(linePoint(1, 1), linePoint(4, 4), "clockwise"),
    ).toEqual({
      from: { column: 1, row: 1, anchor: { x: 0.5, y: 0.5 } },
      to: { column: 4, row: 4, anchor: { x: 0.5, y: 0.5 } },
    });
  });

  it("keeps each endpoint's own fragment, zone included", () => {
    expect(
      smartArcPoints(linePoint(1, 1, 3), linePoint(4, 1, 2), "clockwise"),
    ).toEqual({
      from: { column: 1, row: 1, zone: 3, anchor: { x: 0.5, y: 1 } },
      to: { column: 4, row: 1, zone: 2, anchor: { x: 0.5, y: 1 } },
    });
  });

  it("falls back to the centre for a same-cell pair", () => {
    expect(
      smartArcPoints(linePoint(2, 3), linePoint(2, 3), "clockwise"),
    ).toEqual({
      from: { column: 2, row: 3, anchor: { x: 0.5, y: 0.5 } },
      to: { column: 2, row: 3, anchor: { x: 0.5, y: 0.5 } },
    });
  });
});

/* ------------------------------------------------------------------ */
/* runs                                                                */
/* ------------------------------------------------------------------ */

describe("isSameAxis", () => {
  it("is true when a column or a row is shared", () => {
    expect(isSameAxis({ column: 1, row: 2 }, { column: 1, row: 9 })).toBe(true);
    expect(isSameAxis({ column: 1, row: 2 }, { column: 7, row: 2 })).toBe(true);
    expect(isSameAxis({ column: 1, row: 2 }, { column: 7, row: 9 })).toBe(false);
    expect(isSameAxis({ column: 3, row: 4 }, { column: 3, row: 4 })).toBe(true);
  });
});

describe("runOf", () => {
  it("describes a row, a column and everything mixed", () => {
    expect(
      runOf([
        { column: 4, row: 3 },
        { column: 2, row: 3 },
        { column: 5, row: 3 },
      ]),
    ).toEqual({ axis: "row", from: 2, to: 5 });
    expect(
      runOf([
        { column: 2, row: 9 },
        { column: 2, row: 4 },
      ]),
    ).toEqual({ axis: "column", from: 4, to: 9 });
    expect(
      runOf([
        { column: 2, row: 9 },
        { column: 3, row: 4 },
      ]),
    ).toEqual({ axis: null, from: 0, to: 0 });
    expect(runOf([])).toEqual({ axis: null, from: 0, to: 0 });
  });

  it("reads a single cell as a one-wide row", () => {
    expect(runOf([{ column: 2, row: 5 }])).toEqual({ axis: "row", from: 2, to: 2 });
  });
});

describe("cellsBetween", () => {
  it("sweeps a row inclusively", () => {
    expect(cellsBetween({ column: 0, row: 4 }, { column: 4, row: 4 })).toEqual([
      { column: 0, row: 4 },
      { column: 1, row: 4 },
      { column: 2, row: 4 },
      { column: 3, row: 4 },
      { column: 4, row: 4 },
    ]);
  });

  it("returns the same run whichever end the drag started from", () => {
    const forward = cellsBetween({ column: 0, row: 4 }, { column: 4, row: 4 });
    const backward = cellsBetween({ column: 4, row: 4 }, { column: 0, row: 4 });
    expect(backward).toEqual(forward);
  });

  it("sweeps a column inclusively", () => {
    expect(cellsBetween({ column: 2, row: 9 }, { column: 2, row: 4 })).toEqual([
      { column: 2, row: 4 },
      { column: 2, row: 5 },
      { column: 2, row: 6 },
      { column: 2, row: 7 },
      { column: 2, row: 8 },
      { column: 2, row: 9 },
    ]);
  });

  it("falls back to the two endpoints when the cells share no axis", () => {
    expect(cellsBetween({ column: 0, row: 0 }, { column: 2, row: 3 })).toEqual([
      { column: 0, row: 0 },
      { column: 2, row: 3 },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* gridPaths                                                           */
/* ------------------------------------------------------------------ */

/** The axis positions of a square-family path string (every line offset). */
function offsets(path: string): number[] {
  const out: number[] = [];
  for (const match of path.matchAll(/M ([\d.]+) 0 L [\d.]+ 1000/g)) {
    out.push(Number(match[1]));
  }
  for (const match of path.matchAll(/M 0 ([\d.]+) L 1000 [\d.]+/g)) {
    out.push(Number(match[1]));
  }
  return out;
}

describe("gridPaths (square)", () => {
  const cell = cellSize(SQUARE);
  const ink = inkUnit(SQUARE);
  const count = gridCount(SQUARE);
  const { cellBorders, inkLines } = gridPaths(SQUARE);

  it("draws a vertical and a horizontal border per cell start", () => {
    // `count` starts: the last cell's space is cropped, so nothing is clamped
    // onto the viewBox edge any more.
    expect(cellBorders.match(/M /g) ?? []).toHaveLength(count * 2);
    expect(cellBorders.startsWith(
      `M 0 0 L 0 1000 M 0 0 L 1000 0 M ${cell} 0 L ${cell} 1000 M 0 ${cell} L 1000 ${cell}`,
    )).toBe(true);
    expect(cellBorders.endsWith(
      `M ${(count - 1) * cell} 0 L ${(count - 1) * cell} 1000 M 0 ${(count - 1) * cell} L 1000 ${(count - 1) * cell}`,
    )).toBe(true);
    const lines = offsets(cellBorders);
    expect(lines).toHaveLength(count * 2);
    expect(Math.max(...lines)).toBeCloseTo((count - 1) * cell, 6);
  });

  it("closes every ink square, the last on the viewBox edge", () => {
    expect(inkLines.match(/M /g) ?? []).toHaveLength(count * 2);
    expect(inkLines.startsWith(
      `M ${ink} 0 L ${ink} 1000 M 0 ${ink} L 1000 ${ink}`,
    )).toBe(true);
    // The last inner line is the canvas edge: the canvas ends with ink.
    const edges = offsets(inkLines);
    expect(edges).toHaveLength(count * 2);
    expect(Math.max(...edges)).toBeCloseTo(VIEWBOX_SIZE, 6);
  });

  it("draws the inner family in the equal 1:1 cell too — and only that changes", () => {
    const equal = gridPaths(EQUAL);
    const count = gridCount(EQUAL);
    // One inner edge pair per drawn cell, the first at the ink thickness…
    expect(equal.inkLines.match(/M /g) ?? []).toHaveLength(count * 2);
    expect(equal.inkLines.startsWith(
      `M ${inkUnit(EQUAL)} 0 L ${inkUnit(EQUAL)} 1000 M 0 ${inkUnit(EQUAL)} L 1000 ${inkUnit(EQUAL)}`,
    )).toBe(true);
    // …and the last on the viewBox edge: the board ends with ink at 1:1 too.
    expect(Math.max(...offsets(equal.inkLines))).toBeCloseTo(VIEWBOX_SIZE, 6);
    // The outer family keeps its one-pair-per-cell construction.
    expect(equal.cellBorders.match(/M /g) ?? []).toHaveLength(count * 2);
  });
});

describe("gridPaths (circular)", () => {
  const cell = cellSize(CIRCULAR);
  const ink = inkUnit(CIRCULAR);
  const { cellBorders, inkLines } = gridPaths(CIRCULAR);

  it("draws a ring per band edge plus 36 spokes", () => {
    // Ring radii 1…49 drawn bands (two arcs each) and 36 spokes.
    expect(cellBorders.match(/ A /g) ?? []).toHaveLength(49 * 2);
    expect(cellBorders.match(/L /g) ?? []).toHaveLength(36);
    expect(cellBorders).toContain(`A ${f(cell)} ${f(cell)} 0 0 1`);
    expect(cellBorders).toContain(`A ${f(49 * cell)} ${f(49 * cell)} 0 0 1`);
    expect(cellBorders.startsWith(
      `M ${f(CENTER + cell)} 500 A ${f(cell)} ${f(cell)} 0 0 1 ${f(CENTER - cell)} 500 A ${f(cell)} ${f(cell)} 0 0 1 ${f(CENTER + cell)} 500`,
    )).toBe(true);
  });

  it("draws the inner rings and spokes at the ink offset of each band", () => {
    // Inner rings at 0.75·cell, 1.75·cell, … (50 of them) and 36 inner spokes.
    expect(inkLines.match(/ A /g) ?? []).toHaveLength(50 * 2);
    expect(inkLines.match(/L /g) ?? []).toHaveLength(36);
    expect(inkLines).toContain(`A ${f(ink)} ${f(ink)} 0 0 1`);
    // The last ring closes the design on radius 500 exactly.
    expect(inkLines).toContain("A 500 500 0 0 1");
  });

  it("draws the inner family in the equal 1:1 cell too — and only that changes", () => {
    const equal = gridPaths(CIRCULAR_EQUAL);
    const equalInk = inkUnit(CIRCULAR_EQUAL);
    // Inner rings at 0.5·cell, 1.5·cell, … (50 of them) and 36 inner spokes.
    expect(equal.inkLines.match(/ A /g) ?? []).toHaveLength(50 * 2);
    expect(equal.inkLines.match(/L /g) ?? []).toHaveLength(36);
    expect(equal.inkLines).toContain(`A ${f(equalInk)} ${f(equalInk)} 0 0 1`);
    // The last ring lands on the design circle: the board ends with ink too.
    expect(equal.inkLines).toContain("A 500 500 0 0 1");
  });
});

describe("gridPaths (circular)", () => {
  const cell = cellSize(CIRCULAR);
  const ink = inkUnit(CIRCULAR);
  const { cellBorders, inkLines } = gridPaths(CIRCULAR);

  it("draws a ring per band edge plus 36 spokes", () => {
    // Ring radii 1…49 drawn bands (two arcs each) and 36 spokes.
    expect(cellBorders.match(/ A /g) ?? []).toHaveLength(49 * 2);
    expect(cellBorders.match(/L /g) ?? []).toHaveLength(36);
    expect(cellBorders).toContain(`A ${f(cell)} ${f(cell)} 0 0 1`);
    expect(cellBorders).toContain(`A ${f(49 * cell)} ${f(49 * cell)} 0 0 1`);
    expect(cellBorders.startsWith(
      `M ${f(CENTER + cell)} 500 A ${f(cell)} ${f(cell)} 0 0 1 ${f(CENTER - cell)} 500 A ${f(cell)} ${f(cell)} 0 0 1 ${f(CENTER + cell)} 500`,
    )).toBe(true);
  });

  it("draws the inner rings and spokes at the ink offset of each band", () => {
    // Inner rings at 0.75·cell, 1.75·cell, … (50 of them) and 36 inner spokes.
    expect(inkLines.match(/ A /g) ?? []).toHaveLength(50 * 2);
    expect(inkLines.match(/L /g) ?? []).toHaveLength(36);
    expect(inkLines).toContain(`A ${f(ink)} ${f(ink)} 0 0 1`);
    // The last ring closes the design on radius 500 exactly.
    expect(inkLines).toContain("A 500 500 0 0 1");
  });

  it("draws the inner family in the equal 1:1 cell too — and only that changes", () => {
    const equal = gridPaths(CIRCULAR_EQUAL);
    const equalInk = inkUnit(CIRCULAR_EQUAL);
    // Inner rings at 0.5·cell, 1.5·cell, … (50 of them) and 36 inner spokes.
    expect(equal.inkLines.match(/ A /g) ?? []).toHaveLength(50 * 2);
    expect(equal.inkLines.match(/L /g) ?? []).toHaveLength(36);
    expect(equal.inkLines).toContain(`A ${f(equalInk)} ${f(equalInk)} 0 0 1`);
    // The last ring lands on the design circle: the board ends with ink too.
    expect(equal.inkLines).toContain("A 500 500 0 0 1");
  });

  it("draws one spoke per sector of the board", () => {
    for (const sectors of [8, 12, 72]) {
      const config = makeConfig({ gridType: "circular", circularSectors: sectors });
      const paths = gridPaths(config);
      // The rings never change with the angular division (49 bands, two arcs
      // each); only the spoke counts follow the board.
      expect((paths.cellBorders.match(/ A /g) ?? []).length).toBe(49 * 2);
      expect((paths.cellBorders.match(/L /g) ?? []).length).toBe(sectors);
      expect((paths.inkLines.match(/ A /g) ?? []).length).toBe(50 * 2);
      expect((paths.inkLines.match(/L /g) ?? []).length).toBe(sectors);
    }
  });
});

/* ------------------------------------------------------------------ */
/* a small integration check                                           */
/* ------------------------------------------------------------------ */

describe("addressing round trip", () => {
  it("maps every ink centre back to its own cell", () => {
    const cells: Cell[] = [
      { column: 0, row: 0 },
      { column: 4, row: 9 },
      { column: 49, row: 1 },
    ];
    for (const cell of cells) {
      expect(pointToCell(SQUARE, cellCentre(SQUARE, cell))).toEqual(cell);
    }
  });
});

/* ------------------------------------------------------------------ */
/* the drawn grid fills its extent                                     */
/* ------------------------------------------------------------------ */

describe("the drawn grid fills the board", () => {
  it("tiles the viewBox with `gridCount` cells for every stored base", () => {
    for (let base = 4; base <= 100; base++) {
      const config = makeConfig({ base });
      const count = gridCount(config);
      expect(count).toBe(Math.round(VIEWBOX_SIZE / base));
      // `count − 1` complete cells plus the last cell's ink cover the whole
      // viewBox, and the space-less cell is exact.
      expect(cellSize(config) * (count - 1 + config.ratio)).toBeCloseTo(
        VIEWBOX_SIZE,
        9,
      );
      expect((count - 1) * cellSize(config)).toBeLessThan(VIEWBOX_SIZE);
      if (config.ratio === 1) expect(cellSize(config) * count).toBeCloseTo(VIEWBOX_SIZE, 9);
    }
  });

  it("keeps the base-1:1 cell on bases that divide 1000", () => {
    for (const base of [4, 5, 8, 10, 20, 25, 40, 50, 100]) {
      expect(cellSize(makeConfig({ base, ratio: 1 }))).toBe(base);
    }
  });

  it("round-trips the first, a middle and the last cell of a cropped base", () => {
    const config = makeConfig({ base: 75 });
    const count = gridCount(config);
    expect(count).toBe(13);
    const last = count - 1;
    for (const index of [0, Math.floor(count / 2), last]) {
      const cell: Cell = { column: index, row: index };
      expect(pointToCell(config, cellCentre(config, cell))).toEqual(cell);
    }
    // A click on the last pixel of the board is the last cell, in its ink.
    expect(pointToAnchor(config, { x: VIEWBOX_SIZE - 1e-6, y: VIEWBOX_SIZE - 1e-6 })).toEqual({
      column: last,
      row: last,
      zone: 0,
    });
  });

  it("ends the construction walk on the viewBox edge — no sliver", () => {
    // The reported bug: base 75 drew 14 clamped borders and stopped the inner
    // family at 956.25, leaving a 25-unit space strip at the edge.
    const config = makeConfig({ base: 75 });
    const cell = cellSize(config);
    const { cellBorders, inkLines } = gridPaths(config);
    // No clamped sliver: the last border is the start of the last cell …
    const borders = offsets(cellBorders);
    expect(borders).toHaveLength(13 * 2);
    expect(Math.max(...borders)).toBeCloseTo(12 * cell, 6);
    expect(Math.max(...borders)).toBeLessThan(VIEWBOX_SIZE);
    // … and the ink family ends on the viewBox edge.
    const edges = offsets(inkLines);
    expect(edges).toHaveLength(13 * 2);
    expect(Math.max(...edges)).toBeCloseTo(VIEWBOX_SIZE, 6);
  });

  it("keeps a degenerate config finite", () => {
    for (const base of [0, -5, NaN, Infinity, -Infinity]) {
      const config = makeConfig({ base });
      expect(Number.isFinite(cellSize(config))).toBe(true);
      expect(cellSize(config)).toBeGreaterThan(0);
      expect(gridCount(config)).toBeGreaterThanOrEqual(1);
    }
    for (const ratio of [0, -1, NaN, Infinity]) {
      const config = makeConfig({ ratio });
      expect(Number.isFinite(cellSize(config))).toBe(true);
      expect(cellSize(config)).toBeGreaterThan(0);
    }
  });
});
