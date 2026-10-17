/**
 * KufiCraft — the pen's shape palette, one class per shape.
 *
 * The ten entries are the old app's `#submenu` in its own order
 * (`index.html:205‑284`), re-authored from the glyphs it previewed: the old
 * `getPathForShape` only ever drew squares, so the *palette icons* are the
 * real shape specification (see `/tmp/opencode/notes/shapes.md`). Three names
 * were fixed on the way through:
 *
 *   `semi-hexagone` → `pentagon`      a typo *and* a misnomer: the glyph is a
 *                                     five-sided house, not half a hexagon.
 *   `arc`           → `curve`         it collided with the `arc` *tool*.
 *   `''` (untitled) → `comb`          the tenth entry has `title=""` and
 *                                     `drawingShape = ''`; its glyph is a
 *                                     three-toothed comb.
 *
 * A shape is authored as path commands inside a local `0…w × 0…h` box, so the
 * **same** renderer draws the canvas fragment, the toolbar icon (through
 * `tileIconPath`) and the circular-grid fit. Rotation is quarter turns
 * clockwise about the box centre and shifts each arc's x-axis-rotation with it.
 */

import type { Rotation, ShapeId } from "./model";
import { SHAPE_IDS } from "./model";
import {
  A,
  L,
  M,
  Z,
  baseFrame,
  cmdsToPath,
  composeFrames,
  mapCommands,
  quarterTurnFrame,
  rectPath,
} from "./geometry";
import type { Frame, PathCmd, Rect } from "./geometry";

export abstract class KufiShape {
  abstract readonly id: ShapeId;
  /** How the palette names it (the old app's `title`). */
  abstract readonly label: string;

  /** Authored commands in a local `0…w × 0…h` box. */
  abstract commands(w: number, h: number): PathCmd[];

  /**
   * Filled path of this shape inside `box`, rotated `rotation` quarter turns
   * clockwise around the box centre.
   */
  path(box: Rect, rotation: Rotation = 0): string {
    const turns = normalizeTurns(rotation);
    // Hot path: most fragments are plain, unrotated ink rectangles.
    if (this.id === "square" && turns === 0) return rectPath(box);
    return this.inFrame(box.w, box.h, turns, baseFrame(box.x, box.y), 0);
  }

  /**
   * Filled path fitted into an arbitrary frame — used by the circular grid,
   * where the fragment is radial/tangential rather than axis-aligned.
   */
  inFrame(
    w: number,
    h: number,
    rotation: Rotation,
    frame: Frame,
    rotDeg: number,
  ): string {
    const turns = normalizeTurns(rotation);
    const turned = composeFrames(quarterTurnFrame(w / 2, h / 2, turns), frame);
    return cmdsToPath(
      mapCommands(this.commands(w, h), turned, rotDeg + turns * 90),
    );
  }
}

function normalizeTurns(rotation: Rotation): Rotation {
  return (((rotation % 4) + 4) % 4) as Rotation;
}

/* ------------------------------------------------------------------ */
/* The ten shapes                                                      */
/* ------------------------------------------------------------------ */

class Square extends KufiShape {
  readonly id = "square" as const;
  readonly label = "مربع";
  commands(w: number, h: number): PathCmd[] {
    return [M(0, 0), L(w, 0), L(w, h), L(0, h), Z];
  }
}

class Circle extends KufiShape {
  readonly id = "circle" as const;
  readonly label = "دائرة";
  commands(w: number, h: number): PathCmd[] {
    // Two half arcs keep the flags unambiguous (a single 180° arc is not).
    return [
      M(0, h / 2),
      A(w / 2, h / 2, 1, 1, w, h / 2),
      A(w / 2, h / 2, 1, 1, 0, h / 2),
      Z,
    ];
  }
}

class Triangle extends KufiShape {
  readonly id = "triangle" as const;
  readonly label = "مثلث";
  commands(w: number, h: number): PathCmd[] {
    // Right angle at the bottom-right corner, like the old glyph.
    return [M(0, h), L(w, h), L(w, 0), Z];
  }
}

class QuarterCircle extends KufiShape {
  readonly id = "quarterCircle" as const;
  readonly label = "ربع دائرة";
  commands(w: number, h: number): PathCmd[] {
    // Quarter disk centred on the bottom-right corner, closed through it.
    return [M(0, h), A(w, h, 0, 1, w, 0), L(w, h), Z];
  }
}

class SemiCircle extends KufiShape {
  readonly id = "semiCircle" as const;
  readonly label = "نصف دائرة";
  commands(w: number, h: number): PathCmd[] {
    // Round-topped block: dome above the mid line, rectangle below it.
    return [M(0, h), L(0, h / 2), A(w / 2, h / 2, 0, 1, w, h / 2), L(w, h), Z];
  }
}

class Pentagon extends KufiShape {
  readonly id = "pentagon" as const;
  readonly label = "مخمّس";
  commands(w: number, h: number): PathCmd[] {
    return [
      M(0, h),
      L(0, h / 2),
      L(w / 2, 0),
      L(w, h / 2),
      L(w, h),
      Z,
    ];
  }
}

class Curve extends KufiShape {
  readonly id = "curve" as const;
  readonly label = "منحنٍ";
  commands(w: number, h: number): PathCmd[] {
    // Concave quarter: arc centred on the top-left corner, closed along the
    // right and bottom edges.
    return [M(0, h), A(w, h, 0, 0, w, 0), L(w, h), Z];
  }
}

class Hamza1 extends KufiShape {
  readonly id = "hamza1" as const;
  readonly label = "همزة ١";
  commands(w: number, h: number): PathCmd[] {
    // Squared «C», open on the right at `y ∈ [h/3, 2h/3]`.
    return [
      M(0, 0),
      L(w, 0),
      L(w, h / 3),
      L(w / 3, h / 3),
      L(w / 3, (2 * h) / 3),
      L(w, (2 * h) / 3),
      L(w, h),
      L(0, h),
      Z,
    ];
  }
}

class Hamza2 extends KufiShape {
  readonly id = "hamza2" as const;
  readonly label = "همزة ٢";
  commands(w: number, h: number): PathCmd[] {
    // 5×5 «S» braid.
    return [
      M(0, 0),
      L(w, 0),
      L(w, h / 5),
      L(w / 5, h / 5),
      L(w / 5, (2 * h) / 5),
      L(w, (2 * h) / 5),
      L(w, h),
      L(0, h),
      L(0, (4 * h) / 5),
      L((4 * w) / 5, (4 * h) / 5),
      L((4 * w) / 5, (3 * h) / 5),
      L(0, (3 * h) / 5),
      Z,
    ];
  }
}

class Comb extends KufiShape {
  readonly id = "comb" as const;
  readonly label = "مشط";
  commands(w: number, h: number): PathCmd[] {
    // Three teeth of alternating length on a solid bottom bar.
    return [
      M(0, 0),
      L(w / 5, 0),
      L(w / 5, (4 * h) / 5),
      L((2 * w) / 5, (4 * h) / 5),
      L((2 * w) / 5, h / 5),
      L((3 * w) / 5, h / 5),
      L((3 * w) / 5, (4 * h) / 5),
      L((4 * w) / 5, (4 * h) / 5),
      L((4 * w) / 5, 0),
      L(w, 0),
      L(w, h),
      L(0, h),
      Z,
    ];
  }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const REGISTRY: Readonly<Record<ShapeId, KufiShape>> = {
  square: new Square(),
  circle: new Circle(),
  triangle: new Triangle(),
  quarterCircle: new QuarterCircle(),
  semiCircle: new SemiCircle(),
  pentagon: new Pentagon(),
  curve: new Curve(),
  hamza1: new Hamza1(),
  hamza2: new Hamza2(),
  comb: new Comb(),
};

/** Palette order — the old app's submenu order. */
export const SHAPE_ORDER: readonly ShapeId[] = SHAPE_IDS;

/** Total lookup: an unknown / absent id is the square. */
export function shapeById(id: ShapeId | string | undefined): KufiShape {
  if (id !== undefined && id in REGISTRY) return REGISTRY[id as ShapeId];
  return REGISTRY.square;
}

export function shapeLabel(id: ShapeId | string | undefined): string {
  return shapeById(id).label;
}

/** Filled path of `shape` in `box` — one entry point for canvas and icons. */
export function shapePath(
  shape: ShapeId | string | undefined,
  box: Rect,
  rotation: Rotation = 0,
): string {
  return shapeById(shape).path(box, rotation);
}

export function shapeOrderIndex(id: ShapeId): number {
  return SHAPE_ORDER.indexOf(id);
}
