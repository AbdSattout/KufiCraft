import { describe, expect, it } from "vitest";
import {
  CIRCULAR_ANGULAR_UNIT,
  CIRCULAR_SECTORS,
  DEFAULT_PROJECT_CONFIG,
} from "@/lib/canvas/model";
import type { ProjectConfig, CanvasItem, TileShape, ZoneQuadrant } from "@/lib/canvas/model";
import {
  archPath,
  circularSlice,
  itemPath,
  linePath,
  shapePath,
  slicePath,
  tilePath,
  zoneRect,
} from "@/lib/canvas/geometry";
import type { Point, Rect } from "@/lib/canvas/geometry";
import {
  cellCenter,
  isSameAxis,
  pointToAnchor,
  pointToCell,
  runOf,
} from "@/lib/canvas/grid";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const SHAPES: TileShape[] = [
  "square",
  "circle",
  "triangle",
  "quadrant",
  "semicircle",
  "hexagon",
  "arc",
  "hamza1",
  "hamza2",
];

const QUADRANTS: ZoneQuadrant[] = [0, 1, 2, 3];

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return { ...DEFAULT_PROJECT_CONFIG, ...overrides };
}

const TOKEN = /[MLAZ]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** The engine's public point type, aliased for the sampling helpers below. */
type Pt = Point;

/** Balanced SVG arc sampling (SVG 1.1 F.6.5 endpoint → centre conversion). */
function sampleArc(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx: number,
  ry: number,
  rotDeg: number,
  large: number,
  sweep: number,
  steps: number,
): Pt[] {
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  let rxs = rx * rx;
  let rys = ry * ry;
  const lambda = (x1p * x1p) / rxs + (y1p * y1p) / rys;
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
    rxs = rx * rx;
    rys = ry * ry;
  }
  const den = rxs * y1p * y1p + rys * x1p * x1p;
  let factor =
    den === 0
      ? 0
      : Math.sqrt(Math.max(0, (rxs * rys - rxs * y1p * y1p - rys * x1p * x1p) / den));
  if (large === sweep) factor = -factor;
  const cxp = (factor * (rx * y1p)) / ry;
  const cyp = (-factor * (ry * x1p)) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const theta1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
  const theta2 = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx);
  let dtheta = theta2 - theta1;
  if (sweep === 0 && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep === 1 && dtheta < 0) dtheta += 2 * Math.PI;
  const points: Pt[] = [];
  for (let step = 1; step <= steps; step++) {
    const angle = theta1 + (dtheta * step) / steps;
    points.push({
      x: cx + rx * Math.cos(angle) * cos - ry * Math.sin(angle) * sin,
      y: cy + rx * Math.cos(angle) * sin + ry * Math.sin(angle) * cos,
    });
  }
  return points;
}

/** Parses path data and returns the flattened polyline; throws when invalid. */
function flattenPath(d: string, perArc = 96): Pt[] {
  const tokens = d.match(TOKEN);
  const leftover = d.replace(TOKEN, "").replace(/[\s,]+/g, "");
  if (tokens === null || leftover !== "") {
    throw new Error(`unparsable path: ${d}`);
  }
  const points: Pt[] = [];
  let index = 0;
  let cx = 0;
  let cy = 0;
  const read = (): number => {
    const token = tokens[index++];
    if (token === undefined) throw new Error(`truncated path: ${d}`);
    return Number(token);
  };
  while (index < tokens.length) {
    const cmd = tokens[index++];
    if (cmd === "M" || cmd === "L") {
      cx = read();
      cy = read();
      points.push({ x: cx, y: cy });
    } else if (cmd === "A") {
      const rx = read();
      const ry = read();
      const rot = read();
      const large = read();
      const sweep = read();
      const x = read();
      const y = read();
      points.push(...sampleArc(cx, cy, x, y, rx, ry, rot, large, sweep, perArc));
      cx = x;
      cy = y;
    } else if (cmd !== "Z") {
      throw new Error(`unexpected command "${cmd}" in ${d}`);
    }
  }
  if (points.length < 3) throw new Error(`degenerate path: ${d}`);
  return points;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bbox(points: Pt[]): Box {
  const box: Box = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const point of points) {
    box.minX = Math.min(box.minX, point.x);
    box.minY = Math.min(box.minY, point.y);
    box.maxX = Math.max(box.maxX, point.x);
    box.maxY = Math.max(box.maxY, point.y);
  }
  return box;
}

function expectBoxCloseTo(box: Box, rect: Rect, eps = 0.5): void {
  expect(box.minX).toBeGreaterThan(rect.x - eps);
  expect(box.minY).toBeGreaterThan(rect.y - eps);
  expect(box.maxX).toBeLessThan(rect.x + rect.w + eps);
  expect(box.maxY).toBeLessThan(rect.y + rect.h + eps);
  expect(box.minX).toBeLessThan(rect.x + eps);
  expect(box.minY).toBeLessThan(rect.y + eps);
  expect(box.maxX).toBeGreaterThan(rect.x + rect.w - eps);
  expect(box.maxY).toBeGreaterThan(rect.y + rect.h - eps);
}

function radiusOf(config: ProjectConfig, point: Pt): number {
  return Math.hypot(point.x - 500, point.y - 500);
}

function angleOf(point: Pt): number {
  const angle = Math.atan2(point.y - 500, point.x - 500);
  return angle < 0 ? angle + 2 * Math.PI : angle;
}

/** Signed smallest difference between two angles. */
function angleDelta(a: number, b: number): number {
  let delta = (b - a) % (2 * Math.PI);
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/* ------------------------------------------------------------------ */
/* zones                                                               */
/* ------------------------------------------------------------------ */

describe("zoneRect", () => {
  it("splits every quadrant at ratio 0.5", () => {
    const config = makeConfig({ ratio: 0.5, base: 10 });
    expect(zoneRect(config, 0, 0, 0)).toEqual({ x: 0, y: 0, w: 5, h: 5 });
    expect(zoneRect(config, 0, 0, 1)).toEqual({ x: 5, y: 0, w: 5, h: 5 });
    expect(zoneRect(config, 0, 0, 2)).toEqual({ x: 0, y: 5, w: 5, h: 5 });
    expect(zoneRect(config, 0, 0, 3)).toEqual({ x: 5, y: 5, w: 5, h: 5 });
  });

  it("splits every quadrant at ratio 0.75 (the old 1/4 : 3/4)", () => {
    const config = makeConfig({ ratio: 0.75, base: 10 });
    expect(zoneRect(config, 0, 0, 0)).toEqual({ x: 0, y: 0, w: 7.5, h: 7.5 });
    expect(zoneRect(config, 0, 0, 1)).toEqual({ x: 7.5, y: 0, w: 2.5, h: 7.5 });
    expect(zoneRect(config, 0, 0, 2)).toEqual({ x: 0, y: 7.5, w: 7.5, h: 2.5 });
    expect(zoneRect(config, 0, 0, 3)).toEqual({ x: 7.5, y: 7.5, w: 2.5, h: 2.5 });
  });

  it("offsets by the cell position", () => {
    const config = makeConfig({ ratio: 0.25, base: 20 });
    expect(zoneRect(config, 2, 3, 0)).toEqual({ x: 40, y: 60, w: 5, h: 5 });
    expect(zoneRect(config, 2, 3, 3)).toEqual({ x: 45, y: 65, w: 15, h: 15 });
  });
});

describe("circularSlice", () => {
  const config = makeConfig({ gridType: "circular", ratio: 0.75, base: 10 });

  it("places the zones in radial / angular space", () => {
    const ink = circularSlice(config, 1, 0, 0);
    expect(ink).toEqual({
      cx: 500,
      cy: 500,
      r1: 10,
      r2: 17.5,
      a1: 0,
      a2: 0.75 * CIRCULAR_ANGULAR_UNIT,
    });
    const radialSpace = circularSlice(config, 1, 0, 1);
    expect(radialSpace.r1).toBeCloseTo(17.5, 9);
    expect(radialSpace.r2).toBeCloseTo(20, 9);
    const angularSpace = circularSlice(config, 1, 0, 2);
    expect(angularSpace.a1).toBeCloseTo(0.75 * CIRCULAR_ANGULAR_UNIT, 9);
    expect(angularSpace.a2).toBeCloseTo(CIRCULAR_ANGULAR_UNIT, 9);
  });

  it("offsets by band and sector, including the last sector", () => {
    const slice = circularSlice(config, 2, CIRCULAR_SECTORS - 1, 0);
    expect(slice.r1).toBe(20);
    expect(slice.a1).toBeCloseTo((CIRCULAR_SECTORS - 1) * CIRCULAR_ANGULAR_UNIT, 9);
    expect(slice.a2).toBeCloseTo(
      (CIRCULAR_SECTORS - 1 + 0.75) * CIRCULAR_ANGULAR_UNIT,
      9,
    );
  });
});

describe("pointToAnchor / pointToCell / cellCenter", () => {
  it("round-trips the centre of every zone rect", () => {
    for (const ratio of [0.5, 0.75]) {
      const config = makeConfig({ ratio, base: 10 });
      for (const i of [0, 3, 57]) {
        for (const j of [0, 4, 99]) {
          for (const q of QUADRANTS) {
            const rect = zoneRect(config, i, j, q);
            const centre = {
              x: rect.x + rect.w / 2,
              y: rect.y + rect.h / 2,
            };
            expect(pointToAnchor(config, centre)).toEqual({ i, j, q });
          }
        }
      }
    }
  });

  it("reads the zone boundary exactly (>= ratio is the space zone)", () => {
    const config = makeConfig({ ratio: 0.5, base: 10 });
    expect(pointToAnchor(config, { x: 4.999, y: 2 })).toEqual({ i: 0, j: 0, q: 0 });
    expect(pointToAnchor(config, { x: 5, y: 2 })).toEqual({ i: 0, j: 0, q: 1 });
    expect(pointToAnchor(config, { x: 2, y: 5 })).toEqual({ i: 0, j: 0, q: 2 });
    expect(pointToAnchor(config, { x: 17.5, y: 27.5 })).toEqual({
      i: 1,
      j: 2,
      q: 3,
    });
  });

  it("round-trips cell centres and cells", () => {
    const config = makeConfig({ base: 20 });
    expect(cellCenter(config, 2, 3)).toEqual({ x: 50, y: 70 });
    for (const [i, j] of [
      [0, 0],
      [4, 9],
      [49, 1],
    ]) {
      const centre = cellCenter(config, i, j);
      expect(pointToCell(config, centre)).toEqual({ i, j });
    }
  });

  it("addresses circular bands and sectors, including wrap-around", () => {
    const config = makeConfig({ gridType: "circular", ratio: 0.5, base: 10 });
    for (const i of [0, 5, 49]) {
      for (const j of [0, 17, CIRCULAR_SECTORS - 1]) {
        const centre = cellCenter(config, i, j);
        expect(radiusOf(config, centre)).toBeCloseTo((i + 0.5) * 10, 6);
        expect(angleOf(centre)).toBeCloseTo((j + 0.5) * CIRCULAR_ANGULAR_UNIT, 6);
        expect(pointToCell(config, centre)).toEqual({ i, j });
      }
    }
    // A point just past 355° stays in the last sector, just before it in the first.
    const near = (angleDeg: number): Pt => ({
      x: 500 + 16 * Math.cos((angleDeg * Math.PI) / 180),
      y: 500 + 16 * Math.sin((angleDeg * Math.PI) / 180),
    });
    expect(pointToAnchor(config, near(-2))).toEqual({ i: 1, j: 35, q: 3 });
    expect(pointToAnchor(config, near(2))).toEqual({ i: 1, j: 0, q: 1 });
  });
});

describe("isSameAxis / runOf", () => {
  it("detects shared rows and columns", () => {
    expect(isSameAxis({ i: 1, j: 2 }, { i: 1, j: 9 })).toBe(true);
    expect(isSameAxis({ i: 1, j: 2 }, { i: 7, j: 2 })).toBe(true);
    expect(isSameAxis({ i: 1, j: 2 }, { i: 7, j: 9 })).toBe(false);
  });

  it("describes runs and rejects mixed input", () => {
    expect(runOf([{ i: 4, j: 3 }, { i: 2, j: 3 }, { i: 5, j: 3 }])).toEqual({
      axis: "row",
      from: 2,
      to: 5,
    });
    expect(runOf([{ i: 2, j: 9 }, { i: 2, j: 4 }])).toEqual({
      axis: "column",
      from: 4,
      to: 9,
    });
    expect(runOf([{ i: 2, j: 9 }, { i: 3, j: 4 }])).toEqual({
      axis: null,
      from: 0,
      to: 0,
    });
    expect(runOf([])).toEqual({ axis: null, from: 0, to: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* shapes                                                              */
/* ------------------------------------------------------------------ */

describe("shapePath", () => {
  const rects: Rect[] = [
    { x: 20, y: 30, w: 10, h: 10 },
    { x: 0, y: 0, w: 7.5, h: 2.5 },
    { x: 500, y: 500, w: 2.5, h: 7.5 },
  ];

  it("emits a parsable path whose bbox fills the zone rect", () => {
    for (const shape of SHAPES) {
      for (const rect of rects) {
        const d = shapePath(shape, rect, 0);
        const box = bbox(flattenPath(d));
        expectBoxCloseTo(box, rect);
      }
    }
  });

  it("keeps rotated shapes on square rects inside the rect", () => {
    const rect: Rect = { x: 100, y: 200, w: 10, h: 10 };
    for (const shape of SHAPES) {
      for (const rotation of [1, 2, 3]) {
        const box = bbox(flattenPath(shapePath(shape, rect, rotation)));
        expectBoxCloseTo(box, rect);
      }
    }
  });

  it("is deterministic and keeps the plain square as a 4 corner path", () => {
    const rect: Rect = { x: 20, y: 30, w: 10, h: 10 };
    const d = shapePath("square", rect, 0);
    expect(d).toBe(shapePath("square", rect, 0));
    expect(d).not.toContain("A");
    expect(flattenPath(d)).toHaveLength(4);
  });

  it("maps circles onto the inscribed ellipse", () => {
    const rect: Rect = { x: 20, y: 30, w: 10, h: 20 };
    const box = bbox(flattenPath(shapePath("circle", rect, 0)));
    expect(box.minX).toBeCloseTo(20, 3);
    expect(box.maxX).toBeCloseTo(30, 3);
    expect(box.minY).toBeCloseTo(30, 3);
    expect(box.maxY).toBeCloseTo(50, 3);
  });
});

describe("tilePath", () => {
  it("renders the zone rect shape on square grids", () => {
    const config = makeConfig({ ratio: 0.5, base: 10 });
    const tile = { t: "tile", k: "0:0:1", i: 0, j: 0, q: 1 } as const;
    expect(tilePath(config, tile)).toBe(
      shapePath("square", { x: 5, y: 0, w: 5, h: 5 }, 0),
    );
    expect(
      tilePath(config, { ...tile, s: "circle", r: 2 }),
    ).toBe(shapePath("circle", { x: 5, y: 0, w: 5, h: 5 }, 2));
  });

  it("renders annular sectors on circular grids", () => {
    const config = makeConfig({ gridType: "circular", ratio: 0.75, base: 10 });
    const tile = { t: "tile", k: "1:35:0", i: 1, j: CIRCULAR_SECTORS - 1, q: 0 } as const;
    expect(tilePath(config, tile)).toBe(slicePath(circularSlice(config, 1, 35, 0)));
    const points = flattenPath(tilePath(config, tile));
    for (const point of points) {
      expect(radiusOf(config, point)).toBeGreaterThan(10 - 1e-6);
      expect(radiusOf(config, point)).toBeLessThan(17.5 + 1e-6);
    }
  });

  it("fits other shapes inside the circular slice frame", () => {
    const config = makeConfig({ gridType: "circular", ratio: 0.75, base: 40 });
    const tile = { t: "tile", k: "4:8:3", i: 4, j: 8, q: 3, s: "triangle" } as const;
    const slice = circularSlice(config, 4, 8, 3);
    const points = flattenPath(tilePath(config, tile));
    for (const point of points) {
      const radius = radiusOf(config, point);
      expect(radius).toBeGreaterThan(slice.r1 - 1);
      expect(radius).toBeLessThan(slice.r2 + 1);
      const delta = angleDelta((slice.a1 + slice.a2) / 2, angleOf(point));
      expect(Math.abs(delta)).toBeLessThan(
        ((slice.a2 - slice.a1) / 2) * 1.2 + 1e-6,
      );
    }
  });
});

describe("linePath", () => {
  it("covers the inclusive cell run at full thickness", () => {
    const config = makeConfig({ ratio: 0.5, base: 10 });
    const box = bbox(
      flattenPath(linePath(config, { t: "line", k: "x", i1: 5, j1: 4, i2: 2, j2: 4 })),
    );
    expectBoxCloseTo(box, { x: 20, y: 40, w: 40, h: 10 }, 1e-6);
    const column = bbox(
      flattenPath(linePath(config, { t: "line", k: "x", i1: 3, j1: 2, i2: 3, j2: 7 })),
    );
    expectBoxCloseTo(column, { x: 30, y: 20, w: 10, h: 60 }, 1e-6);
  });

  it("spans circular sectors along the shortest path, wrapped", () => {
    const config = makeConfig({ gridType: "circular", ratio: 0.5, base: 10 });
    const points = flattenPath(
      linePath(config, { t: "line", k: "x", i1: 2, j1: 35, i2: 2, j2: 0 }),
    );
    for (const point of points) {
      expect(radiusOf(config, point)).toBeGreaterThan(20 - 1e-6);
      expect(radiusOf(config, point)).toBeLessThan(30 + 1e-6);
    }
    const angles = points.map(angleOf);
    const startAngle = 35 * CIRCULAR_ANGULAR_UNIT;
    const span = angles.map((angle) => angleDelta(startAngle, angle));
    expect(Math.min(...span)).toBeCloseTo(0, 3);
    expect(Math.max(...span)).toBeCloseTo(2 * CIRCULAR_ANGULAR_UNIT, 3);
  });

  it("covers every band of a radial run", () => {
    const config = makeConfig({ gridType: "circular", ratio: 0.5, base: 10 });
    const points = flattenPath(
      linePath(config, { t: "line", k: "x", i1: 1, j1: 4, i2: 3, j2: 4 }),
    );
    const radii = points.map((point) => radiusOf(config, point));
    expect(Math.min(...radii)).toBeCloseTo(10, 6);
    expect(Math.max(...radii)).toBeCloseTo(40, 6);
  });
});

describe("archPath", () => {
  it("draws a stroked rib through the two cell centres, bulging per d", () => {
    const config = makeConfig({ ratio: 0.75, base: 10 });
    const up = flattenPath(
      archPath(config, { t: "arch", k: "a", i1: 2, j1: 4, i2: 5, j2: 4, d: 0 }),
    );
    expect(up[0].x).toBeCloseTo(25, 6);
    expect(up[0].y).toBeCloseTo(45, 6);
    const upBox = bbox(up);
    // radius = (30 + 7.5) / 2 = 18.75, sagitta = 18.75 - sqrt(18.75² - 15²) = 7.5
    expect(upBox.minY).toBeCloseTo(37.5, 3);
    expect(upBox.maxY).toBeCloseTo(45, 6);
    const down = bbox(
      flattenPath(archPath(config, { t: "arch", k: "a", i1: 2, j1: 4, i2: 5, j2: 4, d: 1 })),
    );
    expect(down.maxY).toBeCloseTo(52.5, 3);
  });

  it("bulges left / right for vertical runs", () => {
    const config = makeConfig({ ratio: 0.75, base: 10 });
    const left = bbox(
      flattenPath(archPath(config, { t: "arch", k: "a", i1: 2, j1: 4, i2: 2, j2: 7, d: 0 })),
    );
    expect(left.minX).toBeCloseTo(17.5, 3);
    const right = bbox(
      flattenPath(archPath(config, { t: "arch", k: "a", i1: 2, j1: 4, i2: 2, j2: 7, d: 1 })),
    );
    expect(right.maxX).toBeCloseTo(32.5, 3);
  });

  it("walks the band mid-radius on circular grids", () => {
    const config = makeConfig({ gridType: "circular", ratio: 0.5, base: 10 });
    const points = flattenPath(
      archPath(config, { t: "arch", k: "a", i1: 3, j1: 0, i2: 3, j2: 2, d: 0 }),
    );
    for (const point of points) {
      expect(radiusOf(config, point)).toBeCloseTo(35, 3);
    }
    const span = points.map((point) => angleDelta(0.5 * CIRCULAR_ANGULAR_UNIT, angleOf(point)));
    expect(Math.min(...span)).toBeCloseTo(0, 3);
    expect(Math.max(...span)).toBeCloseTo(2 * CIRCULAR_ANGULAR_UNIT, 3);
  });
});

describe("itemPath", () => {
  const config = makeConfig({ ratio: 0.75, base: 10 });
  it("dispatches on the item discriminant", () => {
    const tile = { t: "tile", k: "t", i: 1, j: 2, q: 3 } as const;
    const line = { t: "line", k: "l", i1: 1, j1: 2, i2: 4, j2: 2 } as const;
    const arch = { t: "arch", k: "a", i1: 1, j1: 2, i2: 4, j2: 2, d: 1 } as const;
    expect(itemPath(config, tile)).toBe(tilePath(config, tile));
    expect(itemPath(config, line)).toBe(linePath(config, line));
    expect(itemPath(config, arch)).toBe(archPath(config, arch));
  });

  it("is pure: repeated calls return the same string", () => {
    const item: CanvasItem = {
      t: "tile",
      k: "t",
      i: 3,
      j: 4,
      q: 2,
      s: "hamza1",
    };
    expect(itemPath(config, item)).toBe(itemPath(config, item));
  });
});

describe("cellCenter on circular grids", () => {
  it("sits between the inner and outer edge of the band", () => {
    const config = makeConfig({ gridType: "circular", base: 20 });
    const centre = cellCenter(config, 3, 6);
    expect(radiusOf(config, centre)).toBeCloseTo(70, 6);
    expect(angleOf(centre)).toBeCloseTo(6.5 * CIRCULAR_ANGULAR_UNIT, 6);
  });
});
