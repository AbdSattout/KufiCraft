/**
 * Landing-page artwork: a small, self-contained square-kufi renderer.
 *
 * It follows the cell/zone rules of `docs/CANVAS.md` §1–3: a 1000×1000 viewBox,
 * square cells of `base`, circular bands of `base` split into 36 sectors of 10°,
 * the ink/space split at `ratio` (0.25…0.75), 2-bit quadrant fragments
 * (`q`), full-thickness merged lines and arcs stroked at `ratio · base`.
 *
 * It deliberately does **not** import `src/lib/canvas/**`: the engine is written
 * in parallel and the marketing page must render standalone, exactly like a
 * thumbnails/export string would. Only the items the hand-authored landing
 * compositions need are implemented, and the two fragments that the reference
 * file leaves undefined (hamza1/hamza2) are drawn as the two angular hooks.
 */

export const VIEW = 1000;
export const SECTORS = 36;
export const SECTOR_ANGLE = 360 / SECTORS;

export type Quadrant = 0 | 1 | 2 | 3;
export type Turn = 0 | 1 | 2 | 3;

export type FragmentShape =
  | "square"
  | "circle"
  | "triangle"
  | "quadrant"
  | "semicircle"
  | "hexagon"
  | "arc"
  | "hamza1"
  | "hamza2";

/**
 * `cells` sets the cell size (`base = VIEW / cells`). `extent` crops the
 * viewBox to a whole number of cells, for pieces that are wider than they are
 * tall (the small capability drawings), and for zooming into a fragment.
 */
export type SquareSpec = {
  kind: "square";
  cells: number;
  extent?: { w: number; h: number };
};
export type RadialSpec = { kind: "radial"; bands: number };
export type GridSpec = SquareSpec | RadialSpec;

export type SquareGrid = {
  kind: "square";
  cells: number;
  base: number;
  ratio: number;
};

export type RadialGrid = {
  kind: "radial";
  bands: number;
  base: number;
  ratio: number;
};

export type Grid = SquareGrid | RadialGrid;

export type Rect = { x: number; y: number; w: number; h: number };

/** One zone fragment of one cell. */
export type TileItem = {
  t: "tile";
  i: number;
  j: number;
  q: Quadrant;
  shape?: FragmentShape;
  turn?: Turn;
};

/** A straight merged run: full cell thickness (the editor's “دمج الخطوط”). */
export type BarItem = {
  t: "bar";
  i1: number;
  j1: number;
  i2: number;
  j2: number;
};

/** A quarter-arc connector between two anchors on one row or one column. */
export type ArchItem = {
  t: "arch";
  i1: number;
  j1: number;
  i2: number;
  j2: number;
  /** 0 bulges “up” (start side), 1 bulges “down” (end side). */
  d: 0 | 1;
};

/** One annular fragment on the circular grid. */
export type SliceItem = {
  t: "slice";
  band: number;
  sector: number;
  q: Quadrant;
};

/** A run of circular bands across sectors (shortest path, wraps allowed). */
export type RingItem = {
  t: "ring";
  band1: number;
  sector1: number;
  band2: number;
  sector2: number;
};

export type Item = TileItem | BarItem | ArchItem | SliceItem | RingItem;

/** A painted element: a path, how to paint it, and an optional rotation. */
export type Painted = {
  d: string;
  mode: "fill" | "stroke";
  strokeWidth?: number;
  transform?: string;
};

export function gridOf(spec: GridSpec, ratio: number): Grid {
  if (spec.kind === "square") {
    return { kind: "square", cells: spec.cells, base: VIEW / spec.cells, ratio };
  }
  return { kind: "radial", bands: spec.bands, base: VIEW / 2 / spec.bands, ratio };
}

/** The visible area of a piece, in viewBox units. */
export function viewBoxOf(spec: GridSpec): string {
  if (spec.kind === "radial") return `0 0 ${VIEW} ${VIEW}`;
  const base = VIEW / spec.cells;
  const extent = spec.extent;
  if (!extent) return `0 0 ${VIEW} ${VIEW}`;
  return `0 0 ${Math.round(extent.w * base)} ${Math.round(extent.h * base)}`;
}

/** Rounds to 2 decimals so the emitted SVG stays short and diff-friendly. */
function n(value: number): number {
  return Math.round(value * 100) / 100;
}

function rectPath({ x, y, w, h }: Rect): string {
  return `M ${n(x)} ${n(y)} H ${n(x + w)} V ${n(y + h)} H ${n(x)} Z`;
}

/** The zone rect of cell (i, j): each axis is split at `ratio`. */
export function zoneRect(g: SquareGrid, i: number, j: number, q: Quadrant): Rect {
  const b = g.base;
  const ink = g.ratio * b;
  const space = b - ink;
  return {
    x: i * b + (q & 1 ? ink : 0),
    y: j * b + (q & 2 ? ink : 0),
    w: q & 1 ? space : ink,
    h: q & 2 ? space : ink,
  };
}

/** Shape geometry, ported from `docs/CANVAS.md` §4 (fallback definitions). */
export function shapePath(shape: FragmentShape, r: Rect): string {
  const { x, y, w, h } = r;
  switch (shape) {
    case "circle":
      return `M ${n(x)} ${n(y + h / 2)} A ${n(w / 2)} ${n(h / 2)} 0 1 0 ${n(x + w)} ${n(y + h / 2)} A ${n(w / 2)} ${n(h / 2)} 0 1 0 ${n(x)} ${n(y + h / 2)} Z`;
    case "triangle":
      return `M ${n(x)} ${n(y + h)} L ${n(x + w / 2)} ${n(y)} L ${n(x + w)} ${n(y + h)} Z`;
    case "quadrant":
      return `M ${n(x)} ${n(y)} A ${n(w)} ${n(h)} 0 0 1 ${n(x + w)} ${n(y + h)} L ${n(x)} ${n(y + h)} Z`;
    case "semicircle":
      return `M ${n(x)} ${n(y + h)} A ${n(w / 2)} ${n(h)} 0 0 1 ${n(x + w)} ${n(y + h)} Z`;
    case "hexagon":
      return `M ${n(x)} ${n(y + h / 2)} L ${n(x + w / 4)} ${n(y)} L ${n(x + (3 * w) / 4)} ${n(y)} L ${n(x + w)} ${n(y + h / 2)} L ${n(x + (3 * w) / 4)} ${n(y + h)} L ${n(x + w / 4)} ${n(y + h)} Z`;
    case "arc":
      return `M ${n(x)} ${n(y + h)} A ${n(w)} ${n(h)} 0 0 1 ${n(x + w)} ${n(y)} L ${n(x + w)} ${n(y + h / 2)} A ${n(w / 2)} ${n(h / 2)} 0 0 0 ${n(x + w / 2)} ${n(y + h)} Z`;
    case "hamza1":
      return hookPath(r, "top");
    case "hamza2":
      return hookPath(r, "bottom");
    default:
      return rectPath(r);
  }
}

/**
 * The two hamza fragments. `docs/reference/old-square-kufi.js` never
 * implemented them (its shape switch only returns `square`), so the landing
 * draws the classic pair of angular hooks: a limb along the top edge curving
 * down the end side, and the same hook turned over along the bottom edge.
 */
function hookPath({ x, y, w, h }: Rect, edge: "top" | "bottom"): string {
  const t = Math.min(w, h) / 3;
  if (edge === "top") {
    return `M ${n(x)} ${n(y)} H ${n(x + w)} V ${n(y + h)} H ${n(x + w - t)} V ${n(y + t)} H ${n(x)} Z`;
  }
  return `M ${n(x + w)} ${n(y)} V ${n(y + h)} H ${n(x)} V ${n(y + h - t)} H ${n(x + w - t)} V ${n(y)} Z`;
}

function radialPoint(r: number, angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: VIEW / 2 + r * Math.cos(a), y: VIEW / 2 + r * Math.sin(a) };
}

/** An annular sector between two radii and two angles (degrees, y grows down). */
function annularSector(
  rIn: number,
  rOut: number,
  a0: number,
  a1: number,
): string {
  const span = Math.abs(a1 - a0);
  const large = span > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  const p1 = radialPoint(rOut, a0);
  const p2 = radialPoint(rOut, a1);
  const p3 = radialPoint(rIn, a1);
  const p4 = radialPoint(rIn, a0);
  const back = sweep === 1 ? 0 : 1;
  return [
    `M ${n(p1.x)} ${n(p1.y)}`,
    `A ${n(rOut)} ${n(rOut)} 0 ${large} ${sweep} ${n(p2.x)} ${n(p2.y)}`,
    `L ${n(p3.x)} ${n(p3.y)}`,
    rIn > 0
      ? `A ${n(rIn)} ${n(rIn)} 0 ${large} ${back} ${n(p4.x)} ${n(p4.y)}`
      : `L ${n(p4.x)} ${n(p4.y)}`,
    "Z",
  ].join(" ");
}

function slicePath(g: RadialGrid, item: SliceItem): string {
  const b = g.base;
  const ink = g.ratio * b;
  const rIn = item.band * b + (item.q & 1 ? ink : 0);
  const rOut = item.band * b + (item.q & 1 ? b : ink);
  const a0 = item.sector * SECTOR_ANGLE;
  const a1 =
    a0 + (item.q & 2 ? SECTOR_ANGLE : g.ratio * SECTOR_ANGLE);
  return annularSector(rIn, rOut, a0, a1);
}

function ringPath(g: RadialGrid, item: RingItem): string {
  const b = g.base;
  const bandLo = Math.min(item.band1, item.band2);
  const bandHi = Math.max(item.band1, item.band2);
  const rIn = bandLo * b;
  const rOut = (bandHi + 1) * b;
  const a0 = item.sector1 * SECTOR_ANGLE;
  const forward = (item.sector2 - item.sector1 + SECTORS) % SECTORS;
  const a1 = a0 + (forward + 1) * SECTOR_ANGLE;
  return annularSector(rIn, rOut, a0, a1);
}

function cellCentre(g: SquareGrid, i: number, j: number) {
  return { x: (i + 0.5) * g.base, y: (j + 0.5) * g.base };
}

function barPath(g: SquareGrid, item: BarItem): string {
  const i1 = Math.min(item.i1, item.i2);
  const i2 = Math.max(item.i1, item.i2);
  const j1 = Math.min(item.j1, item.j2);
  const j2 = Math.max(item.j1, item.j2);
  return rectPath({
    x: i1 * g.base,
    y: j1 * g.base,
    w: (i2 - i1 + 1) * g.base,
    h: (j2 - j1 + 1) * g.base,
  });
}

/**
 * A semicircular connector between two anchors' cell centres, stroked at
 * `ratio · base` — `d = 0` bulges to the start side (up for a horizontal arch,
 * left for a vertical one), `d = 1` to the end side.
 */
function archPath(g: SquareGrid, item: ArchItem): string {
  const b = g.base;
  const horizontal = item.j1 === item.j2;
  const span = horizontal
    ? Math.abs(item.i2 - item.i1)
    : Math.abs(item.j2 - item.j1);
  const radius = (span * b) / 2;
  const forward = horizontal ? item.i2 > item.i1 : item.j2 > item.j1;
  const sweep = item.d === 0 ? 1 : 0;
  const from = cellCentre(g, item.i1, item.j1);
  const to = cellCentre(g, item.i2, item.j2);
  return `M ${n(from.x)} ${n(from.y)} A ${n(radius)} ${n(radius)} 0 0 ${forward ? sweep : 1 - sweep} ${n(to.x)} ${n(to.y)}`;
}

/** Turns an item into one paintable path. */
export function paint(g: Grid, item: Item): Painted | null {
  if (g.kind === "radial") {
    switch (item.t) {
      case "slice":
        return { d: slicePath(g, item), mode: "fill" };
      case "ring":
        return { d: ringPath(g, item), mode: "fill" };
      default:
        return null;
    }
  }
  switch (item.t) {
    case "tile": {
      const r = zoneRect(g, item.i, item.j, item.q);
      const turn = item.turn ?? 0;
      return {
        d: shapePath(item.shape ?? "square", r),
        mode: "fill",
        transform:
          turn === 0
            ? undefined
            : `rotate(${turn * 90} ${n(r.x + r.w / 2)} ${n(r.y + r.h / 2)})`,
      };
    }
    case "bar":
      return { d: barPath(g, item), mode: "fill" };
    case "arch":
      return {
        d: archPath(g, item),
        mode: "stroke",
        strokeWidth: n(g.ratio * g.base),
      };
    default:
      return null;
  }
}

/** Construction lines of the square grid (editor view only, never an export). */
export function constructionLines(g: SquareGrid): string[] {
  const lines: string[] = [];
  const step = g.base;
  for (let i = 1; i < g.cells; i += 1) {
    lines.push(`M ${n(i * step)} 0 V ${VIEW}`);
    lines.push(`M 0 ${n(i * step)} H ${VIEW}`);
  }
  return lines;
}

/** The border of the square grid, drawn as the editing surface's edge. */
export function outlinePath(g: SquareGrid): string {
  return rectPath({ x: 0, y: 0, w: g.cells * g.base, h: g.cells * g.base });
}
