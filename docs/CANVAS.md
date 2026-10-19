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
  cropped this way — even a `base` that divides the extent evenly: `base` 10 at
  the default `1:3` gives 100 cells of `1000 / 99.75 = 10.025`. A non-finite or
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
fragment; a `line`, `stroke` and `arc` always address **whole ink cells**
(`Cell`, i.e. zone 0), and their tools accept a click anywhere in the cell
(`inkAnchorAt`), so at `1:1` both the ink and the space half start a line or an
arc.

## 3. Items

The document is a list of `CanvasItem = TileItem | LineItem | StrokeItem | ArcItem`
(`convex/lib/model.ts`), each with a stable `key`. **Keys are identity**: adding
an item whose key already exists replaces it in place (paint-over, the old app's
recolour behaviour), on the client (`paintItems`) and on the backend
(`projects.applyOps`).

| type | fields | key |
| --- | --- | --- |
| `tile` | `column`, `row`, `zone`, `shape?`, `rotation?`, `color?` | `tile:<column>:<row>:<zone>` |
| `line` | `from`, `to` (`Cell`), `color?` | `line:<c>:<r>><c>:<r>` (cells canonical by column, then row) |
| `stroke` | `points` (`LinePoint[]`), `closed?`, `color?` | `stroke:<digest>` (FNV-1a of the point list — a point list is unbounded, a key is not) |
| `arc` | `from`, `to`, `direction`, `size`, `color?` | `arc:<c>:<r>><c>:<r>\|<direction>\|<size>` |

* `shape` is one of the ten `ShapeId`s (`SHAPE_IDS`), absent = `square`;
  `rotation` is quarter turns clockwise (`0…3`), absent = 0.
* `color` is a **per-item** colour: it is always written when an item is created
  (`resolvedColor(config, color) = color ?? config.ink`), so changing
  `config.ink` later never repaints what is already on the board. Absent means
  the item was authored before v2 or edited without a colour.
* A `line` is an axis-aligned bar of ink: a legal `line` shares one row **or**
  one column; a diagonal (or a 3+-point run) is a `stroke` polyline.
  `Arc.isSupported` accepts the same row / column / 45° diagonal cases.

### Line points (anchors)

A `stroke`'s points are `LinePoint = Cell & { anchor?: InkPoint }`: the cell,
plus where inside its **ink region** the point sits. An anchor is two fractions —
`InkPoint = { x, y }`, each in `[0, 1]` — of the ink region's extent, **not** an
index into a fixed palette, so the format can express free positioning without a
version bump; the editor only produces half-multiples today.

* **Absent anchor = centre.** `CENTRE_ANCHOR = (0.5, 0.5)`, and the centre is
  **never stored**: `linePoint()` drops an absent *or* centre anchor, so every
  value, key and file written before anchors existed round-trips byte-identically.
  `anchorOf(point)` reads a point's own anchor or the centre; `hasAnchor(point)`
  is true only for a non-centre anchor.
* **The nine anchors.** The editor snaps to `ANCHOR_GRID = {0, 0.5, 1}²`,
  row-major — `(0,0) (0.5,0) (1,0) / (0,0.5) (0.5,0.5) (1,0.5) / (0,1) (0.5,1) (1,1)`
  — the reference app's nine-cell geometry, now per point (§6 «Line rules»).
* **Keys.** `strokeKey` digests the point list; a non-centre anchor contributes
  `@x,y` to its point's payload (`"2:0@1,1"`), and an anchored point keys
  differently from its centre sibling.
* **Circular grid.** `x` is the fraction of the ink band's thickness (outwards
  from the inner ink edge) and `y` the fraction of the whole **sector**, not of
  the ink slice — the asymmetry exists so `(0.5, 0.5)` is exactly `cellCentre`
  on both grids, which back-compat demands.
* Readers **repair** an anchor instead of rejecting the item: `normalizeAnchor`
  clamps a finite `{x, y}` into `[0, 1]`, and anything else (wrong shape, `NaN`,
  a stored centre) becomes the cell centre — in `kuficraft-file.ts` and the
  backend's `sanitizeItem` alike, so a document that was valid before anchors
  existed is never rejected for carrying one.

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
(`convex/lib/model.ts`) and nothing else: every whole cell is copied to
`{column, row}` and every stroke point through `plainLinePoint`, which keeps a
non-centre `anchor` while dropping the stored centre and any foreign key beside
the cell. Tool state holds an `Anchor` (a cell **plus** a `zone`), and
`cellValidator` rejects the extra key — the reported `applyOps`
`ArgumentValidationError` was an arc that shipped the tool's `Anchor` unchanged.
The classes therefore copy their cells through `plainCell` in the constructor
**and** in `toJSON()`; `items.test.ts` sweeps every item type (and the edit
paths) against the validator's own field list.

### Item classes (`src/lib/canvas/items.ts`)

The data model above is what is stored; in the engine every item is a **class**
derived from the shared parent `KufiItem` (`Tile`, `Line`, `Stroke`, `Arc`),
which owns the geometry for that item and nothing else:

| member | meaning |
| --- | --- |
| `key` | the identity above, derived from the geometry in the constructor |
| `type` | the discriminant (`"tile" \| "line" \| "stroke" \| "arc"`) |
| `render(config)` | `Rendered = { path, mode: "fill" \| "stroke", width }` |
| `draw(config)` | `render` plus `borders`: one translated duplicate per enabled border side |
| `bounds(config)` / `contains(config, point)` | hit-testing and marquee geometry |
| `cellRange()` | the cell box the item occupies (move/duplicate maths) |
| `moved(dColumn, dRow)` / `withColor(color)` | copy-on-write edits |
| `toJSON()` | the stored `CanvasItem` (omits absent optional fields) |

`parseItem(item)` / `itemOf(item)` map a stored item onto its class;
`makeTile` / `makeLine` / `makeStroke` / `makeArc` are the factories the tools
use, and `styleItem` / `colorItem` / `moveItem` are the pure edit helpers.

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
| `grid.ts` | `pointToCell`, `pointToAnchor` → `Anchor`, `pointToLinePoint` → `LinePoint`, `linePointPosition`, `anchorToCell`, `cellCentre`, `isSameAxis`, `runOf(cells)` → `Run`, `cellsBetween`, `gridPaths` → `{ cellBorders, inkLines }`, `anchorPath` |
| `shapes.ts` | `KufiShape` + the ten shapes (`shapeById`, `shapeLabel`, `shapePath`, `shapeOrderIndex`, `SHAPE_ORDER`); the **same** renderer draws the canvas fragment and the toolbar icon (`tileIconPath`) |
| `rounding.ts` | `roundingRadius`, `rotateCornerMask`, `hasRounding`, `roundCorners` (per-corner rounding generated from a shape's own commands) |
| `border.ts` | `borderCopies` (one translated duplicate of the item's shape per enabled border side) |
| `items.ts` | the item classes and factories above, `itemRender`, `itemColor`, `itemBounds`, `itemContains`, `itemCellRange`, `tileIconPath`, `itemsBounds`, `itemIntersectsRect`, the per-grid rules (`isItemTypeAllowed`, `isItemAllowed`, `visibleItems`) |
| `ops.ts` | `addItems`, `removeItems`, `paintItems`, `replaceItems`, `toOps(prev, next)` → backend batch, `penItems`, `lineItems` |
| `render.ts` | `renderSvg(config, items, opts?)` → standalone SVG **string**, `renderThumbnail(config, items)` → compact string |

Every function is deterministic and side-effect free.

### Gesture → items

* **`penItems(config, anchors, style)`** — the pen paints **the anchors of the
  stroke**: the tool calls it with the in-flight anchor list, which grows by the
  cells each pointer event crossed — a fast drag fills the cells between two
  reported positions (`anchorsAlongLine`, see §6). Consecutive identical anchors
  collapse, and a fragment is always a `tile` — the pen never merges a straight
  run into a bar.
* **`lineItems(config, points, closed, color, style?)`** — a run whose points are
  all **centre** points — every point the pre-anchor model could make — follows
  the reference rules unchanged: a run with **no diagonal segment** is either one
  `line` bar in a single span, or — when `config.straightLinesAsSquares` is on
  (default) — one square per cell along every segment, which is what the
  reference app's straight line produced. Anything with a diagonal (including a
  closing segment) → one `stroke` polyline; `closed` adds the closing segment.
  `dedupeCells` drops immediate repeats (and the closing repeat), and a closed
  tiled run paints the first cell once. An **anchored** point (§3) sits inside
  its cell, which neither a bar nor a tile can express, so a run containing one
  is always a stroked polyline through the anchors; it is merged to its two ends
  only when it is open, straight, on the square grid, every point agrees on the
  anchor and the run does not double back. A mixed-anchor run is never merged,
  so no point a designer placed is dropped. The optional `style` carries the
  draw style's `rounding` and `border` into the items; with rounding on, a run
  is kept as **one** item — a `line` bar (its box corners round) or a `stroke`
  (its turns round) — because rounding independently tiled cells would notch the
  joins.
* **`toOps(prev, next)`** — diffs two item lists into the backend batch
  (`remove` + `add`) around the longest common *content* prefix, so a stroke
  re-sends only the tail it touched, never the whole board.

## 5. Rendering contract

* Every item renders through its class: `item.render(config)` →
  `{ path, mode, width }`.
  * `mode: "fill"` → `<path d fill={itemColor}>` (tiles, straight lines).
  * `mode: "stroke"` → `<path d fill="none" stroke={itemColor}
    stroke-width={width}>` (polylines, arcs, diagonal `line` fallbacks) with
    `width = inkUnit(config)`.
  * A stroke's path runs through each point's **anchored** position
    (`linePointPosition`). Only a **centre** end still takes the reference app's
    half-ink nudge out to the fragment edge; an explicit anchor is drawn exactly
    where it was placed (§3).
* The board draws `visibleItems(gridType, items)` (§3): a circular board leaves
  its line/arc items out of the canvas, the overlay, the exports and the
  thumbnail.
* **Style is part of the item, not the renderer**: a tile, a line bar and a
  polyline may carry `rounding` (radius as a fraction of the shorter side plus a
  physical corner mask) and **every** item may carry a `border` (side mask,
  offset in viewBox units, optional colour). `item.draw(config)` paints one
  **duplicate of the item's own path** per enabled side — translated by the
  width on that side — **before** `item.render(config)`, so the duplicate sits
  behind the ink and cannot cover it; absent fields render exactly like a
  pre-style document. Rounding geometry is generated in `rounding.ts` (tiles,
  line bars and polyline turns); the border duplicate is a translation applied
  to the item's own path in the renderers, never a filter, a shadow or a
  path-string rewrite.
* **Butt caps and mitre joins** — a rib ends flush with the ink edge, exactly
  like the reference app. No `stroke-linecap="round"` anywhere in artwork.
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

An `Arc` is a rib between two ink cells on the same row, the same column or a 45°
diagonal (`Arc.isSupported`). It is ported from the reference app
(`kufi.js` lines 285‑311 and its `radius()`), but derived from a **canonical**
cell order (`from` is the lower cell by column, then row) so the picture no
longer depends on which anchor was clicked first; the reference app's
click-order quirk became the explicit `direction` control
(`clockwise` / `counterclockwise`, literally the SVG sweep flag 1 / 0).

* **Horizontal chord** (`from.row === to.row`): `clockwise` springs off the ink's
  **bottom** edge and rises, `counterclockwise` off the **top** edge and falls;
  the ends sit at the ink centre line (`half = ink/2`).
* **Vertical chord** (`from.column === to.column`): `clockwise` springs off the
  **left** edge and turns right, `counterclockwise` off the **right** edge.
* **45° diagonal**: the four spring points are the two ink corners that face the
  chord, chosen by the sweep.
* `size: "half"` → a semicircle over the chord: radius `chord/2` (or
  `dColumn·cell + ink/2` on a diagonal), `largeArc = 0`.
* `size: "threeQuarter"` → 270°: radius `chord/√2`, `largeArc = 1`.
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
| `select` | تحديد | `V` | click selects (shift toggles), drag on an item moves the selection (clamped to the grid), drag on empty space marquee-selects |
| `pen` | قلم | `P` | press/drag colours the cells the pointer is moved over — one fragment per cell, and a fast drag fills the cells it flew over (`anchorsAlongLine`) |
| `line` | خط | `L` | **square grid only** (`creates: ["line"]`). Click sequence: click A, click B… commits an open run; click the last point again ends it, click the first one closes it. A drag also works (pointer-up ends the *drag*, not the run). Every click snaps to one of the nine anchors of the cell under the cursor, and the overlay's dot shows the point the next click would store; a run with no diagonal segment is squares (`straightLinesAsSquares`, default) or one bar |
| `eraser` | ممحاة | `E` | click/drag removes whatever the pointer touches; a fast drag sweeps the cells it flew over (hidden items are never touched) |
| `arc` | قوس | `A` | **square grid only** (`creates: ["arc"]`). Press-drag-release A→B, **or** click A then click B (clicking A again cancels) |
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
2. **A fast drag is filled in.** The pointer reports one position per event and
   can fly over whole cells, so the tool connects the cell under the pointer's
   **live** anchor (`cursor`) to the new one with `anchorsAlongLine` — a
   supercover walk of the segment between the two cell centres that advances
   one cell per gridline crossed and reports **both** cells at an exact corner
   crossing, so a diagonal stroke is edge-connected and never reads as dotted
   at `ratio < 1`. There is no teleport rule and no maximum gap: a stroke is
   the line between the positions the browser reported.
3. Anchors are deduplicated by identity (`anchorKey` = column/row/zone), so a
   fragment is never listed twice in one stroke: the fill drops the cells the
   stroke already carries instead of listing them again. De-dup decides what is
   **stored**, never where the fill starts — a pointer that retraces its own
   stroke stores nothing, yet the next segment still runs from where the
   pointer is (retracing to a T's junction and turning up paints the turn, not
   a chord from the bar's far end).
4. Nothing is previewed before the pointer touches the canvas (no hover ghost):
   the pen has no pending state, and the in-flight fragments are the real items.
5. Nothing merges: a straight run stays a row of `tile` fragments, never a bar.

The **eraser** sweeps the same way: the reported position is hit-tested exactly,
and every cell a fast drag flew over is hit-tested at its centre, so a quick
sweep does not skip the items it passed between two events. Its sweep runs from
the live pointer too, so a sweep that retraces itself does not brush a chord.

### Line rules

1. **Click sequence.** The line tool is not a drag: the first click starts a run,
   each further click extends it, clicking the **last** point again commits an
   open polyline, and clicking the **first** one (with ≥ 2 points) closes it
   (`Z` closes the path). Pointer-up ends the drag only — the tool is
   `persistent`, so the run stays alive between clicks.
2. **Snap.** A click and a hover resolve through `linePointAt` →
   `pointToLinePoint`: the cell under the cursor (`floor`, so a point exactly on
   a border belongs to the higher cell) and, inside its ink region, the
   **nearest of the nine anchors** of `ANCHOR_GRID` (§3) — per-axis rounding to
   `{0, ½, 1}` with a tie rounding to the higher fraction, the fraction clamped
   into the ink region, so a pointer in the cell's space strip snaps to the
   nearest ink edge of *its own* cell. The stored point carries its anchor; the
   format itself accepts any `[0, 1]` fraction.
3. **The dot.** While the tool is armed (hover included — an empty run exists
   before the first click), `ToolPreview.dot` is exactly the point the next
   click would store, drawn as an open circle at that position; the preview's
   marker ring still shows the run's first point.
4. **Repeats are allowed.** Line points are *not* deduplicated by cell: two
   points may share a cell as long as their anchors differ (a turn inside one
   cell), and a click on the exact first/last point finishes or closes the run
   instead of storing a repeat. A zero-length segment (two points at the same
   position, e.g. closing a run in one cell) is legal and draws nothing.
5. **Merging.** A run of centre points follows the pre-anchor rules byte for
   byte (§4 `lineItems`): squares or one bar, `dedupeCells`. Any non-centre
   anchor makes the run a stroked polyline, merged to its two ends only when it
   is open, straight, on the square grid, every point agrees on the anchor and
   the run does not double back; mixed anchors are never merged.
6. **Preview = commit.** The ghost and the click both go through `lineRun`, so
   the overlay can never show an endpoint (or a closing) the commit does not
   draw — the fix that ended the old preview/commit drift.

### Preview

`ToolPreview = { items, mode: "solid" | "ghost", keys, marquee, marker, dot }`:

* `items` — the pending items (the pen's real fragments, ghosted), `keys` — the
  items to ring (the eraser's sweep), `marquee` — the select box.
* `marker: Anchor | null` — the armed start cell of a click sequence sized
  through `anchorPath(config, anchor)`: the arc/line tool's first click stays
  visible until it commits. The overlay paints it as a filled highlight with no
  border.
* `dot: LinePoint | null` — the line tool's snap dot, the point the next click
  would store (§6 «Line rules»). The overlay paints it as an open circle of
  `inkUnit/3` radius at the point's anchored position. `null` for every other
  tool.

### Viewport: pan, zoom range and anchoring

The hand tool pans, the wheel zooms. The maths is pure, lives in
`interaction.ts` and is covered by `interaction.test.ts`:

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
* **Wheel zoom** — the plain wheel (no `Ctrl`/`Cmd`) over the canvas **zooms**:
  a **gesture** is a run of events with no quiet gap longer than
  `WHEEL_GESTURE_GAP_MS` (100 ms) travelling the same way, and its first event
  walks **exactly one stop** through `nextZoom`, whatever its size or
  `deltaMode` — one scroll must *visibly* zoom (Firefox's 3-line notch is
  48 px and a Linux trackpad event ~53 px, both under the 60 px stop, so
  banking alone left them doing nothing). Events continuing the gesture bank
  their pixels in ~60 px stops (`deltaMode` lines ×16, pages ×100) up to
  `WHEEL_GESTURE_MAX_STOPS` (4) per gesture, so a free-spin cannot cross the
  whole ladder at once; a direction flip starts a fresh gesture, so the bank of
  one way can never cancel the first stop of the other. The board fraction
  under the **pointer** stays under it.
* **Wheel zoom, modified** — `Ctrl`/`Cmd`+wheel is left to the browser:
  trackpad pinch and page zoom are accessibility features this pane must not
  swallow. The listener is attached by hand on the viewport (so the sidebar and
  panels keep their own wheel behaviour) because React's `onWheel` is passive
  and could not `preventDefault()` the pane's own scroll; a wheel during a live
  pointer gesture is swallowed — a mid-drag zoom would remap the gesture's
  coordinates — but only while the primary button is really down
  (`event.buttons`), so a missed pointer-up cannot mute the wheel for the rest
  of the session. The consequence is intended: the viewport no longer
  wheel-scrolls; the hand tool and the scrollbars still pan.
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
* Line points are anchored by **coordinates** (`anchor: {x, y}`, fractions of the
  cell's ink region), not by an index into a nine-position palette: the format
  accepts any fraction in `[0, 1]` while the tool produces the nine
  half-multiples, so free positioning needs no format change later. The centre
  is canonical storage of nothing (absent = centre *and* `linePoint` drops a
  stored centre), which is what keeps pre-anchor documents byte-identical; on
  the circular grid the anchor's `y` spans the whole sector rather than the ink
  slice, a deliberate asymmetry that keeps `(0.5, 0.5)` on `cellCentre`.
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
* The pen's gap fill is **back** (`anchorsAlongLine`, reversing the round that
  had removed it — a fast drag leaving scattered points was the live-testing
  complaint). It is a supercover walk, not a Bresenham line: both cells are
  reported at a corner crossing, there is no teleport rule and no maximum gap,
  the in-between cells carry the target anchor's zone, and the walk is capped at
  the grid's own cell count. The pen still never merges, and the eraser sweeps
  with the same fill.

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
round-trips, two-family grid paths, the drawn-cell tiling), `ratio.test.ts` (the
§2 invariant: the four fragments tile the cell and stay non-degenerate at every
preset, and the touch relation is identical across all `5×5` ratio pairs),
`items.test.ts`
(item classes, keys, geometry, hit-testing, rounding / border styling, the
stored shape against `canvasItemValidator`, the per-grid rules),
`ops.test.ts` (add/remove/paint/
replace, `toOps`, pen/line items, hidden items surviving the diff),
`model.test.ts` (presets, snapping, keys, signatures, style clamping),
`render.test.ts` (markup, thumbnail budget),
`rounding.test.ts` / `border.test.ts` (the style geometry), `kuficraft-file.test.ts`
(v2 round-trip + v1 upgrade), plus the backend `convex/**/*.test.ts` suites and
the editor's `tools.test.ts` /
`interaction.test.ts` / `shortcuts.test.ts`.
