/**
 * KufiCraft — item borders (pure, no DOM).
 *
 * A border is painted with the **item's own path** — never a translated copy
 * and never a filter (`docs/FORMAT.md` §Style fields):
 *
 *   • a stroked item (line fallback, polyline, arc) is stroked again first,
 *     wider by the border band on each side: `itemWidth + 2 × width`, with the
 *     same cap and join as the ink, so the border wraps a round end;
 *   • a filled item (tiles, line bars) gets a native stroke of the same path,
 *     `2 × width` wide, painted **before** the fill. The fill covers the inner
 *     half, so exactly `width` remains visible outside every edge and corner.
 *
 * Width is the switch: `0` (or a broken/negative value) paints no border.
 */

import { DEFAULT_BORDER_COLOR, MAX_BORDER_WIDTH } from "./model";
import type { ItemBorder } from "./model";

/** One border stroke of the item's own path, in a resolved colour. */
export interface BorderPaint {
  /** The stored border colour, black when the value is empty/broken. */
  color: string;
  /** `stroke-width` in viewBox units. */
  width: number;
}

/**
 * The border stroke for `border`, or `undefined` when it paints nothing
 * (`width <= 0` — the state the sanitisers normalise away, checked here too so
 * a hostile document cannot draw an invisible outline). `width` is capped like
 * the stored format.
 *
 * `inkWidth` is the item's own stroke width (`0` for a filled item): a
 * stroked item's border is wider by `2 × width`, so the visible band is
 * exactly `width` on each side of the ink.
 */
export function borderPaint(
  border: ItemBorder,
  inkWidth: number,
): BorderPaint | undefined {
  const band = Number.isFinite(border.width)
    ? Math.min(border.width, MAX_BORDER_WIDTH)
    : 0;
  if (band <= 0) return undefined;
  const color =
    typeof border.color === "string" && border.color.length > 0
      ? border.color
      : DEFAULT_BORDER_COLOR;
  return {
    color,
    width: (Number.isFinite(inkWidth) ? Math.max(0, inkWidth) : 0) + 2 * band,
  };
}
