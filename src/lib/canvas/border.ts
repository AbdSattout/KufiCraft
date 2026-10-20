/**
 * KufiCraft — item borders (pure, no DOM).
 *
 * A border is painted with the **item's own path** — never a translated copy
 * and never a filter (`docs/FORMAT.md` §Style fields):
 *
 *   • a stroked item (line fallback, polyline, arc) is stroked again first,
 *     wider by the border band on each side: `itemWidth + 2 × width`, with the
 *     same butt caps and mitre joins as the ink;
 *   • a filled item (tiles, line bars) gets a native stroke of the same path,
 *     `2 × width` wide, painted **before** the fill. The fill covers the inner
 *     half, so exactly `width` remains visible outside every edge and corner.
 *
 * The old `sides` mask stays in the format for compatibility. Any non-zero
 * mask means "border on" and the border surrounds the whole shape; the mask no
 * longer selects sides (`docs/FORMAT.md`).
 */

import { BORDER_ALL, MAX_BORDER_WIDTH } from "./model";
import type { ItemBorder } from "./model";

/** One border stroke of the item's own path, in a resolved colour. */
export interface BorderPaint {
  /** Resolved colour: the override, else the item's own colour. */
  color: string;
  /** `stroke-width` in viewBox units. */
  width: number;
}

/**
 * The border stroke for `border`, or `undefined` when it paints nothing
 * (`sides === 0`, a broken/negative width — the states the sanitisers
 * normalise away, checked here too so a hostile document cannot draw an
 * invisible outline). `width` is capped like the stored format.
 *
 * `inkWidth` is the item's own stroke width (`0` for a filled item): a
 * stroked item's border is wider by `2 × width`, so the visible band is
 * exactly `width` on each side of the ink.
 *
 * `color` is the fallback: the item's own resolved colour.
 */
export function borderPaint(
  border: ItemBorder,
  color: string,
  inkWidth: number,
): BorderPaint | undefined {
  const sides = Number.isFinite(border.sides)
    ? Math.trunc(border.sides) & BORDER_ALL
    : 0;
  const band = Number.isFinite(border.width)
    ? Math.min(border.width, MAX_BORDER_WIDTH)
    : 0;
  if (sides === 0 || band <= 0) return undefined;
  const override = border.color;
  return {
    color: override !== undefined && override.length > 0 ? override : color,
    width: (Number.isFinite(inkWidth) ? Math.max(0, inkWidth) : 0) + 2 * band,
  };
}
