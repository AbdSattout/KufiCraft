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
  VIEWBOX_SIZE,
  cellSize,
  gridCount,
} from "@/lib/canvas/model";
import type { Anchor, Cell, ProjectConfig, Zone } from "@/lib/canvas/model";
import {
  CENTER,
  circularSlice,
  inkUnit,
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

/** The `fmt` in geometry.ts rounds to 1e-6; mirror it for path assertions. */
function f(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
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
  const cell = cellSize(SQUARE);
  const ink = inkUnit(SQUARE);

  it("sits at the centre of the ink square", () => {
    expect(cellCentre(SQUARE, { column: 0, row: 0 })).toEqual({ x: ink / 2, y: ink / 2 });
    expect(cellCentre(SQUARE, { column: 2, row: 3 })).toEqual({
      x: 2 * cell + ink / 2,
      y: 3 * cell + ink / 2,
    });
  });

  it("is the plain cell centre at ratio 1", () => {
    expect(cellCentre(MONO, { column: 0, row: 0 })).toEqual({ x: 5, y: 5 });
    expect(cellCentre(MONO, { column: 2, row: 3 })).toEqual({ x: 25, y: 35 });
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
    // base 10 → 100 drawn cells, so the cell is 1000/99.75 = 10.025063 and
    // the ink square 7.518797.
    expect(anchorPath(SQUARE, ink)).toBe(
      "M 10.025063 20.050125 L 17.54386 20.050125 L 17.54386 27.568922 L 10.025063 27.568922 Z",
    );
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

  it("drops the inner family — and only that — at ratio 1", () => {
    const mono = gridPaths(MONO);
    expect(mono.inkLines).toBe("");
    // The space-less cell is complete, so its far edge is a border like any
    // other — the only case where one lands on the viewBox edge.
    const lines = offsets(mono.cellBorders);
    expect(lines).toHaveLength((gridCount(MONO) + 1) * 2);
    expect(Math.max(...lines)).toBeCloseTo(VIEWBOX_SIZE, 6);
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

  it("adds the inner rings and spokes only when there is space", () => {
    // Inner rings at 0.75·cell, 1.75·cell, … (50 of them) and 36 inner spokes.
    expect(inkLines.match(/ A /g) ?? []).toHaveLength(50 * 2);
    expect(inkLines.match(/L /g) ?? []).toHaveLength(36);
    expect(inkLines).toContain(`A ${f(ink)} ${f(ink)} 0 0 1`);
    // The last ring closes the design on radius 500 exactly.
    expect(inkLines).toContain("A 500 500 0 0 1");
  });

  it("drops the inner family — and only that — at ratio 1", () => {
    const mono = gridPaths(CIRCULAR_MONO);
    expect(mono.inkLines).toBe("");
    // 50 complete bands of 10: the far edge at radius 500 is a border too.
    expect(mono.cellBorders.match(/ A /g) ?? []).toHaveLength(50 * 2);
    expect(mono.cellBorders).toContain("A 500 500 0 0 1");
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

  it("adds the inner rings and spokes only when there is space", () => {
    // Inner rings at 0.75·cell, 1.75·cell, … (50 of them) and 36 inner spokes.
    expect(inkLines.match(/ A /g) ?? []).toHaveLength(50 * 2);
    expect(inkLines.match(/L /g) ?? []).toHaveLength(36);
    expect(inkLines).toContain(`A ${f(ink)} ${f(ink)} 0 0 1`);
    // The last ring closes the design on radius 500 exactly.
    expect(inkLines).toContain("A 500 500 0 0 1");
  });

  it("drops the inner family — and only that — at ratio 1", () => {
    const mono = gridPaths(CIRCULAR_MONO);
    expect(mono.inkLines).toBe("");
    // 50 complete bands of 10: the far edge at radius 500 is a border too.
    expect(mono.cellBorders.match(/ A /g) ?? []).toHaveLength(50 * 2);
    expect(mono.cellBorders).toContain("A 500 500 0 0 1");
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
