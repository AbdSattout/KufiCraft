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
 * The optional side mask belongs to tiles. When it is a subset of the four
 * sides, renderers clip the whole border stroke to the outside band of those
 * sides: the rects below keep the band just outside the tile's box and cut the
 * unselected sides, while rounded corners still follow the shape's own path.
 * Width is the switch: `0` (or a broken/negative value) paints no border.
 */

import {
  BORDER_ALL,
  BORDER_BOTTOM,
  BORDER_LEFT,
  BORDER_RIGHT,
  BORDER_TOP,
  DEFAULT_BORDER_COLOR,
  MAX_BORDER_WIDTH,
  clampBorderSides,
} from "./model";
import type { ItemBorder } from "./model";
import type { Rect } from "./geometry";

/** One border stroke of the item's own path, in a resolved colour. */
export interface BorderPaint {
  /** The stored border colour, black when the value is empty/broken. */
  color: string;
  /** `stroke-width` in viewBox units. */
  width: number;
  /**
   * The outside bands a partial tile border is clipped to. Absent for a whole
   * border, so all-sides output is exactly the pre-sides rendering.
   */
  clip?: readonly Rect[];
}

/** The effective side mask of `border` (absent = all four). */
export function borderSides(border: ItemBorder): number {
  return border.sides === undefined
    ? BORDER_ALL
    : clampBorderSides(border.sides);
}

/**
 * The visible border band in viewBox units, or `undefined` when the width
 * paints nothing. Capped like the stored format.
 */
export function borderBand(border: ItemBorder): number | undefined {
  const band = Number.isFinite(border.width)
    ? Math.min(border.width, MAX_BORDER_WIDTH)
    : 0;
  return band > 0 ? band : undefined;
}

/**
 * The four outside-band clip rectangles of a tile's border, for the selected
 * `sides`. Each rect starts one band outside the box and stops on its edge, so
 * the inner half of the native `2 × width` stroke is cut away and only the
 * visible outside band remains. Returns `undefined` for a whole border (no
 * clip) and for an empty mask.
 */
export function borderClipRects(
  bounds: Rect,
  sides: number,
  band: number,
): readonly Rect[] | undefined {
  const mask = clampBorderSides(sides);
  if (mask === BORDER_ALL || mask === 0) return undefined;
  if (!Number.isFinite(band) || band <= 0) return undefined;
  const w = band;
  const rects: Rect[] = [];
  if ((mask & BORDER_TOP) !== 0) {
    rects.push({ x: bounds.x - w, y: bounds.y - w, w: bounds.w + 2 * w, h: w });
  }
  if ((mask & BORDER_RIGHT) !== 0) {
    rects.push({ x: bounds.x + bounds.w, y: bounds.y - w, w, h: bounds.h + 2 * w });
  }
  if ((mask & BORDER_BOTTOM) !== 0) {
    rects.push({ x: bounds.x - w, y: bounds.y + bounds.h, w: bounds.w + 2 * w, h: w });
  }
  if ((mask & BORDER_LEFT) !== 0) {
    rects.push({ x: bounds.x - w, y: bounds.y - w, w, h: bounds.h + 2 * w });
  }
  return rects.length > 0 ? rects : undefined;
}

/**
 * The border stroke for `border`, or `undefined` when it paints nothing
 * (`width <= 0` or no side — the states the sanitisers normalise away, checked
 * here too so a hostile document cannot draw an invisible outline). `width` is
 * capped like the stored format.
 *
 * `inkWidth` is the item's own stroke width (`0` for a filled item): a
 * stroked item's border is wider by `2 × width`, so the visible band is
 * exactly `width` on each side of the ink. `clip` is set for a partial tile
 * border only.
 */
export function borderPaint(
  border: ItemBorder,
  inkWidth: number,
  clip?: readonly Rect[],
): BorderPaint | undefined {
  const band = borderBand(border);
  if (band === undefined || borderSides(border) === 0) return undefined;
  const color =
    typeof border.color === "string" && border.color.length > 0
      ? border.color
      : DEFAULT_BORDER_COLOR;
  const paint: BorderPaint = {
    color,
    width: (Number.isFinite(inkWidth) ? Math.max(0, inkWidth) : 0) + 2 * band,
  };
  if (clip !== undefined && clip.length > 0) paint.clip = clip;
  return paint;
}
