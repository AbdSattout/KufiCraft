/**
 * The hand-authored compositions the landing page draws.
 *
 * Each piece is a small dataset in the same vocabulary the editor stores:
 * quadrant fragments of cells, merged bars, arcs and circular slices. The
 * square pieces are mapped out as ASCII grids so a figure can be read and
 * edited like the drawing it is — `.` is empty, every other symbol is one zone
 * fragment of that cell (see `LEGEND`).
 */

import type {
  FragmentShape,
  GridSpec,
  Item,
  Quadrant,
  RingItem,
  SliceItem,
  TileItem,
  Turn,
} from "./geometry";
import { SECTORS } from "./geometry";

export type Piece = {
  id: string;
  /** Arabic name of the piece, used in captions and accessible labels. */
  name: string;
  /** The build the piece was drawn with, printed under it. */
  note: string;
  spec: GridSpec;
  ratio: number;
  items: Item[];
};

type Cell = { q: Quadrant; shape?: FragmentShape; turn?: Turn };

const LEGEND: Record<string, Cell> = {
  "#": { q: 0 },
  "1": { q: 1 },
  "2": { q: 2 },
  "3": { q: 3 },
  c: { q: 0, shape: "circle" },
  t: { q: 0, shape: "triangle" },
  q: { q: 0, shape: "quadrant" },
  Q: { q: 0, shape: "quadrant", turn: 1 },
  s: { q: 0, shape: "semicircle" },
  h: { q: 0, shape: "hexagon" },
  a: { q: 0, shape: "arc" },
  H: { q: 0, shape: "hamza1" },
  K: { q: 0, shape: "hamza2" },
};

function tiles(map: string[]): TileItem[] {
  const items: TileItem[] = [];
  map.forEach((row, j) => {
    for (let i = 0; i < row.length; i += 1) {
      const cell = LEGEND[row[i]];
      if (cell) items.push({ t: "tile", i, j, ...cell });
    }
  });
  return items;
}

/** A square ring of single cells — the frame most of these pieces start from. */
function ringMap(cells: number): string[] {
  const rows: string[] = [];
  for (let j = 0; j < cells; j += 1) {
    let row = "";
    for (let i = 0; i < cells; i += 1) {
      const edge = i === 0 || j === 0 || i === cells - 1 || j === cells - 1;
      row += edge ? "#" : ".";
    }
    rows.push(row);
  }
  return rows;
}

/** Every n-th sector of one band, starting at `offset`. */
function spokes(band: number, every: number, offset = 0, q: Quadrant = 0): SliceItem[] {
  const items: SliceItem[] = [];
  for (let sector = offset; sector < SECTORS; sector += every) {
    items.push({ t: "slice", band, sector, q });
  }
  return items;
}

/** Runs of bands across one sector each — merged circular strokes. */
function petals(band1: number, band2: number, step: number, offset = 0): RingItem[] {
  const items: RingItem[] = [];
  for (let sector = offset; sector < SECTORS; sector += step) {
    items.push({ t: "ring", band1, band2, sector1: sector, sector2: sector });
  }
  return items;
}

/* ------------------------------------------------------------------ hero -- */

/**
 * The hero figure: a medallion on a 13×13 grid — a ring of bricks, a stepped
 * lozenge floating inside it, a smaller lozenge, a disc at the centre and four
 * stepped diagonal arms that carry the corners of the frame.
 */
const MEDALLION = [
  "#############",
  "##.........##",
  "#.#...#...#.#",
  "#..#.#.#.#..#",
  "#...#.#...#.#",
  "#..#.#.#.#..#",
  "#.#.#.c.#.#.#",
  "#..#.#.#.#..#",
  "#...#.#...#.#",
  "#..#.#.#.#..#",
  "#.#...#...#.#",
  "##.........##",
  "#############",
];

export const medallion: Piece = {
  id: "medallion",
  name: "الميدالية",
  note: "شبكة مربعة 13×13",
  spec: { kind: "square", cells: 13 },
  ratio: 0.5,
  items: tiles(MEDALLION),
};

/** The same idea on the circular grid: spokes that get denser towards the rim. */
export const solar: Piece = {
  id: "solar",
  name: "الشمسية",
  note: "شبكة دائرية 4 مناطق",
  spec: { kind: "radial", bands: 4 },
  ratio: 0.5,
  items: [
    { t: "ring", band1: 0, band2: 0, sector1: 0, sector2: 17 },
    { t: "ring", band1: 0, band2: 0, sector1: 18, sector2: 35 },
    ...spokes(3, 1),
    ...spokes(2, 2),
    ...spokes(1, 3),
  ],
};

/* --------------------------------------------------------------- gallery -- */

/** Nested frames in the classic thick build. */
const NESTED = [
  "################",
  "#..............#",
  "#..............#",
  "#..##########..#",
  "#..#........#..#",
  "#..#........#..#",
  "#..#..####..#..#",
  "#..#..####..#..#",
  "#..#..####..#..#",
  "#..#..####..#..#",
  "#..#........#..#",
  "#..#........#..#",
  "#..##########..#",
  "#..............#",
  "#..............#",
  "################",
];

export const nested: Piece = {
  id: "nested",
  name: "إطارات متداخلة",
  note: "شبكة مربعة 16×16 · نسبة 75%",
  spec: { kind: "square", cells: 16 },
  ratio: 0.75,
  items: tiles(NESTED),
};

/** A mashrabiya: a two-cell frame around a checkerboard field. */
function latticeMap(): string[] {
  const rows: string[] = [];
  for (let j = 0; j < 14; j += 1) {
    let row = "";
    for (let i = 0; i < 14; i += 1) {
      const edge = i < 2 || j < 2 || i > 11 || j > 11;
      row += edge || (i + j) % 2 === 0 ? "#" : ".";
    }
    rows.push(row);
  }
  return rows;
}

export const lattice: Piece = {
  id: "lattice",
  name: "مشربية",
  note: "شبكة مربعة 14×14 · نسبة 50%",
  spec: { kind: "square", cells: 14 },
  ratio: 0.5,
  items: tiles(latticeMap()),
};

/** An ornament of discs and quarter-turn quadrants — the shape vocabulary. */
export const ornament: Piece = {
  id: "ornament",
  name: "حلية",
  note: "شبكة مربعة 13×13 · نسبة 50% · دوائر وأرباع",
  spec: { kind: "square", cells: 13 },
  ratio: 0.5,
  items: [
    ...tiles(ringMap(13)),
    { t: "tile", i: 6, j: 6, q: 0, shape: "circle" },
    { t: "tile", i: 6, j: 2, q: 0, shape: "circle" },
    { t: "tile", i: 2, j: 6, q: 0, shape: "circle" },
    { t: "tile", i: 10, j: 6, q: 0, shape: "circle" },
    { t: "tile", i: 6, j: 10, q: 0, shape: "circle" },
    { t: "tile", i: 4, j: 4, q: 0, shape: "circle" },
    { t: "tile", i: 8, j: 4, q: 0, shape: "circle" },
    { t: "tile", i: 4, j: 8, q: 0, shape: "circle" },
    { t: "tile", i: 8, j: 8, q: 0, shape: "circle" },
    { t: "tile", i: 5, j: 5, q: 0, shape: "quadrant", turn: 1 },
    { t: "tile", i: 7, j: 5, q: 0, shape: "quadrant", turn: 2 },
    { t: "tile", i: 5, j: 7, q: 0, shape: "quadrant", turn: 0 },
    { t: "tile", i: 7, j: 7, q: 0, shape: "quadrant", turn: 3 },
  ],
};

/** A rosette: rim teeth over a ring of petals, a boss at the centre. */
export const rosette: Piece = {
  id: "rosette",
  name: "زخرفة مشعّة",
  note: "شبكة دائرية 5 مناطق · نسبة 75%",
  spec: { kind: "radial", bands: 5 },
  ratio: 0.75,
  items: [
    { t: "ring", band1: 0, band2: 0, sector1: 0, sector2: 17 },
    { t: "ring", band1: 0, band2: 0, sector1: 18, sector2: 35 },
    ...spokes(1, 3),
    ...spokes(2, 2, 1),
    ...petals(3, 3, 3),
    ...spokes(4, 1),
  ],
};

/** An arcade: jambs carrying three arches over a floor, with three lamps. */
export const arcade: Piece = {
  id: "arcade",
  name: "محراب",
  note: "شبكة مربعة 16×16 · نسبة 75%",
  spec: { kind: "square", cells: 16 },
  ratio: 0.75,
  items: [
    ...tiles(ringMap(16)),
    { t: "tile", i: 4, j: 7, q: 0, shape: "circle" },
    { t: "tile", i: 7, j: 7, q: 0, shape: "circle" },
    { t: "tile", i: 10, j: 7, q: 0, shape: "circle" },
    { t: "bar", i1: 1, j1: 12, i2: 14, j2: 12 },
    { t: "bar", i1: 3, j1: 6, i2: 3, j2: 11 },
    { t: "bar", i1: 6, j1: 6, i2: 6, j2: 11 },
    { t: "bar", i1: 9, j1: 6, i2: 9, j2: 11 },
    { t: "bar", i1: 12, j1: 6, i2: 12, j2: 11 },
    { t: "arch", i1: 3, j1: 5, i2: 6, j2: 5, d: 0 },
    { t: "arch", i1: 6, j1: 5, i2: 9, j2: 5, d: 0 },
    { t: "arch", i1: 9, j1: 5, i2: 12, j2: 5, d: 0 },
  ],
};

/* ---------------------------------------------------------------- glyphs -- */

/** One cell, drawn at the given ratios — the ink-ratio control's own picture. */
export function ratioCells(ratios: number[]): Piece[] {
  return ratios.map((ratio, index) => ({
    id: `cell-${index}`,
    name: "خلية",
    note: `نسبة ${Math.round(ratio * 100)}%`,
    spec: { kind: "square", cells: 1 },
    ratio,
    items: [{ t: "tile", i: 0, j: 0, q: 0 }],
  }));
}

/** A run of five cells: separate fragments above, one merged bar below. */
export const mergedRun: Piece = {
  id: "merged-run",
  name: "دمج الخطوط",
  note: "خمس خلايا، ثم خط واحد",
  spec: { kind: "square", cells: 5, extent: { w: 5, h: 2 } },
  ratio: 0.5,
  items: [...tiles(["#####", "....."]), { t: "bar", i1: 0, j1: 1, i2: 4, j2: 1 }],
};

/** The nine fragment shapes, one to a cell. */
export const shapeSet: Piece = {
  id: "shape-set",
  name: "الأشكال التسعة",
  note: "تسعة أشكال",
  spec: { kind: "square", cells: 3 },
  ratio: 0.75,
  items: tiles(["#ct", "qQs", "haK"]),
};

/** A board used as the subject of the sync and export drawings. */
export const board: Piece = {
  id: "board",
  name: "لوحة",
  note: "",
  spec: { kind: "square", cells: 6 },
  ratio: 0.75,
  items: tiles([
    "##....",
    "##....",
    "..####",
    "..####",
    "##....",
    "##....",
  ]),
};

/** The square-grid half of the "two grids" drawing. */
export const squareSample: Piece = {
  id: "square-sample",
  name: "شبكة مربعة",
  note: "شبكة مربعة",
  spec: { kind: "square", cells: 5 },
  ratio: 0.75,
  items: tiles(["..#..", "..#..", "#####", "..#..", "..#.."]),
};

/** The circular-grid half of the "two grids" drawing. */
export const circularSample: Piece = {
  id: "circular-sample",
  name: "شبكة دائرية",
  note: "شبكة دائرية",
  spec: { kind: "radial", bands: 3 },
  ratio: 0.75,
  items: [...spokes(2, 1), ...spokes(1, 3), ...spokes(0, 6, 3)],
};
