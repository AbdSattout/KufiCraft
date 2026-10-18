/**
 * KufiCraft — outside borders (pure, no DOM).
 *
 * A border is an opt-in stroke **outside** the item's box: the inner edge of the
 * stroke touches the box and the ink stays untouched (`docs/FORMAT.md` §Style
 * fields). The box is `KufiItem.bounds(config)` — for a tile its fragment
 * rectangle, for a run the ink box the run paints — so the border hugs what is
 * actually drawn rather than the cells the item was clicked in.
 *
 * Every side is a **separate straight subpath of one path**, laid on the centre
 * line `width / 2` outside the box and stroked with butt caps. Two sides that
 * meet are joined by extending each by a full `width` past the corner, which is
 * exactly what a mitre join of two butt-capped bars leaves — a square corner
 * whose outer edge is `width` outside the box:
 *
 *        ┌─────────────┐   ← outer edge of the stroke (box + width)
 *        │             │
 *        └─────────────┘   ← inner edge, on the box (never covers the ink)
 *
 * A side whose neighbour is off stops on the box's own corner instead, so a
 * single top border is a bar exactly as wide as the item.
 */

import {
  BORDER_ALL,
  BORDER_BOTTOM,
  BORDER_LEFT,
  BORDER_RIGHT,
  BORDER_TOP,
  MAX_BORDER_WIDTH,
} from "./model";
import type { ItemBorder } from "./model";
import { L, M, cmdsToPath } from "./geometry";
import type { PathCmd, Rect } from "./geometry";

/** A border ready to paint: the path, its stroke width and its colour. */
export interface BorderOutline {
  path: string;
  /** Stroke width in viewBox units (always `> 0`). */
  width: number;
  color: string;
}

/** The path of `sides` of `rect`, drawn just outside it. */
export function borderPath(rect: Rect, sides: number, width: number): string {
  const half = width / 2;
  const top = (sides & BORDER_TOP) !== 0;
  const right = (sides & BORDER_RIGHT) !== 0;
  const bottom = (sides & BORDER_BOTTOM) !== 0;
  const left = (sides & BORDER_LEFT) !== 0;
  // Each side is centred half a stroke outside the box, so its stroke covers
  // `box … box + width` and the inner edge lies exactly on the box. A side runs
  // between the box's own corners; when its neighbour is on it reaches a full
  // `width` further, so the two bars' outer edges meet in an exact square
  // corner instead of leaving a notch.
  const from = (enabled: boolean, at: number) => (enabled ? at - width : at);
  const to = (enabled: boolean, at: number) => (enabled ? at + width : at);
  const x0 = rect.x;
  const x1 = rect.x + rect.w;
  const y0 = rect.y;
  const y1 = rect.y + rect.h;
  const topLine = y0 - half;
  const bottomLine = y1 + half;
  const leftLine = x0 - half;
  const rightLine = x1 + half;
  const cmds: PathCmd[] = [];
  if (top) cmds.push(M(from(left, x0), topLine), L(to(right, x1), topLine));
  if (right)
    cmds.push(M(rightLine, from(top, y0)), L(rightLine, to(bottom, y1)));
  if (bottom)
    cmds.push(M(from(left, x0), bottomLine), L(to(right, x1), bottomLine));
  if (left) cmds.push(M(leftLine, from(top, y0)), L(leftLine, to(bottom, y1)));
  return cmdsToPath(cmds);
}

/**
 * The outline of a stored border around `rect`, or `undefined` when it paints
 * nothing (`sides === 0` or a non-positive width — the states the sanitisers
 * normalise away, checked here too so a hostile document cannot draw a
 * 0-width or oddly-signed stroke).
 *
 * `color` is the fallback colour: the item's own resolved colour.
 */
export function borderOutline(
  rect: Rect,
  border: ItemBorder,
  color: string,
): BorderOutline | undefined {
  const sides = Number.isFinite(border.sides)
    ? Math.trunc(border.sides) & BORDER_ALL
    : 0;
  const width = Math.min(border.width, MAX_BORDER_WIDTH);
  if (sides === 0 || !Number.isFinite(width) || width <= 0) return undefined;
  const override = border.color;
  return {
    path: borderPath(rect, sides, width),
    width,
    color: override !== undefined && override.length > 0 ? override : color,
  };
}
