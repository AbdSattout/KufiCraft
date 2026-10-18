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
* Square grid: cells of `config.base` units. Cell `(column, row)` covers
  `x ∈ [column·base, (column+1)·base)`, `y ∈ [row·base, (row+1)·base)` — up to
  `VIEWBOX_SIZE / base` cells per axis.
* Circular grid: centre `(500, 500)`; band `column` covers radius
  `[column·base, (column+1)·base)`; sector `row` covers angle
  `[row·10°, (row+1)·10°)` with `atan2(dy, dx)` normalised to `[0, 2π)`
  (36 sectors, `CIRCULAR_SECTORS`).

## 2. The ratio axis (ink : space)

Each cell (or circular slice) is split **per axis** at `config.ratio`, the ink
fraction of that axis. The ink part comes **first** on both axes (top / left on
the square grid, inner / counter-clockwise-start on the circular one), exactly
like the reference app's `rectFromPoint`.

`RATIO_PRESETS` (space:ink) are the only legal values:

| preset | space | ink | `ratio` | meaning |
| --- | --- | --- | --- | --- |
| `1:1` | 0 | 1 | `1` | **space-less cell** — the ink fills the whole cell (the old app's «mono» grid) |
| `1:2` | 1 | 2 | `2/3` | |
| `1:3` | 1 | 3 | `3/4` | **default** (`DEFAULT_RATIO`) |
| `1:4` | 1 | 4 | `4/5` | |
| `1:5` | 1 | 5 | `5/6` | |

* `MIN_RATIO` / `MAX_RATIO` are the numeric extremes of the presets (`2/3` /
  `1`), not the first and last entries: the list is ordered by *label*, and the
  space-less `1:1` is the densest cell.
* The backend snaps anything else with `snapRatio` (nearest preset; non-finite →
  `DEFAULT_RATIO`) and `ratioLabel` renders the preset the way designers write it.
* At `ratio = 1` there is no inner edge: `zoneRect`/`circularSlice` give zone 0
  the whole cell, `pointToAnchor` always returns zone 0, and `gridPaths` leaves
  the inner (`inkLines`) family **empty** — it would land on the cell borders.
* Ink is never the smaller part, so every legal ratio is `≥ 2/3`; a stored
  `ratio: 0.5` (v1 files, old documents) snaps to `2/3` on read.

### Zone rule

`Zone` is a 2-bit quadrant:

* bit 0 (`1`) → the **x** (square) / **radial** (circular) axis is in the space zone
* bit 1 (`2`) → the **y** (square) / **angular** (circular) axis is in the space zone

So `zone = 0` is the main ink fragment (the old app's `isMainRect`), `zone = 3`
is the small space-space fragment. A `TileItem` is one zone fragment; a `line`,
`stroke` and `arc` always address **whole ink cells** (`Cell`, i.e. zone 0).

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
| `stroke` | `points` (`Cell[]`), `closed?`, `color?` | `stroke:<digest>` (FNV-1a of the point list — a point list is unbounded, a key is not) |
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

### Item classes (`src/lib/canvas/items.ts`)

The data model above is what is stored; in the engine every item is a **class**
derived from the shared parent `KufiItem` (`Tile`, `Line`, `Stroke`, `Arc`),
which owns the geometry for that item and nothing else:

| member | meaning |
| --- | --- |
| `key` | the identity above, derived from the geometry in the constructor |
| `type` | the discriminant (`"tile" \| "line" \| "stroke" \| "arc"`) |
| `render(config)` | `Rendered = { path, mode: "fill" \| "stroke", width }` |
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
| `grid.ts` | `pointToCell`, `pointToAnchor` → `Anchor`, `anchorToCell`, `cellCentre`, `isSameAxis`, `runOf(cells)` → `Run`, `cellsBetween`, `gridPaths` → `{ cellBorders, inkLines }`, `anchorPath` |
| `shapes.ts` | `KufiShape` + the ten shapes (`shapeById`, `shapeLabel`, `shapePath`, `shapeOrderIndex`, `SHAPE_ORDER`); the **same** renderer draws the canvas fragment and the toolbar icon (`tileIconPath`) |
| `items.ts` | the item classes and factories above, `itemRender`, `itemColor`, `itemBounds`, `itemContains`, `itemCellRange`, `tileIconPath`, `itemsBounds`, `itemIntersectsRect` |
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
* **`lineItems(config, points, closed, color)`** — a run with **no diagonal
  segment** is either one `line` bar in a single span, or — when
  `config.straightLinesAsSquares` is on (default) — one square per cell along
  every segment, which is what the reference app's straight line produced.
  Anything with a diagonal (including a closing segment) → one `stroke`
  polyline; `closed` adds the closing segment. `dedupeCells` drops immediate
  repeats (and the closing repeat), and a closed tiled run paints the first cell
  once.
* **`toOps(prev, next)`** — diffs two item lists into the backend batch
  (`remove` + `add`) around the longest common *content* prefix, so a stroke
  re-sends only the tail it touched, never the whole board.

## 5. Rendering contract

* Every item renders through its class: `item.render(config)` →
  `{ path, mode, width }`.
  * `mode: "fill"` → `<path d fill={itemColor}>` (tiles, straight lines on the
    square grid, circular lines).
  * `mode: "stroke"` → `<path d fill="none" stroke={itemColor}
    stroke-width={width}>` (polylines, arcs, diagonal `line` fallbacks, circular
    arcs) with `width = inkUnit(config)`.
* **Butt caps and mitre joins** — a rib ends flush with the ink edge, exactly
  like the reference app. No `stroke-linecap="round"` anywhere in artwork.
* `itemColor(config, item)` = `item.color ?? config.ink`.
* `config.background` paints the SVG background (`transparent` → no rect).
* `config.showGrid` draws the two-family construction grid (`gridPaths`), and
  **only in the editor** — never in thumbnails/exports:
  * `cellBorders` — whole-cell borders and the circular spokes/rings, opacity
    `0.28`;
  * `inkLines` — the inner edges that close each ink square (the ones that show
    «قلم / فراغ»), opacity `0.55`, empty at `ratio = 1`.
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
  `dColumn·base + ink/2` on a diagonal), `largeArc = 0`.
* `size: "threeQuarter"` → 270°: radius `chord/√2`, `largeArc = 1`.
* On the circular grid the arc runs at the mean radius between the two bands,
  spanning the sectors from `from.row` to `to.row` along the shortest angular
  path, with the same sweep-flag meaning.

## 6. Tools (`src/components/editor/tools.ts`)

One **class per tool**, all derived from `KufiTool`, each declaring its own
identity next to its behaviour and appended to the `REGISTRY` list. The rail,
the shortcuts and the controller read the registry; nothing switches on a tool
name. Adding a tool = one class + one registry line.

| id | label | key | gesture |
| --- | --- | --- | --- |
| `select` | تحديد | `V` | click selects (shift toggles), drag on an item moves the selection (clamped to the grid), drag on empty space marquee-selects |
| `pen` | قلم | `P` | press/drag colours the cells the pointer is moved over — one fragment per cell, and a fast drag fills the cells it flew over (`anchorsAlongLine`) |
| `line` | خط | `L` | click sequence: click A, click B… commits an open run; click the last point again ends it, click the first one closes it. A drag also works (pointer-up ends the *drag*, not the run). A run with no diagonal segment is squares (`straightLinesAsSquares`, default) or one bar |
| `eraser` | ممحاة | `E` | click/drag removes whatever the pointer touches; a fast drag sweeps the cells it flew over |
| `arc` | قوس | `A` | press-drag-release A→B, **or** click A then click B (clicking A again cancels) |
| `hand` | يد | `H` | the one **view** tool: the pointer scrolls the canvas pane (`panScrollOffset`), `KufiTool.pans` tells the controller so, and a double click recentres the board (`centreScroll`) |

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
   can fly over whole cells, so the tool connects its last anchor to the new one
   with `anchorsAlongLine` — a supercover walk of the segment between the two
   cell centres that advances one cell per gridline crossed and reports **both**
   cells at an exact corner crossing, so a diagonal stroke is edge-connected and
   never reads as dotted at `ratio < 1`. There is no teleport rule and no
   maximum gap: a stroke is the line between the positions the browser reported.
3. Anchors are deduplicated by identity (`anchorKey` = column/row/zone), so a
   fragment is never listed twice in one stroke: the fill drops the cells the
   stroke already carries instead of listing them again.
4. Nothing is previewed before the pointer touches the canvas (no hover ghost):
   the pen has no pending state, and the in-flight fragments are the real items.
5. Nothing merges: a straight run stays a row of `tile` fragments, never a bar.

The **eraser** sweeps the same way: the reported position is hit-tested exactly,
and every cell a fast drag flew over is hit-tested at its centre, so a quick
sweep does not skip the items it passed between two events.

### Preview

`ToolPreview = { items, mode: "solid" | "ghost", keys, marquee, marker }`:

* `items` — the pending items (the pen's real fragments, ghosted), `keys` — the
  items to ring (the eraser's sweep), `marquee` — the select box.
* `marker: Anchor | null` — the armed start cell of a click sequence sized
  through `anchorPath(config, anchor)`: the arc/line tool's first click stays
  visible until it commits. The overlay paints it as a filled highlight with no
  border.

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
* The pen paints **over** what is already there: same key → replaced in place,
  which is how recolouring a fragment works.
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
round-trips, two-family grid paths, the space-less `1:1` case), `items.test.ts`
(item classes, keys, geometry, hit-testing), `ops.test.ts` (add/remove/paint/
replace, `toOps`, pen/line items), `model.test.ts` (presets, snapping, keys,
signatures), `render.test.ts` (markup, thumbnail budget), `kuficraft-file.test.ts`
(v2 round-trip + v1 upgrade), plus the backend `convex/**/*.test.ts` suites and
the editor's `tools.test.ts` / `interaction.test.ts`.
