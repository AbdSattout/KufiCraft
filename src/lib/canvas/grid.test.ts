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
  CIRCULAR_ANGULAR_UNIT,
  DEFAULT_PROJECT_CONFIG,
} from "@/lib/canvas/model";
import type { Anchor, Cell, ProjectConfig, Zone } from "@/lib/canvas/model";
import {
  CENTER,
  circularSlice,
  polar,
  rectPath,
  slicePath,
  zoneRect,
} from "@/lib/canvas/geometry";
import {
  anchorPath,
  anchorToCell,
  cellCentre,
  cellsBetween,
  gridPaths,
  isSameAxis,
  pointToAnchor,
  pointToCell,
  runOf,
} from "@/lib/canvas/grid";

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return { ...DEFAULT_PROJECT_CONFIG, base: 10, ...overrides };
}

const SQUARE = makeConfig();
const MONO = makeConfig({ ratio: 1 });
const CIRCULAR = makeConfig({ gridType: "circular" });
const CIRCULAR_MONO = makeConfig({ gridType: "circular", ratio: 1 });

/** A point on the polar grid: radius in viewBox units, angle in sectors. */
function at(radius: number, sectors: number): { x: number; y: number } {
  return polar(CENTER, CENTER, radius, sectors * CIRCULAR_ANGULAR_UNIT);
}

/* ------------------------------------------------------------------ */
/* pointToCell                                                         */
/* ------------------------------------------------------------------ */

describe("pointToCell", () => {
  it("floors each axis on the square grid", () => {
    expect(pointToCell(SQUARE, { x: 15, y: 25 })).toEqual({ column: 1, row: 2 });
    expect(pointToCell(SQUARE, { x: 0, y: 0 })).toEqual({ column: 0, row: 0 });
    // The right / bottom edge belongs to the next cell.
    expect(pointToCell(SQUARE, { x: 10, y: 10 })).toEqual({ column: 1, row: 1 });
    expect(pointToCell(SQUARE, { x: 9.999, y: 9.999 })).toEqual({ column: 0, row: 0 });
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
});

/* ------------------------------------------------------------------ */
/* pointToAnchor                                                       */
/* ------------------------------------------------------------------ */

describe("pointToAnchor", () => {
  it("reads the ink / space split of each axis (>= ratio is space)", () => {
    expect(pointToAnchor(SQUARE, { x: 7.49, y: 7.49 })).toEqual({
      column: 0,
      row: 0,
      zone: 0,
    });
    expect(pointToAnchor(SQUARE, { x: 7.5, y: 0 })).toEqual({ column: 0, row: 0, zone: 1 });
    expect(pointToAnchor(SQUARE, { x: 0, y: 7.5 })).toEqual({ column: 0, row: 0, zone: 2 });
    expect(pointToAnchor(SQUARE, { x: 7.5, y: 7.5 })).toEqual({ column: 0, row: 0, zone: 3 });
  });

  it("tags all four zones with their cell", () => {
    const zones: Zone[] = [0, 1, 2, 3];
    for (const zone of zones) {
      const rect = zoneRect(SQUARE, 1, 2, zone);
      const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      expect(pointToAnchor(SQUARE, centre)).toEqual({ column: 1, row: 2, zone });
    }
  });

  it("collapses every point to zone 0 at ratio 1", () => {
    for (const point of [
      { x: 7.5, y: 7.5 },
      { x: 9.999, y: 0 },
      { x: 0, y: 9.999 },
      { x: 25, y: 35 },
    ]) {
      expect(pointToAnchor(MONO, point).zone).toBe(0);
    }
    expect(pointToAnchor(MONO, { x: 9.999, y: 9.999 })).toEqual({
      column: 0,
      row: 0,
      zone: 0,
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

  it("makes the whole circular cell zone 0 at ratio 1", () => {
    for (const point of [at(29, 0.3), at(25, 0.9), at(29, 0.9)]) {
      expect(pointToAnchor(CIRCULAR_MONO, point).zone).toBe(0);
    }
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
  it("sits at the centre of the ink square", () => {
    expect(cellCentre(SQUARE, { column: 0, row: 0 })).toEqual({ x: 3.75, y: 3.75 });
    expect(cellCentre(SQUARE, { column: 2, row: 3 })).toEqual({ x: 23.75, y: 33.75 });
  });

  it("is the plain cell centre at ratio 1", () => {
    expect(cellCentre(MONO, { column: 0, row: 0 })).toEqual({ x: 5, y: 5 });
    expect(cellCentre(MONO, { column: 2, row: 3 })).toEqual({ x: 25, y: 35 });
  });

  it("uses the band mid-radius and the sector mid-angle on the polar grid", () => {
    const config = makeConfig({ gridType: "circular", base: 20 });
    const centre = cellCentre(config, { column: 3, row: 6 });
    const expected = polar(CENTER, CENTER, 3 * 20 + 7.5, 6.5 * CIRCULAR_ANGULAR_UNIT);
    expect(centre.x).toBeCloseTo(expected.x, 9);
    expect(centre.y).toBeCloseTo(expected.y, 9);
    // Mid-ink radius: 3·20 + 15/2 = 67.5.
    expect(Math.hypot(centre.x - CENTER, centre.y - CENTER)).toBeCloseTo(67.5, 6);
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
/* anchorPath                                                          */
/* ------------------------------------------------------------------ */

describe("anchorPath", () => {
  it("draws the zone rect of a square anchor", () => {
    const ink: Anchor = { column: 1, row: 2, zone: 0 };
    expect(anchorPath(SQUARE, ink)).toBe(rectPath(zoneRect(SQUARE, 1, 2, 0)));
    expect(anchorPath(SQUARE, ink)).toBe("M 10 20 L 17.5 20 L 17.5 27.5 L 10 27.5 Z");
    const corner: Anchor = { column: 1, row: 2, zone: 3 };
    expect(anchorPath(SQUARE, corner)).toBe(rectPath(zoneRect(SQUARE, 1, 2, 3)));
    expect(anchorPath(SQUARE, corner)).not.toBe(anchorPath(SQUARE, ink));
  });

  it("draws the annular slice of a circular anchor", () => {
    const anchor: Anchor = { column: 2, row: 1, zone: 1 };
    expect(anchorPath(CIRCULAR, anchor)).toBe(
      slicePath(circularSlice(CIRCULAR, 2, 1, 1)),
    );
    expect(anchorPath(CIRCULAR, anchor)).not.toBe("");
    for (const zone of [0, 3] as Zone[]) {
      expect(anchorPath(CIRCULAR, { column: 2, row: 1, zone })).not.toBe("");
    }
  });
});

/* ------------------------------------------------------------------ */
/* gridPaths                                                           */
/* ------------------------------------------------------------------ */

describe("gridPaths (square)", () => {
  const { cellBorders, inkLines } = gridPaths(SQUARE);

  it("draws a vertical and a horizontal border per cell edge", () => {
    // 101 edges on each axis, each as two lines.
    expect((cellBorders.match(/M /g) ?? []).length).toBe(101 * 2);
    expect(cellBorders.startsWith(
      "M 0 0 L 0 1000 M 0 0 L 1000 0 M 10 0 L 10 1000 M 0 10 L 1000 10",
    )).toBe(true);
    expect(cellBorders.endsWith(
      "M 1000 0 L 1000 1000 M 0 1000 L 1000 1000",
    )).toBe(true);
  });

  it("draws the inner family at index · base + ratio · base on both axes", () => {
    expect((inkLines.match(/M /g) ?? []).length).toBe(100 * 2);
    expect(inkLines.startsWith("M 7.5 0 L 7.5 1000 M 0 7.5 L 1000 7.5")).toBe(true);
    // The 2nd and 100th inner lines land on 17.5 and 997.5.
    expect(inkLines).toContain("M 17.5 0 L 17.5 1000");
    expect(inkLines).toContain("M 997.5 0 L 997.5 1000");
  });

  it("drops the inner family — and only that — at ratio 1", () => {
    const mono = gridPaths(MONO);
    expect(mono.inkLines).toBe("");
    expect(mono.cellBorders).toBe(cellBorders);
  });
});

describe("gridPaths (circular)", () => {
  const { cellBorders, inkLines } = gridPaths(CIRCULAR);

  it("draws a ring per band edge plus 36 spokes", () => {
    // Ring radii 10…490 (49 rings, two arcs each) and 36 spokes.
    expect((cellBorders.match(/ A /g) ?? []).length).toBe(49 * 2);
    expect((cellBorders.match(/L /g) ?? []).length).toBe(36);
    expect(cellBorders).toContain("A 10 10 0 0 1");
    expect(cellBorders).toContain("A 490 490 0 0 1");
    expect(cellBorders.startsWith("M 510 500 A 10 10 0 0 1 490 500 A 10 10 0 0 1 510 500")).toBe(true);
  });

  it("adds the inner rings and spokes only when there is space", () => {
    // Inner rings at 7.5, 17.5, … (50 of them) and 36 inner spokes.
    expect((inkLines.match(/ A /g) ?? []).length).toBe(50 * 2);
    expect((inkLines.match(/L /g) ?? []).length).toBe(36);
    expect(inkLines).toContain("A 7.5 7.5 0 0 1");
    expect(inkLines).toContain("A 497.5 497.5 0 0 1");
  });

  it("drops the inner family — and only that — at ratio 1", () => {
    const mono = gridPaths(CIRCULAR_MONO);
    expect(mono.inkLines).toBe("");
    expect(mono.cellBorders).toBe(cellBorders);
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
