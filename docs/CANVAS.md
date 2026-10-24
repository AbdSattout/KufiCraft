# KufiCraft — canvas model & engine contract

> **This file is the contract.** If code and this doc disagree, fix the doc in the
> same PR (or raise it with the orchestrator). The single source of truth for
> types/constants/validators is **`convex/lib/model.ts`** (client alias:
> `src/lib/canvas/model.ts` → re-export).
>
> Wave 4 rewrote the item model to match the reference app one-to-one: items are
> **classes** with full-word JSON field names, every tool is a class in a
> registry, and the pen paints the cells the pointer crossed — the ones a fast
> drag flew over included. This doc is the v2 contract.

## 1. Coordinate system

* SVG `viewBox="0 0 1000 1000"`; origin top-left, `y` grows **downwards**.
* `config.base` is the **stored** cell size — what the slider, the caption and
  the file format speak. Every renderer and interaction draws with the **drawn
  cell** `cellSize(config)` instead: the board is laid out over
  `gridCount(config)` whole cells across its extent (the viewBox edge on the
  square grid, the radius `500` on the circular one) and the **last cell's
  trailing space is cropped**, so the extent is covered exactly and the canvas
  ends with ink, never with a leftover space strip or a clamped sliver:

  `gridCount = round(extent / base)`, `cellSize = extent / (gridCount − 1 + ratio)`

  `base` 75 at `1:3` → 13 cells of `1000 / 12.75 = 78.431` (instead of 13 × 75
  plus a 25-unit sliver). No preset is space-less (`§2`), so every board is
  cropped this way — even a `base` that divides the extent evenly: the default
  `base` 50 at `1:3` gives 20 cells of `1000 / 19.75 = 50.633`. A non-finite or
  ≤ 0 `base`/`ratio` (never stored — `sanitizeConfig` clamps them) falls back
  to the defaults.
* Square grid: cell `(column, row)` covers
  `x ∈ [column·cell, (column+1)·cell)`, `y ∈ [row·cell, (row+1)·cell)`.
* Circular grid: centre `(500, 500)`; band `column` covers radius
  `[column·cell, (column+1)·cell)` — the outermost band's ink ends on the
  design circle (`500`) —; sector `row` covers angle
  `[row·unit, (row+1)·unit)` with `atan2(dy, dx)` normalised to `[0, 2π)`,
  where `unit = 360° / config.circularSectors`. The **board's own** sector count
  drives every angular computation (default `CIRCULAR_SECTORS` = 36 → 10°,
  bounded by `MIN_CIRCULAR_SECTORS` … `MAX_CIRCULAR_SECTORS`) through the two
  helpers `circularSectors(config)` and `circularAngularUnit(config)`: addressing
  (`pointToCell` / `pointToAnchor` / `cellCentre`), the construction grid's
  spokes, the slice paths and the shortest angular run (`shortestSectorDelta` /
  `sectorSpan`). Changing the count re-interprets existing items exactly like
  changing `base` does — the sector index keeps its meaning, not the artwork.

## 2. The ratio axis (ink : space)

Each cell (or circular slice) is split **per axis** at `config.ratio`, the ink
fraction of that axis. The ink part comes **first** on both axes (top / left on
the square grid, inner / counter-clockwise-start on the circular one), exactly
like the reference app's `rectFromPoint`.

`RATIO_PRESETS` (space:ink) are the only legal values, and every entry is the
honest `ink / (space + ink)` split of the cell:

| preset | space | ink | `ratio` | meaning |
| --- | --- | --- | --- | --- |
| `1:1` | 1 | 1 | `1/2` | **equal cell** — half ink beside half space; the lightest cell |
| `1:2` | 1 | 2 | `2/3` | |
| `1:3` | 1 | 3 | `3/4` | **default** (`DEFAULT_RATIO`) |
| `1:4` | 1 | 4 | `4/5` | |
| `1:5` | 1 | 5 | `5/6` | the densest cell |

* `MIN_RATIO` / `MAX_RATIO` are the numeric extremes of the presets (`1/2` /
  `5/6`), not the first and last entries: the list is ordered by *label*, so
  `1:1` is the lightest cell and `1:5` the densest.
* The backend snaps anything else with `snapRatio` (nearest preset; non-finite →
  `DEFAULT_RATIO`) and `ratioLabel` renders the preset the way designers write it.
* **No preset is space-less.** The v2 port inherited the old app's «mono» grid
  as a `ratio = 1` preset, and that was the connectivity bug: at `ratio = 1` the
  ink fragment is the whole cell and the three space fragments are zero-width,
  so a tile's zone was invisible (`zoneRect` drew all four zones as the same
  full cell) and two same-zone neighbours touched at `1:1` and at no other
  ratio. With every legal ratio strictly below `1` both symptoms are gone —
  structurally, without a special case in the switch.
* The scale is *not* clamped to ink ≥ space as a rule: `1:1` is the equal cell
  and `1:5` the densest, so every preset has `ratio ≥ 1/2` and a stored
  `ratio: 0.5` (v1 files, the old «متساوية» grid) is a legal `1:1` — while a
  stored `ratio: 1` (a board from before this fix) snaps to `5/6`, the nearest
  preset, on read.

### The invariant: the ratio never decides what touches

For every legal preset the four zone fragments of a cell have a **positive**
area and tile the cell exactly, and two fragments touch — share an edge of
positive length — **iff** their cells and zones say so:

* a fragment occupies, per axis, `[0, ratio)` (ink zone) or `[ratio, 1)` (space
  zone) of its cell;
* two fragments in neighbouring cells share an edge exactly when the sides
  facing each other are at the shared boundary — one fragment's space side
  against the other's ink side, i.e. `(zone & bit)` set against `(zone & bit)`
  clear on the axis that points at the neighbour — and the zones of the other
  axis are *equal*, or the fragments only meet at a corner;
* two fragments of one cell share an edge when their zones differ in exactly
  that one bit.

Both conditions are written in zone bits and cell indices only, never in
`ratio`: *changing the ratio changes how fat a fragment is, never what it
touches*. A connected drawing stays connected, a separated one stays separated,
and the four zones are pairwise distinct at every preset, so no two fragments
can collapse onto the same rect. A same-zone run across neighbouring cells
therefore never touches, at any preset — a continuous bar is a `line`/`stroke`
item, or a space fragment beside an ink one, never a `ratio = 1` special case.

### Zone rule

`Zone` is a 2-bit quadrant:

* bit 0 (`1`) → the **x** (square) / **radial** (circular) axis is in the space zone
* bit 1 (`2`) → the **y** (square) / **angular** (circular) axis is in the space zone

So `zone = 0` is the ink square of the cell (the old app's `isMainRect`) and
`zone = 3` the fragment in the space-space corner — congruent with `zone = 0` at
the equal `1:1`, the small one at every denser preset. A `TileItem` is one zone
fragment; a `line`, `stroke` and `arc` address a **fragment** too
(`FragmentPoint` / `LinePoint`, §3 — absent zone = the ink fragment), and their
tools arm on the fragment under the pointer, so every square of the cell, ink or
space, starts a line or an arc.

## 3. Items

The document is a list of `CanvasItem = TileItem | LineItem | StrokeItem | ArcItem`
(`convex/lib/model.ts`), each with a stable `key`. **Keys are identity**: adding
an item whose key already exists replaces it in place (paint-over, the old app's
recolour behaviour), on the client (`paintItems`) and on the backend
(`projects.applyOps`).

| type | fields | key |
| --- | --- | --- |
| `tile` | `column`, `row`, `zone`, `shape?`, `rotation?`, `color?` | `tile:<column>:<row>:<zone>` |
| `line` | `from`, `to` (`FragmentPoint`), `cap?`, `join?`, `color?` | `line:<f>><f>` (fragments canonical by column, then row, then zone) |
| `stroke` | `points` (`LinePoint[]`), `closed?`, `cap?`, `join?`, `color?` | `stroke:<digest>` (FNV-1a of the point list — a point list is unbounded, a key is not) |
| `arc` | `from`, `to` (`ArcPoint` — a fragment + optional `anchor`), `direction`, `size`, `cap?`, `join?`, `color?` | `arc:<f>><f>\|<direction>\|<size>` (fragments canonical by column, then row, then zone); an arc with a stored anchor ends in `\|<digest>` of its endpoints — an anchor-less arc keys exactly as before |

* `shape` is one of the ten `ShapeId`s (`SHAPE_IDS`), absent = `square`;
  `rotation` is quarter turns clockwise (`0…3`), absent = 0. `square` is
  **rotation-invariant** — it always fills its fragment's own box, including
  the non-square `space × ink` / `ink × space` strips at `1:2…1:5` — so the
  renderer ignores its `rotation`; the other nine shapes rotate normally.
* `color` is a **per-item** colour: it is always written when an item is created
  (`resolvedColor(config, color) = color ?? config.ink`), so changing
  `config.ink` later never repaints what is already on the board. Absent means
  the item was authored before v2 or edited without a colour.
* `from` / `to` / `points` address **fragments**, not just cells: a `zone` is
  optional and absent means zone 0, the ink square (§ below).
* A `line` is an axis-aligned bar of ink: a legal `line` shares one row **or**
  one column; a diagonal (or a 3+-point run) is a `stroke` polyline.
  `Arc.isSupported` accepts the same row / column / 45° diagonal cases.
* A stroked item may carry `cap` (`butt | round | square`, default `butt`) and
  `join` (`miter | round | bevel`, default `miter`). A line stores them for its
  diagonal fallback, a `stroke` uses them at its open ends/turns, and an `arc`
  uses them at its two endpoints. The defaults are the absent state; a border
  on the same item uses the same cap and join.

### Fragments and line points

A **fragment** is one of the four squares a cell is divided into (§2): the ink
square (`zone 0`) and the three space strips/squares (`1` = x-space, `2` =
y-space, `3` = both). Every line / arc end and every stroke point addresses a
**fragment**:

```
FragmentPoint = Cell & { zone?: 0 | 1 | 2 | 3 }   // absent = 0 (ink)
LinePoint     = FragmentPoint & { anchor?: InkPoint }
ArcPoint      = LinePoint                          // one point model
```

Lines, strokes and arcs share **one point type**. The only difference is how an
absent `anchor` is read: a line/stroke point means the fragment centre, while an
arc endpoint means the reference app's spring point (§5, «Arc geometry»).

A space fragment is an ordinary square to everything that edits the board — the
line and arc tools arm on it, its hover dot sits on it, hit-testing, marquee,
move, duplicate and erase treat it exactly like ink. **Only rendering differs**:
tiles paint their own fragment's box, and the line/arc geometry springs off it
(§5).

* **Moves at 1:1 are zone-aware.** A drag tracks the pointer's anchor — cell
  **and** zone — and resolves a `moveOffset`: a signed half-cell displacement
  (`2·Δcolumn + Δzone-bit` per axis). At the equal `1:1`, where the four
  fragments are congruent, that displacement is a real translation: each
  fragment's absolute half coordinate `2·column + bit` is shifted, and the
  carry or borrow becomes a new cell and half. A right-half fragment pushed
  right therefore moves into the next cell (zone 1 → next column, zone 0),
  while its left-half neighbour lands in zone 1 of its own cell; a same-cell
  drag between two zones moves the item instead of doing nothing. The signed
  step applies to every fragment a moved item carries (tile zone, line/arc
  endpoints, stroke points), and each anchor stays relative to its own
  fragment. At denser presets the half step is zero — a zone change would
  resize the fragment — so the zones ride along and only the cells move; the
  circular grid has no cartesian half-cell zones and never takes a half step.
  Preview and commit resolve the same offset, edge clamping shrinks the net
  translation (an outward `+½` at the right/bottom edge is dropped while an
  inward `−½` still applies), and the returned selection keys follow the new
  cells and zones.

* **Zone 0 is canonical storage of nothing.** `fragmentPoint()` / `linePoint()`
  drop an absent *or* zero zone, so every item, key and file written before
  fragments existed round-trips byte-identically; a space zone is stored as
  `"zone": n`, and a stored zone outside `0…3` is structural — the item is
  rejected, never silently moved to the ink square.
* **An anchor is relative to its own fragment.** `anchor` is two fractions
  `InkPoint = { x, y }`, each in `[0, 1]`, of **that fragment's box** — its
  `zoneRect` on the square grid, its `circularSlice` on the circular grid — not
  of the cell and not of the ink square. A click on a space fragment therefore
  stays on that space square, measured inside it, and never snaps across into
  the ink fragment.
* **Absent anchor = centre.** `CENTRE_ANCHOR = (0.5, 0.5)` is **never stored**:
  `linePoint()` drops an absent or centre anchor. `anchorOf(point)` reads a
  point's anchor or the centre; `hasAnchor(point)` is true only for a
  non-centre anchor.
* **The nine anchors.** The editor snaps to `ANCHOR_GRID = {0, 0.5, 1}²`,
  row-major — `(0,0) (0.5,0) (1,0) / (0,0.5) (0.5,0.5) (1,0.5) / (0,1) (0.5,1) (1,1)`
  — the reference app's nine-cell geometry, now measured inside the clicked
  fragment (§6 «Line rules»).
* **Keys.** `fragmentKey` appends `#<zone>` to a space fragment (`"2:3#1"`);
  `strokeKey` digests the point list with that fragment key and the anchor as
  before (`"2:0#1@1,1"`). Ink keys are exactly the pre-fragment strings; a space
  point keys differently from the ink point in the same cell. An arc appends a
  ≤ 7-character digest only when it stores an anchor, so its key stays inside
  `MAX_KEY_LENGTH` whatever fraction it carries (§ «Arc geometry»).
* **Circular grid.** `x` is the fraction of the fragment's radial band. `y` is
  the fraction of the **whole sector** when the point is angularly ink
  (`zone & 2 === 0`) — the asymmetry that keeps `(0.5, 0.5)` exactly
  `cellCentre` on both grids, which back-compat demands — and of the **space
  slice** when the point is angularly space (`zone & 2 !== 0`), so a space point
  is a point on its own slice.
* Readers **split** the failure modes: a bad zone rejects the item (it decides
  *where* the point is), while a bad anchor is **repaired** instead of rejecting
  it — `normalizeAnchor` clamps a finite `{x, y}` into `[0, 1]`, and anything
  else (wrong shape, `NaN`, a stored centre) becomes the fragment centre, in
  `kuficraft-file.ts` and the backend's `sanitizeItem` alike, so a document that
  was valid before anchors existed is never rejected for carrying one.
* **An arc endpoint reads the anchor the other way round.** `Arc.from` /
  `Arc.to` are `ArcPoint`s — the same point type, used by the arc. An **absent**
  anchor means the reference app's *spring point* for that endpoint (§5), not
  the centre, which is what keeps every pre-anchor arc drawing exactly as it
  did. The centre is therefore a real, storable anchor for an arc: the arc tool
  writes every click (`arcPoint` keeps what `linePoint` drops, `plainArcPoint`
  copies it) and the readers clamp through `normalizeArcAnchor`, which never
  drops the centre and turns damaged input into the spring-point fallback. An
  arc **keys** by the anchors it stores, so an explicit centre and an absent
  anchor are different ribs — as they are on screen.

### Per-grid item rules

A `line` bar and an `arc` rib are chords of the **square** grid; the polar grid
has no equivalent. One rule, one place (`items.ts`):

* On a **circular** board the line and arc **tools do not exist**. `KufiTool`
  declares `creates` (the item types it produces), and `isToolAvailable` reads it
  against `isItemTypeAllowed`: the rail lists `toolsFor(gridType)`, `L` / `A` are
  inert (`toolForShortcut(key, gridType)` → `null`), and a tool that was armed
  when the grid changed falls back to `fallbackTool(gridType)` with its gesture
  state cancelled (`use-editor.ts`).
* Existing `line` / `arc` items on a circular board are **hidden, not deleted**:
  not drawn (canvas and overlay), not hit-tested, not marquee-selected, not
  erasable, not duplicated, not arranged, not exported (SVG/PNG) and not in the
  thumbnail — and they cannot be in the selection (`pruneSelection`). Every one
  of those paths asks `isItemAllowed(config, item)` / `visibleItems(gridType,
  items)`, so a new renderer cannot forget the rule.
* The **document keeps them**. They stay in editor state, the undo/redo stack,
  every `applyOps` batch (`toOps` never emits a `remove` for them) and
  `.kuficraft` files, and switching back to a square grid draws them again
  untouched. Hidden means "cannot be edited", never "delete on sight"; the server
  validator is not narrowed and old files keep loading.

### Stored shape (the wire contract)

`toJSON()` emits **exactly** the fields of `canvasItemValidator`
(`convex/lib/model.ts`) and nothing else: every line end is copied through
`plainFragment` (`{column, row}` for the ink fragment, `{column, row, zone}` for
a space fragment), every stroke point through `plainLinePoint` (the same plus a
non-centre `anchor`, the stored centre dropped), and every arc endpoint through
`plainArcPoint` (the same copy, the centre **kept**). Tool state holds an
`Anchor` (a cell **plus** a required `zone`), which is assignable to a
`FragmentPoint`, and the arc tool resolves full points (`arcPointAt`), so its
state carries the fragment and anchor the renderer needs. The backend sanitiser
applies the same canonicalisation and re-derives the key from the fragments, so
a zone-0, anchor-less end is stored byte-identically to a pre-fragment one. The
classes therefore copy their fragments in the constructor **and** in
`toJSON()`; `items.test.ts` sweeps every item type (and the edit paths) against
the validator's own field list.

### Item classes (`src/lib/canvas/items.ts`)

The data model above is what is stored; in the engine every item is a **class**
derived from the shared parent `KufiItem` (`Tile`, `Line`, `Stroke`, `Arc`),
which owns the geometry for that item and nothing else:

| member | meaning |
| --- | --- |
| `key` | the identity above, derived from the geometry in the constructor |
| `type` | the discriminant (`"tile" \| "line" \| "stroke" \| "arc"`) |
| `render(config)` | `Rendered = { path, mode: "fill" \| "stroke", width, cap, join }` |
| `draw(config)` | `render` plus one optional border paint: a wider stroke of the same path, same cap/join |
| `bounds(config)` / `contains(config, point)` | hit-testing and marquee geometry |
| `cellRange()` | the cell box the item occupies (move/duplicate maths) |
| `moved(dColumn, dRow, dHalfColumn?, dHalfRow?)` / `withColor(color)` | copy-on-write edits (the optional signed half-cell steps are a 1:1 translation) |
| `fragments()` | every fragment the item addresses (move edge-clamping uses it) |
| `toJSON()` | the stored `CanvasItem` (omits absent optional fields) |

`parseItem(item)` / `itemOf(item)` map a stored item onto its class;
`makeTile` / `makeLine` / `makeStroke` / `makeArc` are the factories the tools
use, and `styleItem` / `colorItem` / `moveItem` are the pure edit helpers.

**Hit testing is the item's own paint, never its border.** `contains` answers
for exactly what the renderer paints: a tile's zone rectangle, a straight
line's bar, a stroke/arc band of half the ink width around its centreline. A
border is an outline painted *outside* that shape (§5 «Rendering contract»), so
including it would let a thick border claim the neighbouring fragment; `Tile`
has always ignored its border in `contains`, and every item now follows that
rule. This is why a line bar gets **no** `ink/2` padding: at the default 1:3
preset that would grow an ink bar from 7.5 to 15 units and a space stripe from
2.5 to 10, reaching the adjacent rows. Thin space stripes are still selectable
because the hit test is their exact painted rectangle.

### Stacking (z-order)

`items` **is** the render order: the last item in the array paints on top, and
hit-testing walks the array back to front, so the topmost item wins a click.
Nothing sorts or re-keys the list on save/load — `projects.applyOps` keeps a
`Map`'s insertion order, and `toOps` re-emits a reordered tail as
`remove` + `add` — so an arrange survives every round trip.

`arrangeItems(items, keys, action)` in `ops.ts` implements the four editor
commands (`front | forward | backward | back`). *front* / *back* are stable
partitions of the list around the selection, so unselected items and the
selection both keep their relative order; *forward* / *backward* step each
selected item past its nearest unselected neighbour, so a contiguous block moves
as one block. An action that changes nothing returns its input list — no commit,
no undo entry, disabled menu item.

## 4. Engine module layout (`src/lib/canvas/`)

Pure TypeScript, **no React, no DOM** (except `render.ts`, which returns strings).
This is what makes it testable and reusable by the editor, the dashboard previews
and export.

| file | exports |
| --- | --- |
| `model.ts` | re-export of `convex/lib/model.ts` |
| `geometry.ts` | `Point`, `Rect`, frames (`baseFrame`, `quarterTurnFrame`, `composeFrames`, `mapCommands`), `zoneRect`, `cellRect`, `circularSlice`, `sectorPath`, `slicePath`, `inkUnit`, `arcCentre`, `distanceToSegment/Polyline/Arc`, rect helpers (`boundsOfPoints`, `expandRect`, `rectContains`, `rectsIntersect`, `unionRect`) |
| `grid.ts` | `pointToCell`, `pointToAnchor` → `Anchor`, `pointToLinePoint` → `LinePoint`, `pointToArcPoint` → `LinePoint` (the centre kept), `linePointPosition`, `anchorToCell`, `cellCentre`, `isSameAxis`, `runOf(cells)` → `Run`, `cellsBetween`, `gridPaths` → `{ cellBorders, inkLines }` |
| `shapes.ts` | `KufiShape` + the ten shapes (`shapeById`, `shapeLabel`, `shapePath`, `shapeOrderIndex`, `SHAPE_ORDER`); the **same** renderer draws the canvas fragment and the toolbar icon (`tileIconPath`) |
| `rounding.ts` | `roundingRadius`, `rotateCornerMask`, `hasRounding`, `roundCorners` (per-corner rounding generated from a shape's own commands) |
| `border.ts` | `borderPaint` (one wider stroke of the item's own path, colour + stroke width), `borderSides`, `borderBand`, `borderClipRects` (outside-band rects for a partial tile side mask) |
| `items.ts` | the item classes and factories above, `itemRender`, `itemColor`, `itemBounds`, `itemContains`, `itemCellRange`, `tileIconPath`, `itemsBounds`, `itemIntersectsRect`, the per-grid rules (`isItemTypeAllowed`, `isItemAllowed`, `visibleItems`) |
| `ops.ts` | `addItems`, `removeItems`, `paintItems`, `replaceItems`, `toOps(prev, next)` → backend batch, `penItems`, `lineItems` |
| `render.ts` | `renderSvg(config, items, opts?)` → standalone SVG **string**, `renderThumbnail(config, items)` → compact string |

Every function is deterministic and side-effect free.

### Gesture → items

* **`penItems(config, anchors, style)`** — the pen paints **the anchors of the
  stroke**: the tool calls it with the in-flight anchor list, which grows by
  every fragment the pointer swept — a fast drag fills the cells and fragments
  between two reported positions (`anchorsAlongStroke`, see §6). Consecutive
  identical anchors collapse, and a fragment is always a `tile` — the pen never
  merges a straight run into a bar.
* **`lineItems(config, points, closed, color, style?)`** — fragments are first
  class. A run whose points are all **fragment centres** follows the reference
  rules unchanged, per fragment: a run with **no diagonal segment** that spans
  at least one cell boundary is either one `line` bar in a single span, or — when
  `config.straightLinesAsSquares` is on (default) — one square per cell along
  every segment, each square on the zone that was clicked (the in-between cells
  take the target point's zone, the spread `anchorsAlongLine` uses). Anything
  with a diagonal (including a closing segment) → one `stroke` polyline;
  `closed` adds the closing segment. `dedupeFragments` drops immediate repeats
  of the same **cell and zone** (and the closing repeat), and a closed tiled run
  paints the first cell once. Two fragments of the **same** cell are two
  positions inside it — no bar or square run can span less than a cell — so they
  are stroked. An **anchored** point (§3) sits inside its fragment, which
  neither a bar nor a tile can express, so a run containing one is always a
  stroked polyline through the anchors; it is merged to its two ends only when
  it is open, straight, on the square grid, every point agrees on the anchor
  **and zone**, and the run does not double back. A run with mixed anchors or
  zones is never merged, so no point a designer placed is dropped. The optional
  `style` carries the draw style's `rounding`, `border`, `cap` and `join` into
  the items; with rounding on, a run is kept as **one** item — a `line` bar (its
  box corners round) or a `stroke` (its turns round) — because rounding
  independently tiled cells would notch the joins.
* **`toOps(prev, next)`** — diffs two item lists into the backend batch
  (`remove` + `add`) around the longest common *content* prefix, so a stroke
  re-sends only the tail it touched, never the whole board.

## 5. Rendering contract

* Every item renders through its class: `item.render(config)` →
  `{ path, mode, width, cap, join }`; `item.draw(config)` adds the border paint
  below and is what renderers call. Filled items answer the default `cap`/`join`
  too, so every renderer can pass the pair through unconditionally.
  * `mode: "fill"` → `<path d fill={itemColor}>` (tiles, straight lines).
  * `mode: "stroke"` → `<path d fill="none" stroke={itemColor}
    stroke-width={width} stroke-linecap={cap} stroke-linejoin={join}>`
    (polylines, arcs, diagonal `line` fallbacks) with
    `width = inkUnit(config)`.
  * A stroke's path runs through each point's **anchored** position
    (`linePointPosition`). Only a **centre** end still takes the reference app's
    nudge out to the fragment edge; the nudge is **half of that point's own
    fragment span** (`zoneRect` on the square grid), so a space end reaches the
    space square's edge and an ink end is exactly the old half-ink nudge. An
    explicit anchor is drawn exactly where it was placed (§3).
* The board draws `visibleItems(gridType, items)` (§3): a circular board leaves
  its line/arc items out of the canvas, the overlay, the exports and the
  thumbnail.
* **Style is part of the item, not the renderer**: a tile, a line bar and a
  polyline may carry `rounding` (radius as a fraction of the shorter side plus a
  physical corner mask), every item may carry a `border` (band width in viewBox
  units, colour; width `0` means none; tiles may also carry a `sides` mask),
  and a stroked item may carry `cap` and
  `join`. `item.draw(config)` computes **one** border paint and paints it
  **before** `item.render(config)`, so the item always wins:
  * a **stroked** item (polyline, arc, diagonal line fallback) is stroked again
    with `stroke-width = item width + 2 × border width`, same path, same cap and
    join, in the border colour — the visible band is exactly `border width` on
    each side of the ink;
  * a **filled** item (tile, line bar) gets a native stroke of its own path,
    `2 × border width` wide, painted before the fill; the fill covers the inner
    half, so the band is exactly `border width` outside every edge and corner
    (rounded corners, circles, pills and concave shapes included).

  There is no duplicate geometry, no translation, no scale and no filter. Width
  is the switch: `0` paints none, a positive width paints the
  whole outline, and the colour is the border's own (black when a new border is
  created). Absent fields render exactly like a pre-style document. Rounding
  geometry is generated in `rounding.ts` (tiles, line bars and polyline
  turns).
* **A tile's `border.sides` mask** selects which sides of the box paint. The
  mask is a subset of the four physical sides (`1` top, `2` right, `4` bottom,
  `8` left as seen on screen); absent means all four and is the canonical form,
  never stored. A whole mask paints the whole outline with **no clip at all**,
  so pre-sides output is byte-identical. A proper subset keeps the same native
  stroke (no duplicate geometry) and clips it to the **outside band** of the
  selected sides — `borderClipRects(bounds, sides, band)` returns one rect per
  side, starting one band outside the box and stopping on its edge, so the
  inner half of the `2 × width` stroke is cut away. The SVG renderers emit the
  rects as a `clipPath clipPathUnits="userSpaceOnUse"` in `defs` and reference
  it from the border path only; rounded corners still follow the shape's own
  path. The mask belongs to tiles alone: line, polyline and arc constructors
  and style patches normalise their borders to the whole form, so a stray mask
  in a hostile file can never clip a non-tile. The line tool's straight-run
  squares are tiles, but a line gesture has no side selector; `lineItems`
  normalises that border to the whole form too.
* **Caps and joins are per item.** The defaults are butt caps and mitre joins —
  a rib ends flush with the ink edge, exactly like the reference app — and the
  cap/join controls store `round` or `square` ends and `round` or `bevel` turns
  only when chosen. React canvas, SVG string/export, PNG and thumbnails all read
  the same `Rendered` pair, and a border uses it too.
* `itemColor(config, item)` = `item.color ?? config.ink`.
* `config.background` paints the SVG background (`transparent` → no rect).
* `config.showGrid` draws the two-family construction grid (`gridPaths`), and
  **only in the editor** — never in thumbnails/exports:
  * `cellBorders` — whole-cell borders and the circular spokes/rings, opacity
    `0.28`;
  * `inkLines` — the inner edges that close each ink square (the ones that show
    «قلم / فراغ»), opacity `0.55`; always drawn, since every preset leaves real
    space inside the cell.
* Thumbnails: `renderThumbnail` renders at `viewBox="0 0 1000 1000"` without the
  grid, with a fixed light background, reduced precision and no key attributes;
  it must stay ≤ `MAX_THUMBNAIL_LENGTH` characters.

### Arc (قوس) geometry

An `Arc` is a rib between two **fragments** on the same row, the same column or
a 45° diagonal (`Arc.isSupported` — the *cells* decide, so the pair is still a
chord; two fragments of the same cell are rejected). Each endpoint is an
`ArcPoint` (§3): the fragment (cell + zone) plus the anchor the user picked
inside it. The item is derived from a **canonical** fragment order (`from` is
the lower by column, then row, then zone) so the picture never depends on which
endpoint was clicked first; the reference app's click-order quirk became the
explicit `direction` control (`clockwise` / `counterclockwise`, literally the
SVG sweep flag 1 / 0).

**Endpoint positions.** An endpoint with a stored anchor draws exactly there
(`linePointPosition`, inside its own `zoneRect`). An endpoint **without** one
falls back to the reference app's **spring point** (`kufi.js` 285‑311),
expressed as fractions of that endpoint's own fragment:

* **Horizontal chord** (`from.row === to.row`): `clockwise` springs off the
  fragment's **bottom** edge and rises, `counterclockwise` off the **top** edge
  and falls; the ends sit at the fragment's mid-width → both endpoints
  `(0.5, 1)` / `(0.5, 0)`.
* **Vertical chord** (`from.column === to.column`): `clockwise` springs off the
  **left** edge and turns right, `counterclockwise` off the **right** edge → both
  endpoints `(0, 0.5)` / `(1, 0.5)`.
* **45° diagonal**: the two fragment-edge midpoints facing the chord, chosen by
  the sweep (down + `clockwise` → start `(0, 0.5)`, end `(0.5, 1)`; down +
  `counterclockwise` → `(0.5, 0)` / `(1, 0.5)`).

**Radius and flags**, on the chord between those two positions:

| `size` | angle | radius | `largeArc` |
| --- | --- | --- | --- |
| `quarter` | 90° | `chord/√2` | 0 |
| `half` | 180° | `chord/2` | 0 |
| `threeQuarter` | 270° | `chord/√2` | 1 |

`sweep` is 1 for `clockwise` and 0 for `counterclockwise` — one uniform rule for
every chord, with no diagonal special case: the reference app's `radius()` picked
`dColumn·cell + ink/2` for a diagonal half, and for ink endpoints that value
**is** `chord/√2` (both chord components are `dColumn·cell + ink/2`), i.e. the
`quarter`. The editor therefore offers `quarter` explicitly and lets a diagonal
`half` be a real semicircle.

**Legacy arcs.** An arc whose two endpoints carry **no** anchor is the reference
app's arc and renders exactly as before: spring-point endpoints, and on a
diagonal the old radius expression `dColumn·cell + ink/2` (bit for bit, not
re-derived as `chord/√2`) — this includes a **space** endpoint, where the old
expression is not `chord/√2` at all, so it must survive the repair below. Any
arc with at least one stored anchor uses the uniform table above. Readers also
*repair* the legacy shape instead of re-deriving it per render: `repairArcSize`
turns an anchor-less diagonal `half` into `quarter` — the same radius, same
flags, no pixel changes (the geometry keeps the legacy expression for any
anchor-less diagonal) — in `kuficraft-file.ts` and in the backend's
`sanitizeItem`, so the next write stores the arc that was already on screen.
Every other legacy arc keeps its key byte-identically; only a repaired arc's
`|quarter` changes the key, and only on the next write.

**Hit area.** An arc is painted as a stroke of `inkUnit(config)` width, so
`Arc.contains` tests half that width (`ink/2`) on either side of the centreline,
inside the arc's angular sweep. Outside the sweep it measures to the nearest
endpoint, which is the round-cap half-disc of the same radius; `butt` caps are
flush, so that endpoint disc is a small bounded over-touch, and a `square`
cap's outer corners are not hit. Every cap allowance is bounded by `ink/2`, so
the hit area never grows past the width the stroke paints. The old full-
`inkUnit` radial tolerance doubled the painted band and is gone.

* A rib is a **square-grid item**: a circular board hides every `arc` (§3), so
  the class carries no polar geometry. (Earlier rounds drew a circular arc at the
  mean radius between the two bands; that path is gone, not disabled.)

## 6. Tools (`src/components/editor/tools.ts`)

One **class per tool**, all derived from `KufiTool`, each declaring its own
identity next to its behaviour and appended to the `REGISTRY` list. The rail,
the shortcuts and the controller read the registry; nothing switches on a tool
name. Adding a tool = one class + one registry line.

| id | label | key | gesture |
| --- | --- | --- | --- |
| `select` | تحديد | `V` | click selects (shift toggles), drag on an item moves the selection (clamped to the grid; at 1:1 the pointer's signed half-cell displacement carries/borrows per fragment), drag on empty space marquee-selects |
| `pen` | قلم | `P` | press/drag colours the fragments the pointer is moved over — every fragment it swept, and a fast drag fills all the fragments it flew over (`anchorsAlongStroke`), so speed never changes the stroke |
| `line` | خط | `L` | **square grid only** (`creates: ["line"]`). Click sequence: click A, click B… commits an open run; click the last point again ends it, click the first one closes it. A drag also works (pointer-up ends the *drag*, not the run). Every click snaps to one of the nine anchors of the **fragment** under the cursor (ink or space), and the overlay's dot shows the point the next click would store; a run with no diagonal segment is squares (`straightLinesAsSquares`, default) or one bar |
| `eraser` | ممحاة | `E` | click/drag removes whatever the pointer touches; a fast drag sweeps the cells it flew over (hidden items are never touched) |
| `arc` | قوس | `A` | **square grid only** (`creates: ["arc"]`). Press-drag-release A→B, **or** click A then click B (clicking the start cell again cancels). Each endpoint snaps to one of the nine anchors of the **fragment** under the cursor (`arcPointAt`) and stores it whole — the centre included, since an absent anchor means the legacy spring point (§5); the armed start is the same dot as the hover, and the ghost always shows the arc the click commits |
| `hand` | يد | `H` | the one **view** tool: the pointer scrolls the canvas pane (`panScrollOffset`), `KufiTool.pans` tells the controller so, and a double click recentres the board (`centreScroll`) |

* `KufiTool.creates` — the item types a tool produces. A grid that does not
  carry them does not carry the tool (`isToolAvailable`, §3): on a circular board
  the rail lists `toolsFor(gridType)` without `line`/`arc`, their shortcuts are
  inert, and the controller falls back when the grid changes under an armed
  tool.

* `KufiTool.persistent` — a tool whose in-flight state survives pointer-up
  (`line`, `arc`); the others commit on pointer-up.
* `KufiTool.pans` — a view tool: it never sees pointer input, owns no
  `ToolState`, and can therefore never reach the document, the history or the
  server. Its rail button (and the canvas) answers a double click with
  `centreView`. `hand` is the only one.
* `ToolState` is the in-flight gesture (`pen`, `erase`, `arc`, `line`, `marquee`,
  `move`, `none`); `ToolPreview` (below) is what the overlay paints.

### Pen rules

1. Every pointer position paints **the cell under the pointer** (its ink or
   space fragment, `anchorAt`) — the reference app's pen.
2. **A fast drag is filled in, fragment for fragment.** The pointer reports one
   position per event and can fly over whole cells, so the tool walks the
   **real pointer segment** (`anchorsAlongStroke`): every cell the segment
   crosses, and every fragment inside that cell the segment actually passes
   through (square grid — clipping the segment against the four zone rects;
   the circular grid samples the path and resolves each step). The start cell
   is included, because a move can change fragment without leaving its cell.
   A vertical drag down the ink column therefore paints the ink square *and*
   the y-space strip of each cell, exactly as a slow drag over the same path
   would, instead of carrying one endpoint zone across every skipped cell.
   There is no teleport rule and no maximum gap: a stroke is the path between
   the positions the browser reported.
3. Anchors are deduplicated by identity (`anchorKey` = column/row/zone), so a
   fragment is never listed twice in one stroke: the fill drops the fragments
   the stroke already carries instead of listing them again. De-dup decides
   what is **stored**, never where the fill starts — a pointer that retraces
   its own stroke stores nothing, yet the next segment still runs from where
   the pointer is (retracing to a T's junction and turning up paints the turn,
   not a chord from the bar's far end).
4. Nothing is previewed before the pointer touches the canvas (no hover ghost):
   the pen has no pending state, and the in-flight fragments are the real items.
5. Nothing merges: a straight run stays a row of `tile` fragments, never a bar.

The **eraser** sweeps the same way: the reported position is hit-tested exactly,
and every cell a fast drag flew over is hit-tested at the centre of the
fragment the sweep carries (the target anchor's zone), so a quick sweep does
not skip the items it passed between two events — in the ink square or in a
space fragment. Its sweep runs from the live pointer too, so a sweep that
retraces itself does not brush a chord.

### Line rules

1. **Click sequence.** The line tool is not a drag: the first click starts a run,
   each further click extends it, clicking the **last** point again commits an
   open polyline, and clicking the **first** one (with ≥ 2 points) closes it
   (`Z` closes the path). Pointer-up ends the drag only — the tool is
   `persistent`, so the run stays alive between clicks.
2. **Snap.** A click and a hover resolve through `linePointAt` →
   `pointToLinePoint`: the **fragment** under the cursor (`floor`, so a point
   exactly on a border belongs to the higher cell; the zone follows the same
   half-open convention) and, inside that fragment's own box, the **nearest of
   the nine anchors** of `ANCHOR_GRID` (§3) — per-axis rounding to `{0, ½, 1}`
   with a tie rounding to the higher fraction. A pointer on a space fragment
   snaps to an anchor *of that space square* and stores its zone; it never snaps
   across into the ink fragment. The stored point carries its zone and anchor;
   the format itself accepts any `[0, 1]` fraction.
3. **The dot.** While the tool is armed (hover included — an empty run exists
   before the first click), `ToolPreview.dot` is exactly the point the next
   click would store, drawn as an open circle at that position; the preview's
   marker is the run's first **point**, painted as the same dot (§6 «Preview»).
4. **Repeats are allowed.** Line points are *not* deduplicated by cell: two
   points may share a cell as long as their fragment or anchor differs (a turn
   inside one cell — including ink to space), and a click on the exact
   first/last point finishes or closes the run instead of storing a repeat. A
   zero-length segment (two points at the same position, e.g. closing a run in
   one cell) is legal and draws nothing.
5. **Merging.** A run of fragment-centre points follows the pre-anchor rules
   byte for byte (§4 `lineItems`): squares or one bar, `dedupeFragments`; the
   squares land on the clicked zones and the bar ends on the clicked fragments.
   Two fragments of one cell, or any non-centre anchor, make the run a stroked
   polyline, merged to its two ends only when it is open, straight, on the
   square grid, every point agrees on the anchor **and zone**, and the run does
   not double back; mixed anchors or zones are never merged.
6. **Preview = commit.** The ghost and the click both go through `lineRun`, so
   the overlay can never show an endpoint (or a closing) the commit does not
   draw — the fix that ended the old preview/commit drift.

### Arc rules

1. **Two gestures, one resolution.** Drag A→B (pointer-down arms, pointer-up
   commits) or click A then click B (the tool is `persistent`, so the state
   survives pointer-up; clicking the **start cell** again cancels). Both paths
   resolve their endpoints through `arcPointAt` → `pointToArcPoint` — the same
   nine anchors as a line point, but the resolved anchor is kept verbatim, the
   centre included: on an arc endpoint an absent anchor means the legacy spring
   point (§5), so dropping the centre would silently move the click onto the ink
   edge. Only anchors that are one of the nine half-multiples are produced; the
   format accepts any fraction.
2. **The dot.** On hover (including before the first click) `ToolPreview.dot`
   is the pending endpoint; once armed, the start point is the `marker` dot and
   `dot` is the pending end. Both are painted as the same small circle (§6
   «Preview»), never as a whole-cell square.
3. **Preview = commit.** The ghost and the commit both call `arcBetween`, which
   hands the endpoints to the `Arc` class whole, so the arc the click stores is
   the arc the overlay drew — anchors and all.
4. **Degenerate pairs are refused.** A same-cell pair (whatever anchors), or
   cells that share neither a row, a column nor a 45° diagonal, commits nothing
   (`Arc.isSupported`; §5).

### Preview

`ToolPreview = { items, mode: "solid" | "ghost", keys, marquee, marker, dot }`:

* `items` — the pending items (the pen's real fragments, ghosted), `keys` — the
  items to ring (the eraser's sweep), `marquee` — the select box.
* `marker: LinePoint | null` — the armed start **point** of a click sequence
  (the line's first point, the arc's start point). The overlay paints it as the
  same snap dot as `dot`, on the stored point itself, so the highlight shows
  where the click actually landed instead of lighting up a whole cell. Kept
  until the sequence commits or cancels.
* `dot: LinePoint | null` — the point the next click would store: the line
  tool's hover, the arc tool's pending end — and, before the arc's first click,
  the pending start. The overlay paints it as an open circle of `inkUnit/8`
  radius (the old dot was `inkUnit/3`) with a `1.5` px non-scaling ring, so it
  stays crisp at every zoom and never hides the ink it sits on. `null` when the
  tool has no pending point.

### Viewport: pan, zoom range and anchoring

The hand tool pans, `Ctrl`/`Cmd` + wheel zooms, `Shift` + wheel scrolls
horizontally, and the plain wheel scrolls the canvas pane. The maths is pure,
lives in `interaction.ts` and is covered by `interaction.test.ts`:

* **Pan** (`panScrollOffset`) — the board follows the hand: a rightward drag
  subtracts the pointer's X delta from `scrollLeft`, and `scrollTop` never
  flips. The app is `dir="rtl"`, and that scroller counts `scrollLeft` from the
  inline-start (right) edge towards **negative** values, so a rightward drag
  moves the offset deeper into its negative range rather than back towards
  zero. That is not a flip: a browser always moves the content opposite to
  `scrollLeft`, in RTL exactly as in LTR, so the helper deliberately takes no
  direction argument (only the dead “reverse” offset model would invert it,
  and it cannot be probed apart from the positive-descending one).
* **Zoom range** — `MIN_ZOOM` = 0.1, `MAX_ZOOM` = 32
  (`src/lib/editor-prefs.ts`; stored zooms are re-clamped on read). The ±
  buttons walk the `ZOOM_STOPS` ladder through `nextZoom`, stop and disable at
  the bounds, and the readout is `zoomPercent` — a whole percentage. The
  surface is `min(100%, 100svh - 14rem) × zoom`, so at 10 % a whole 1000-unit
  board is 100 px, and at 32× a `base` = 4 cell is ~87 px on a 900-px-tall
  window — drawing size, which the old 4× ceiling was not.
* **Plain wheel** — scrolls the canvas pane like any other scroller. It is
  never `preventDefault()`ed, so vertical and horizontal wheel/trackpad travel
  keep their normal browser behaviour (and the sidebar keeps its own).
  `Shift` + wheel stays the browser's horizontal scroll for the same reason.
* **Wheel zoom (`Ctrl`/`Cmd` + wheel)** — only the Ctrl- or Cmd-modified wheel
  zooms, including the `Ctrl` a macOS trackpad pinch reports. The zoom is ours,
  so the listener calls `preventDefault()` and the browser's page zoom never
  fires over the canvas. A **gesture** is a run of events with no quiet gap
  longer than `WHEEL_GESTURE_GAP_MS` (100 ms) travelling the same way, and its
  first event walks **exactly one stop** through `nextZoom`, whatever its size
  or `deltaMode` — one scroll must *visibly* zoom (Firefox's 3-line notch is
  48 px and a Linux trackpad event ~53 px, both under the 60 px stop, so
  banking alone left them doing nothing). Events continuing the gesture bank
  their pixels in ~60 px stops (`deltaMode` lines ×16, pages ×100) up to
  `WHEEL_GESTURE_MAX_STOPS` (4) per gesture, so a free-spin cannot cross the
  whole ladder at once; a direction flip starts a fresh gesture, so the bank of
  one way can never cancel the first stop of the other. The board fraction
  under the **pointer** stays under it.
* **Modifiers and mid-drag** — `Shift` + wheel is not ours: the browser maps
  it to horizontal scrolling and the listener returns without
  `preventDefault()`. The listener is attached by hand on the viewport (so the
  sidebar and panels keep their own wheel behaviour) because React's `onWheel`
  is passive and could not `preventDefault()` the Ctrl/Cmd zoom.
  `Ctrl`/`Cmd` + wheel during a live pointer gesture is swallowed — a mid-drag
  zoom would remap the gesture's coordinates — but only while the primary
  button is really down (`event.buttons`), so a missed pointer-up cannot mute
  the wheel for the rest of the session. A plain wheel still scrolls the pane
  mid-drag; a mid-drag Ctrl/Cmd-wheel is swallowed rather than zoomed,
  because a zoom would move the board under the gesture.
* **Anchoring** (`zoomScrollOffset`) — a zoom keeps one board point fixed on
  screen: the **pointer** for a wheel notch, the **middle of the pane** for
  the ± buttons (which are not on the canvas, so there is no pointer to
  anchor). The board fraction is captured before the surface resizes, and the
  scroll is corrected in a layout effect after it from the live rects, so a
  browser clamp while the range changes cannot skew the result. Zooming in
  from a centred board no longer jumps to the inline-start corner.

## 7. Resolved decisions (engine)

* `pentagon` is the old `semi-hexagone` (a typo *and* a misnomer: the glyph is a
  house-shaped pentagon); `curve` is the old shape `arc` (renamed so it cannot be
  confused with the `arc` tool); `comb` is the old untitled tenth entry.
* Shape ids other than `square` are never stored as `"square"` — `square` is the
  absence of `shape`.
* The `square` shape is **rotation-invariant**: it *is* the fragment's own box,
  so `KufiShape.path` ignores its stored `rotation` and leaves the physical
  corner mask unrotated. A quarter turn of a non-square space strip would swap
  its width and height and stop filling the fragment. On the circular grid a
  square is its annular sector, so every turn draws the same sector. Non-square
  shapes keep rotating normally.
* `hamza1` / `hamza2` band thickness `min(w, h)/3`; `curve` (old `arc`) band
  thickness `min(w, h)/2`, bulging outward — the palette glyphs are the
  specification (the old `getPathForShape` only ever drew squares).
* Non-square shapes on a circular grid are fitted into the slice frame with the
  local `+x` axis pointing outward along the radius.
* A `LineItem` that is diagonal (invalid by the model) falls back to a stroked
  segment between the two cell centres instead of throwing — the editor must
  prevent creating one.
* Lines and arcs are **square-grid items**: their polar branches were removed
  rather than disabled (hidden is not re-drawn), and a circular board hides them
  while the document keeps them (§3).
* Line points are anchored by **coordinates** (`anchor: {x, y}`, fractions of
  the point's **own fragment**), not by an index into a nine-position palette:
  the format accepts any fraction in `[0, 1]` while the tool produces the nine
  half-multiples, so free positioning needs no format change later. The centre
  is canonical storage of nothing (absent = centre *and* `linePoint` drops a
  stored centre), as is the ink zone, which is what keeps pre-anchor documents
  byte-identical; on the circular grid the anchor's `y` spans the whole sector
  for an ink-angular point and the space slice for a space-angular one, a
  deliberate asymmetry that keeps `(0.5, 0.5)` on `cellCentre`.
* An **arc endpoint** is the mirror image of a line point: its absent anchor is
  the reference app's spring point, so the centre is a real value, the arc tool
  stores every click (`arcPoint` / `plainArcPoint`, keyed by what it stores) and
  a damaged anchor repairs *to the fallback* rather than to the centre. A legacy
  anchor-less diagonal `half` is repaired on read to the `quarter` that drew it,
  which changes no pixel; the geometry keeps the old diagonal expression for an
  anchor-less arc, so a space endpoint also re-renders bit for bit (§5).
* The pen paints **over** what is already there: same key → replaced in place,
  which is how recolouring a fragment works.
* The ratio axis has **no space-less preset**. The port had made the old app's
  «mono» grid a `ratio = 1` "1:1", which collapsed every zone onto the whole
  cell and made same-zone neighbours touch only there — the switch then broke
  the pattern's connectivity. `1:1` is the honest equal cell now (half ink,
  half space); the invariant in §2 holds at all five presets. The two
  alternatives were rejected: letting a zone mean "where the gap is" turns the
  most common tile (zone 0) into a solid cell and rewrites how every existing
  board looks; merging neighbouring fragments at render time makes drawing
  depend on neighbours and fills the gaps the kufi pattern is made of.
* The pen's gap fill is **back and zone-aware** (`anchorsAlongStroke`, refining
  the `anchorsAlongLine` walk after live testing showed a fast vertical drag
  painting only the ink squares). It keeps the pointer's real segment and
  clips it against each cell's fragment rects, so a fast drag paints every
  fragment a slow drag over the same path would — ink square *and* paper strip
  — instead of carrying one endpoint zone across the skipped cells. The
  circular grid samples the segment the same way. There is still no teleport
  rule and no maximum gap, and the walk is capped at the grid's own cell
  count. The pen still never merges, and the eraser sweeps with its own
  `anchorsAlongLine` fill.

## 8. Quick start for consumers

```ts
import { itemOf, itemRender } from "@/lib/canvas/items";
import { renderSvg, renderThumbnail } from "@/lib/canvas/render";
import { pointToAnchor } from "@/lib/canvas/grid";
import { penItems, toOps } from "@/lib/canvas/ops";

// editor: pointer → anchors → items → backend batch
const anchor = pointToAnchor(config, viewBoxPoint);
const painted = penItems(config, [...strokeAnchors, anchor], { shape, rotation, color });
const ops = toOps(current, paintItems({ items: current }, painted).items);
await applyOps({ projectId, ops });

// dashboard/export: SVG string
const svg = renderThumbnail(config, items);   // ≤ 24 000 chars
const full = renderSvg(config, items, { showGrid: config.showGrid });
```

## 9. Test coverage

The engine suite (`bun run test`) covers, file by file: `geometry.test.ts`
(frames, zone rects, slices, arc centres), `grid.test.ts` (addressing,
round-trips — including every space fragment's own box — two-family grid paths,
the drawn-cell tiling), `ratio.test.ts` (the
§2 invariant: the four fragments tile the cell and stay non-degenerate at every
preset, the touch relation is identical across all `5×5` ratio pairs, and a
space fragment is a normal square — line points, tool runs and moves treat it
exactly like ink),
`items.test.ts`
(item classes, keys, geometry, hit-testing, rounding / border / cap / join
styling, the stored shape against `canvasItemValidator`, the per-grid rules),
`ops.test.ts` (add/remove/paint/
replace, `toOps`, pen/line items, hidden items surviving the diff),
`model.test.ts` (presets, snapping, keys, signatures, style clamping),
`render.test.ts` (markup, thumbnail budget),
`rounding.test.ts` / `border.test.ts` (the style geometry: one wider stroke of
the same path, legacy masks on/off, the four outside-band clip rects), `kuficraft-file.test.ts`
(v2 round-trip — fragment zones included — + v1 upgrade), plus the backend `convex/**/*.test.ts` suites and
the editor's `tools.test.ts` /
`interaction.test.ts` / `shortcuts.test.ts`.
