/**
 * The ratio invariant of `docs/CANVAS.md` §2.
 *
 * The bug this suite locks down: `1:1` used to be the old app's space-less
 * «mono» cell (`ratio = 1`), so the ink fragment was the whole cell, the three
 * space fragments had zero width, and two same-zone neighbours touched at
 * `1:1` and at no other preset — switching the ratio broke the pattern's
 * connectivity. The rule now: a fragment's zone is visible at every preset,
 * and what touches depends only on cells and zones, never on the ratio.
 */

import { describe, expect, it } from "vitest";
import {
  CIRCULAR_ANGULAR_UNIT,
  DEFAULT_PROJECT_CONFIG,
  MAX_RATIO,
  MIN_RATIO,
  RATIO_PRESETS,
  cellSize,
  ratioLabel,
  snapRatio,
} from "@/lib/canvas/model";
import type { Cell, GridType, ProjectConfig, Zone } from "@/lib/canvas/model";
import {
  CENTER,
  circularSlice,
  inkUnit,
  polar,
  zoneRect,
} from "@/lib/canvas/geometry";
import type { Rect } from "@/lib/canvas/geometry";
import { pointToAnchor } from "@/lib/canvas/grid";

const ZONES: readonly Zone[] = [0, 1, 2, 3];
const EPS = 1e-9;
const BASE = 10;

function makeConfig(
  ratio: number,
  gridType: GridType = "square",
): ProjectConfig {
  return { ...DEFAULT_PROJECT_CONFIG, base: BASE, ratio, gridType };
}

/** Every preset at the same stored base — each at its own drawn cell size. */
const ALL = RATIO_PRESETS.map((preset) => ({
  preset,
  config: makeConfig(preset.ratio),
}));

/** True when two rects share an edge of positive length (not a corner). */
function touches(a: Rect, b: Rect): boolean {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const sharedVertical =
    Math.abs(a.x + a.w - b.x) < EPS || Math.abs(b.x + b.w - a.x) < EPS;
  const sharedHorizontal =
    Math.abs(a.y + a.h - b.y) < EPS || Math.abs(b.y + b.h - a.y) < EPS;
  return (sharedVertical && overlapY > EPS) || (sharedHorizontal && overlapX > EPS);
}

/** Contact of every zone pair of cell (0,0) against a neighbour cell. */
function contactMatrix(config: ProjectConfig, neighbour: Cell): boolean[] {
  return ZONES.flatMap((zoneA) =>
    ZONES.map((zoneB) =>
      touches(
        zoneRect(config, 0, 0, zoneA),
        zoneRect(config, neighbour.column, neighbour.row, zoneB),
      ),
    ),
  );
}

const NEIGHBOURS = [
  { bit: 1 as const, at: { column: 1, row: 0 }, label: "right" },
  { bit: 2 as const, at: { column: 0, row: 1 }, label: "below" },
];

describe("the four fragments of a cell", () => {
  it("has a positive, finite area at every preset — no degenerate fragment", () => {
    for (const { preset, config } of ALL) {
      const degenerate = ZONES.filter((zone) => {
        const rect = zoneRect(config, 3, 5, zone);
        const finite = Number.isFinite(rect.x + rect.y + rect.w + rect.h);
        return !(finite && rect.w > 0 && rect.h > 0);
      });
      expect({ preset: preset.label, degenerate }).toEqual({
        preset: preset.label,
        degenerate: [],
      });
    }
  });

  it("tiles the cell exactly and never collapses two zones onto one rect", () => {
    for (const { preset, config } of ALL) {
      const rects = ZONES.map((zone) => zoneRect(config, 2, 2, zone));
      const area = rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
      // The four fragments tile the drawn cell (`cellSize`, §1): their areas
      // add up to it, to within float noise.
      const round = (value: number) => Math.round(value * 1e6) / 1e6;
      expect({ preset: preset.label, area: round(area) }).toEqual({
        preset: preset.label,
        area: round(cellSize(config) ** 2),
      });
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i];
          const b = rects[j];
          const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          const overlapping = overlapX > EPS && overlapY > EPS;
          expect({ preset: preset.label, i, j, overlapping }).toEqual({
            preset: preset.label,
            i,
            j,
            overlapping: false,
          });
        }
      }
      // A zone is an identity: the four fragments are four different rects.
      expect(new Set(rects.map((rect) => JSON.stringify(rect))).size).toBe(
        rects.length,
      );
    }
  });

  it("splits the circular slice into four positive fragments that tile it", () => {
    for (const { preset, config } of ALL) {
      const circular = makeConfig(preset.ratio, "circular");
      expect(config.gridType).toBe("square");
      const slices = ZONES.map((zone) => circularSlice(circular, 3, 6, zone));
      for (const slice of slices) {
        expect(slice.r2 - slice.r1).toBeGreaterThan(0);
        expect(slice.a2 - slice.a1).toBeGreaterThan(0);
        expect(
          Number.isFinite(slice.r1 + slice.r2 + slice.a1 + slice.a2),
        ).toBe(true);
      }
      // Radial ink [3·cell, 3·cell + ink) then radial space
      // [3·cell + ink, 4·cell) on the drawn cell…
      const cell = cellSize(circular);
      expect(slices[0].r1).toBeCloseTo(3 * cell, 12);
      expect(slices[1].r1).toBe(slices[0].r2);
      expect(slices[1].r1).toBeGreaterThan(3 * cell);
      expect(slices[1].r2).toBeCloseTo(4 * cell, 12);
      // …and the same split on the angular axis, inside sector 6.
      expect(slices[2].a1).toBe(slices[0].a2);
      expect(slices[2].a1).toBeGreaterThan(6 * CIRCULAR_ANGULAR_UNIT);
      expect(slices[2].a2).toBeCloseTo(7 * CIRCULAR_ANGULAR_UNIT, 12);
      expect(slices[0].a1).toBe(6 * CIRCULAR_ANGULAR_UNIT);
    }
  });
});

describe("contact does not depend on the ratio", () => {
  it("gives the same contact matrix at every preset, horizontally and vertically", () => {
    for (const neighbour of NEIGHBOURS) {
      const reference = contactMatrix(ALL[0].config, neighbour.at);
      for (const { preset, config } of ALL) {
        expect({
          neighbour: neighbour.label,
          preset: preset.label,
          matrix: contactMatrix(config, neighbour.at),
        }).toEqual({
          neighbour: neighbour.label,
          preset: preset.label,
          matrix: reference,
        });
      }
      // …and the matrix is exactly what the zone bits say: the fragment that
      // reaches the shared boundary (its bit set — that side is space) against
      // the neighbour's fragment on the ink side of that boundary (bit clear),
      // and the other axis has to match, or only a corner touches.
      const other: 1 | 2 = neighbour.bit === 1 ? 2 : 1;
      const expected = ZONES.flatMap((zoneA) =>
        ZONES.map(
          (zoneB) =>
            (zoneA & neighbour.bit) !== 0 &&
            (zoneB & neighbour.bit) === 0 &&
            (zoneA & other) === (zoneB & other),
        ),
      );
      expect(reference).toEqual(expected);
      // Same-zone neighbours are never edge-connected — at any preset.
      for (const zone of ZONES) {
        expect(reference[zone * ZONES.length + zone]).toBe(false);
      }
    }
  });

  it("keeps a connected pair connected (space side against the ink side)", () => {
    for (const { preset, config } of ALL) {
      // Horizontal: the space half of the left cell against the ink half of
      // the right cell; vertical is the same with the y zones.
      const horizontal = touches(
        zoneRect(config, 0, 0, 1),
        zoneRect(config, 1, 0, 0),
      );
      const vertical = touches(
        zoneRect(config, 0, 0, 2),
        zoneRect(config, 0, 1, 0),
      );
      // Diagonal neighbours differ on both axes, so they only meet at a corner
      // — not at an edge, at any preset.
      const diagonal = touches(
        zoneRect(config, 0, 0, 3),
        zoneRect(config, 1, 1, 0),
      );
      expect({ preset: preset.label, horizontal, vertical, diagonal }).toEqual({
        preset: preset.label,
        horizontal: true,
        vertical: true,
        diagonal: false,
      });
    }
  });

  it("shares an edge inside a cell exactly when the zones differ in one bit", () => {
    for (const { preset, config } of ALL) {
      for (let i = 0; i < ZONES.length; i += 1) {
        for (let j = i + 1; j < ZONES.length; j += 1) {
          const zoneA = ZONES[i];
          const zoneB = ZONES[j];
          const oneBitApart = (zoneA ^ zoneB) === 1 || (zoneA ^ zoneB) === 2;
          const shared = touches(
            zoneRect(config, 0, 0, zoneA),
            zoneRect(config, 0, 0, zoneB),
          );
          expect({ preset: preset.label, zoneA, zoneB, shared }).toEqual({
            preset: preset.label,
            zoneA,
            zoneB,
            shared: oneBitApart,
          });
        }
      }
    }
  });
});

describe("a fragment's zone is visible at every ratio", () => {
  it("addresses every fragment back from its own centre (square grid)", () => {
    for (const { preset, config } of ALL) {
      for (const zone of ZONES) {
        const rect = zoneRect(config, 4, 7, zone);
        const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
        expect({
          preset: preset.label,
          zone,
          anchor: pointToAnchor(config, centre),
        }).toEqual({
          preset: preset.label,
          zone,
          anchor: { column: 4, row: 7, zone },
        });
      }
    }
  });

  it("addresses every fragment back from its own middle (polar grid)", () => {
    for (const { preset } of ALL) {
      const circular = makeConfig(preset.ratio, "circular");
      for (const zone of ZONES) {
        const slice = circularSlice(circular, 3, 6, zone);
        const point = polar(
          CENTER,
          CENTER,
          (slice.r1 + slice.r2) / 2,
          (slice.a1 + slice.a2) / 2,
        );
        expect({
          preset: preset.label,
          zone,
          anchor: pointToAnchor(circular, point),
        }).toEqual({
          preset: preset.label,
          zone,
          anchor: { column: 3, row: 6, zone },
        });
      }
    }
  });
});

describe("stored ratios from before the fix", () => {
  it("sends the old space-less 1:1 to the densest preset, never back to 1", () => {
    const densest = makeConfig(MAX_RATIO);
    expect(MAX_RATIO).toBeLessThan(1);
    expect(snapRatio(1)).toBe(MAX_RATIO);
    expect(ratioLabel(1)).toBe("1:5");
    // Even the densest preset keeps real space: no fragment fills the cell.
    expect(inkUnit(densest)).toBeLessThan(cellSize(densest));
  });

  it("reads a v1 «متساوية» 0.5 as the equal 1:1", () => {
    const equal = makeConfig(MIN_RATIO);
    expect(MIN_RATIO).toBe(1 / 2);
    expect(snapRatio(0.5)).toBe(MIN_RATIO);
    expect(ratioLabel(0.5)).toBe("1:1");
    expect(inkUnit(equal)).toBe(cellSize(equal) / 2);
  });
});
