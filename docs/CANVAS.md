# KufiCraft — canvas model & engine contract

> **This file is the contract.** If code and this doc disagree, fix the doc in the
> same PR (or raise it with the orchestrator). The single source of truth for
> types/constants/validators is **`convex/lib/model.ts`** (client alias:
> `src/lib/canvas/model.ts` → re-export).

## 1. Coordinate system

* SVG `viewBox="0 0 1000 1000"`; origin top-left, `y` grows **downwards**.
* Square grid: cells of `config.base` units. Cell `(i, j)` covers
  `x ∈ [i·base, (i+1)·base)`, `y ∈ [j·base, (j+1)·base)` — up to
  `1000 / base` cells per axis.
* Circular grid: center `(500, 500)`; band `i` covers radius
  `[i·base, (i+1)·base)`; sector `j` covers angle
  `[j·10°, (j+1)·10°)` with `atan2(dy, dx)` normalised to `[0, 2π)`
  (36 sectors, `CIRCULAR_SECTORS`).

## 2. Zone rule (the heart of square kufic)

Each cell (or circular slice) is split per axis at `config.ratio` (0.25…0.75):

| axis position | square | circular |
| --- | --- | --- |
| `< ratio` | ink zone | inner radial zone |
| `≥ ratio` | space zone | outer radial zone |

`TileItem.q` is a 2-bit quadrant:

* bit 0 (`1`) → **x / radial** axis is in the space zone
* bit 1 (`2`) → **y / angular** axis is in the space zone

So `q = 0` is the big ink-ink fragment, `q = 3` is the small
space-space fragment. The old app's “1/4 : 3/4” is `ratio = 0.75`;
“متساوية” is `ratio = 0.5`.

The **zone rect** of a tile = intersection of the two chosen zones
(square: a rect; circular: an annular sector).

## 3. Items

Defined in `convex/lib/model.ts` — `TileItem | LineItem | ArchItem`, each with a
stable unique key `k` (`tileKey` / `lineKey` / `archKey`). Keys are the identity:
adding an item whose key exists is a no-op (backend + engine both rely on this).

* **Tile**: one zone fragment, optional `s` (shape, default `square`),
  optional `c` (colour override), optional `r` (rotation, 0–3 quarter turns).
* **Line**: straight run between two anchors.
  * square: covers the inclusive cell run — cells `i1…i2` in row `j` when
    `j1 === j2` (horizontal) or rows `j1…j2` in column `i` when `i1 === i2`
    (vertical); full cell thickness (`base`).
  * circular: annular sector covering bands `i1…i2` across sectors `j1…j2`
    (shortest angular path, wrap-around allowed), full band thickness.
* **Arch**: quarter-arc connector (قنطرة) between two anchors on the same
  row/column. Square: arc from the first anchor's cell centre to the last
  anchor's cell centre, `d = 0` bulges up, `d = 1` bulges down (SVG coords),
  drawn as a **stroked** path with `stroke-width = ratio · base`.
  Circular: an arc at the band mid-radius spanning the sectors, same stroke rule.

## 4. Engine module layout (`src/lib/canvas/`)

Pure TypeScript, **no React, no DOM** (except `render.ts` returning strings).
This is what makes it testable and reusable by the editor, the dashboard
previews and export.

| file | exports (minimum) |
| --- | --- |
| `model.ts` | re-export of `convex/lib/model.ts` |
| `geometry.ts` | `zoneRect(config, i, j, q)`, `circularSlice(config, i, j, q)`, `shapePath(shape, rect, rotation)`, `tilePath(config, tile)`, `linePath(config, line)`, `archPath(config, arch)`, `itemPath(config, item)` |
| `grid.ts` | `pointToAnchor(config, {x, y})` → `{ i, j, q }`, `pointToCell(config, {x, y})` → `{ i, j }`, `cellCenter(config, i, j)`, `isSameAxis(a, b)`, `runOf(cells)` → `{ axis, from, to }` |
| `ops.ts` | `addItems(state, items)`, `removeItems(state, keys)`, `replaceItems(state, items)`, `toOps(...)` (diff → backend ops), `strokeToItems(config, anchors, opts)` (pen stroke → tiles **or** one merged line when `config.mergeLines` and the run is straight) |
| `render.ts` | `renderSvg(config, items, opts?)` → standalone SVG **string** (used for thumbnails + export), `renderThumbnail(config, items)` → compact string (≤ 24 000 chars) |

Every function must be deterministic and side-effect free.

### Shape geometry (fallback definitions)

For a zone rect `R = {x, y, w, h}` and `rotation` quarter turns clockwise around
the rect centre. Filled paths unless noted. Port the *look* from
`docs/reference/old-square-kufi.js` where possible; these definitions apply when
the reference is ambiguous:

* `square` — the full rect.
* `circle` — ellipse inscribed in `R` (`rx = w/2`, `ry = h/2`).
* `triangle` — isosceles triangle, apex at top-centre: `(x, y+h)`, `(x+w/2, y)`, `(x+w, y+h)`.
* `quadrant` — quarter ellipse centred at the rect's *bottom-left* corner: from `(x, y)` arc (`rx=w`, `ry=h`) to `(x+w, y+h)`, closed via the centre.
* `semicircle` — upper half ellipse: flat edge on the bottom edge, centre `(x+w/2, y+h)`, `rx = w/2`, `ry = h`.
* `hexagon` — flat-top hexagon: `(x, y+h/2)`, `(x+w/4, y)`, `(x+3w/4, y)`, `(x+w, y+h/2)`, `(x+3w/4, y+h)`, `(x+w/4, y+h)`.
* `arc` — quarter-arc band from `(x, y+h)` to `(x+w, y)` with elliptical radii `(w, h)` (bulging outward), closed back along the corner; port exact sweep from the reference.
* `hamza1` / `hamza2` — the two hamza fragments from the reference file (a hook shape and its variant). Reproduce them as filled paths inside `R`; `rotation` covers the mirrored orientations.

### Stroke → items (pen tool)

1. Pointer-move collects anchors `{i, j, q}` (`pointToAnchor`).
2. Consecutive **identical** anchors collapse.
3. On stroke end `strokeToItems` returns:
   * one `LineItem` when `config.mergeLines` **and** all anchors share one
     row or one column **and** all `q` are in the same axis zone
     (the old app's “merge squares to lines” behaviour), **or**
   * one `TileItem` per anchor otherwise.
4. The resulting items are sent as a single `applyOps` `add` batch.

## 5. Rendering contract

* Every item renders as one SVG element: `<path d={itemPath(config, item)} fill={item.c ?? config.ink}>`
  except arches (`fill="none"`, `stroke={c ?? ink}`, `stroke-width={ratio·base}`).
* Tile shapes are filled; the SVG has no strokes on tiles.
* `config.background` paints the SVG background (`transparent` → no rect).
* `config.showGrid` draws construction lines (light, subtle) **only in the
  editor**, never in thumbnails/exports.
* Thumbnails: `renderThumbnail` renders at `viewBox="0 0 1000 1000"` without grid,
  with a fixed light background; must stay ≤ 24 000 characters — reduce
  precision (`crypto`-free `toFixed(1)`) and skip the `k`/metadata attributes.

## 6. Resolved decisions (engine, wave 1)

Where the reference apps were incomplete or silent, the engine fixed the
following — the editor/export must not contradict them:

* `hamza1` / `hamza2`: a hook and its mirror, band thickness `min(w,h)/3`
  (the old app had no hamza path to port).
* `arc`: band thickness `min(w,h)/2`, bulging outward.
* `arch` on the square grid: `d = 0` bulges up when horizontal and to the
  **left** when vertical (consistency choice); circular arches ignore `d`.
* Non-square shapes on a circular grid are fitted into the slice frame with the
  local `+x` axis pointing outward along the radius.
* `zoneRect` is square-grid only; circular tiles use `circularSlice` /
  `sectorPath`.
* A `LineItem` that is diagonal (invalid by the model) falls back to its
  bounding-box rect instead of throwing — the editor must prevent creating one.

## 7. Quick start for consumers

```ts
import { itemPath, renderSvg, renderThumbnail } from "@/lib/canvas/geometry";
import { pointToAnchor } from "@/lib/canvas/grid";
import { strokeToItems, toOps } from "@/lib/canvas/ops";

// editor: pointer → anchor → items → backend batch
const anchor = pointToAnchor(config, viewBoxPoint);
const ops = toOps({ items: [...current, ...strokeToItems(config, anchors, { mergeLines: config.mergeLines })], previous: current });
await applyOps({ projectId, ops });

// dashboard/export: SVG string
const svg = renderThumbnail(config, items);   // ≤ 24 000 chars
const full = renderSvg(config, items, { grid: config.showGrid });
```


## 8. Test coverage (engine, wave 1)

The suite (`bun run test`, 68 tests) covers:

* zone rects for all 4 `q` values at `ratio` 0.5 and 0.75.
* circular slice math incl. wrap-around sectors (e.g. `j=35` → `j=0`).
* `pointToAnchor` round-trips with `zoneRect` (click inside a zone rect → same anchor).
* merge behaviour: straight run → 1 line; L-shaped run → N tiles; `mergeLines:false` → N tiles.
* `renderSvg` output parses as XML and contains one element per item.
* runs with `bun run test` (vitest, environment `node`).
