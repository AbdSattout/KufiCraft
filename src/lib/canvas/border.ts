/**
 * KufiCraft — outside borders (pure, no DOM).
 *
 * A border is one **duplicate of the item's own shape per enabled side**,
 * translated by the border width and painted behind the original in the border
 * colour (`docs/FORMAT.md` §Style fields):
 *
 *   • top    → `(0, -width)`
 *   • bottom → `(0, +width)`
 *   • left   → `(-width, 0)`
 *   • right  → `(+width, 0)`
 *
 * The duplicate keeps the item's paint mode and stroke width (the renderers
 * reuse the item's `Rendered` path), so the construction is identical for
 * filled tiles and for stroked lines, polylines and arcs. Because it is a
 * plain translated copy of the same path — never a filter, shadow or blur —
 * the SVG and PNG exports agree, and any SVG-capable program opens it.
 *
 * The visible border is the sliver of the copy the original does not cover:
 * exactly `width` wide on that side. With all four sides on there are four
 * copies, one per side; with none, there is no copy at all.
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

/** One translated copy of the item's shape, in a resolved border colour. */
export interface BorderCopy {
  /** Translation on the x axis, in viewBox units. */
  dx: number;
  /** Translation on the y axis, in viewBox units. */
  dy: number;
  color: string;
}

/**
 * The duplicates for `border`, or `[]` when it paints nothing (`sides === 0`
 * or a non-positive/broken width — the states the sanitisers normalise away,
 * checked here too so a hostile document cannot draw an invisible or huge
 * copy).
 *
 * `color` is the fallback colour: the item's own resolved colour.
 */
export function borderCopies(
  border: ItemBorder,
  color: string,
): BorderCopy[] {
  const sides = Number.isFinite(border.sides)
    ? Math.trunc(border.sides) & BORDER_ALL
    : 0;
  const width = Math.min(border.width, MAX_BORDER_WIDTH);
  if (sides === 0 || !Number.isFinite(width) || width <= 0) return [];
  const override = border.color;
  const copyColor =
    override !== undefined && override.length > 0 ? override : color;
  const copies: BorderCopy[] = [];
  if ((sides & BORDER_TOP) !== 0) {
    copies.push({ dx: 0, dy: -width, color: copyColor });
  }
  if ((sides & BORDER_RIGHT) !== 0) {
    copies.push({ dx: width, dy: 0, color: copyColor });
  }
  if ((sides & BORDER_BOTTOM) !== 0) {
    copies.push({ dx: 0, dy: width, color: copyColor });
  }
  if ((sides & BORDER_LEFT) !== 0) {
    copies.push({ dx: -width, dy: 0, color: copyColor });
  }
  return copies;
}
