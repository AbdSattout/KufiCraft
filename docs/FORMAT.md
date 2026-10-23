# KufiCraft — `.kuficraft` project file (format **v2**)

One small JSON file per artwork — everything needed to redraw it, independent of
the server and of the app version family. This is the portability format the old
apps never had (see “Legacy” below).

## File conventions

| aspect | value |
| --- | --- |
| extension | `.kuficraft` |
| content | **minified JSON** (`JSON.stringify(value)`), UTF-8 |
| download name | sanitized project name + `.kuficraft`; fallback `لوحة-بلا-عنوان.kuficraft` |
| download | `Blob([text], { type: "application/json" })` + temporary `<a download>` |
| import | file picker **and** drag-and-drop (dashboard page + empty state) |

## Shape

```jsonc
{
  "format": "kuficraft",   // fixed literal
  "version": 2,            // integer, bump on breaking change
  "name": "لوحة بلا عنوان",
  "config": { /* ProjectConfig — convex/lib/model.ts */ },
  "items": [ /* CanvasItem[] — convex/lib/model.ts */ ],
  "exportedAt": "2026-10-17T08:00:00.000Z" // informational, optional
}
```

* `config` and `items` are **exactly** the shared model types: the same
  `convex/lib/model.ts` contract the database uses. One source of truth — never
  invent a parallel schema for the file.
* `items` are written in rendering order (last item on top), keys included.
  Field names are full words (`column`, `zone`, `from`, `points`) — see
  `docs/CANVAS.md` §3 for the four item types and their keys.
* `color` is **per item**: it is written on every item the editor creates, so a
  file looks the same no matter what `config.ink` is.
* A `line` / `arc` end and a `stroke` point may carry an optional
  `zone: 0 | 1 | 2 | 3` — the **fragment** the point sits on (`docs/CANVAS.md`
  §3): `0` is the ink square, `1`/`2` the x-/y-space strip, `3` the space
  square. Absent means zone 0, and zone 0 is never written, so a file from
  before fragments existed is unchanged. A space fragment adds `#<zone>` to the
  item key (`"line:2:3#1>4:3#1"`).
* A `stroke` point may carry an optional `anchor: { x, y }` — where inside that
  point's **own fragment** the point sits, as fractions of its extent (`0…1`,
  `docs/CANVAS.md` §3). Absent means the fragment centre, and the centre is
  never written (`0.5, 0.5` is dropped on write), so a file from before anchors
  existed is unchanged.
* An `arc` **endpoint** (`from` / `to`) takes the same optional `anchor`, read
  the other way round: absent means the reference app's **spring point**, so the
  centre is a real value and is written like any other (`docs/CANVAS.md` §5).
  The arc tool writes both endpoints whole; a legacy arc — neither endpoint
  anchored — keeps its exact old geometry, and an anchor-less diagonal `half`
  is repaired on read to the `quarter` that was already being drawn (same
  pixels; only that arc's key changes, on the next write).

### Style fields (`rounding`, `border`, `cap`, `join`)

These optional fields extend an item without changing its key or geometry — a
file that omits them renders **exactly** like a v2 file written before they
existed.

```jsonc
// tiles, line bars and polylines — rounded corners
"rounding": { "radius": 0.15, "corners": 15 }

// any item — one stroke around the whole shape
"border": { "width": 2, "color": "#7c2d12" }

// a tile — which sides of the box paint (absent = all four)
"border": { "width": 2, "color": "#7c2d12", "sides": 5 }

// a stroked item (diagonal line, polyline or arc) — how its ink ends and turns
"cap": "round",
"join": "bevel"
```

* `rounding.radius` is a **fraction of the shorter side** of the item's box,
  `0 < radius ≤ 0.5`, so a radius survives a change of cell size. `0.5` makes a
  pill; larger values are clamped because two corners would meet.
* `rounding.corners` is a bit mask of the corners **as seen on screen** — never
  mirrored by writing direction: `1` top-left, `2` top-right, `4` bottom-right,
  `8` bottom-left, `15` (default) all four. A vertex at a box corner follows its
  own bit; interior vertices of a shape (e.g. the hamza notch) follow the radius
  alone. Bits outside `15` are dropped.
* Rounding applies to every item with corners to round: a **tile** and a
  straight **line** bar round the corners of their own box; a **polyline**
  (`stroke`) rounds its interior turns from the same box-relative radius, with
  the box being the run's ink bounds. A turn that happens to sit on a bounds
  corner follows that corner's bit; the run's two ends stay square. An `arc`
  has no corners and never carries the field.
* The curve is generated from the shape's own geometry with the cubic
  midpoint-control construction of the reference `rounding.js` (Apache-2.0,
  Yona Appletree) — **not** an arc or a quadratic. Deliberate deviations: the
  reference's mutating “virtual close line” is replaced by trimming each edge
  exactly at the closing corner, and the radius is relative rather than a
  length.
* `cap` is how a stroked item's open ends finish: `butt` (flush, the default),
  `round` (a half-disc past the endpoint) or `square` (a half-square past it).
  `join` is how its turns meet: `miter` (pointed, the default), `round` or
  `bevel` (cut flat). Both are per item and apply to a diagonal `line` fallback,
  a `stroke` polyline and an `arc`; a plain line bar is filled and has no ink
  ends to shape. The default values are the absent state and are never written,
  so pre-option files round-trip byte-stable. The arc's endpoints and a
  polyline's turns use the stored values; a **border** on the same item inherits
  them, so a round end wraps the border around the ink.
* `border.width` is the **switch**: `0` means no border; `0 < width ≤ 12` is
  the visible band in **viewBox units** on each side. A broken width is the
  absent state. The slider in the editor works in whole units from `0` to
  `12`.
* `border.color` is the border's own colour. New borders store black
  (`#000000`) unless the user picks another; an empty or missing stored colour
  also resolves to black. It is never the item's ink colour.
* `border.sides` is a **tile-only** mask of the box sides as seen on screen:
  `1` top, `2` right, `4` bottom, `8` left, `15` all four. Absent means all
  four and is the canonical whole mask — never written — so a pre-sides border
  round-trips byte-stably; only a proper subset is stored. Unknown bits are
  dropped. No side on (`0` after masking) is the off state, exactly like width
  `0`: the border drops. A **line, polyline or arc** has no mask: its reader
  and constructors normalise the border to the whole form, so a hostile file
  cannot clip a non-tile.
* A border is **the item's own path stroked once, before the item**, in the
  border colour — never a translated copy, a second shape or a filter:
  * a **stroked** item (a polyline, an arc, a diagonal line fallback) is
    stroked again with `stroke-width = itemWidth + 2 × border.width`, same cap
    and join as its ink, so the visible band is exactly `border.width` on each
    side of the ink;
  * a **filled** item (tile, line bar) gets a native stroke of the same path,
    `2 × border.width` wide, painted before the fill. The fill covers the inner
    half, so the band is exactly `border.width` outside every edge and corner —
    rounded corners, circles, pills and concave shapes included.
  * a tile's **`sides` subset** keeps that same native stroke and clips it to
    the outside band of the selected sides (one rect per side, starting one
    band outside the box and stopping on its edge); the SVG output carries the
    rects in a `clipPath clipPathUnits="userSpaceOnUse"` addressed by the
    border path alone. A whole mask emits no clip and is byte-identical to the
    pre-sides rendering.
* Normalisation on read/write (backend and file import): radius clamped to
  `[0, 0.5]`, border width clamped to `[0, 12]`, colours capped at
  `MAX_COLOR_LENGTH`, the side mask masked to the four real bits. A zero radius
  drops `rounding`; a zero (or broken) border width and an empty side mask drop
  `border`; an unknown cap/join falls back to `butt`/`miter` and the
  defaults are dropped. All four sides are omitted, so the canonical whole
  border keeps its pre-sides JSON shape. Absent is the canonical “off” state,
  so a round-trip stays byte-stable. An empty border colour normalises to
  black.

## Rules

* **Export** lives in two places: the editor’s export menu
  (`تصدير → ملف KufiCraft (.kuficraft)`) and each dashboard card’s menu
  (`تصدير الملف`). Both export the full project (config + items), not the
  thumbnail. Writers always emit `version: 2`.
* **Import** lives on the dashboard: a button (`استيراد ملف`) and drag-and-drop
  onto the page. Importing always **creates a new project** and navigates to its
  editor; nothing is overwritten.
* **Validation on import** (client-side, never trust the file):
  1. parse JSON, then `format === "kuficraft"` → else
     `"هذا الملف ليس ملف KufiCraft"`;
  2. `version` must be known (`1` or `2`) → else `"إصدار الملف غير مدعوم"`;
  3. `config` is sanitized and clamped with the same semantics as the backend
     (`sanitizeConfig`: `ratio` snapped to the nearest `RATIO_PRESETS` value —
     so a v1 `0.5` stays the equal `1:1`, and a `ratio: 1` written back when
     `1:1` was still the space-less cell becomes `5/6` —, `base ∈ [4, 100]`,
     `circularSectors` rounded into `[MIN_CIRCULAR_SECTORS,
     MAX_CIRCULAR_SECTORS]` (default 36),
     `gridType ∈ {square, circular}`, unknown and legacy fields dropped — a file
     written before `straightLinesAsSquares` existed takes its default);
  4. `items` are structurally validated against the model (type discriminants
     `tile`/`line`/`stroke`/`arc`, a non-empty string key, finite integer
     coordinates inside the grid), key-deduped, and re-keyed from their geometry
     so a file cannot smuggle a non-canonical key; style fields are re-clamped
     and ineffective ones dropped (see “Style fields”); items that fail
     validation are dropped (only model fields are kept), as are degenerate arcs
     and strokes with fewer than two points; the list is capped at `MAX_ITEMS`
     (excess dropped, with a warning toast). A point's optional `anchor` is
     **repaired, never rejected**: finite fractions clamp into `[0, 1]`, and
     anything else (wrong shape, `NaN`, a stored centre) becomes the cell centre
     — so a write that was valid before anchors existed can never be refused for
     one. An **arc endpoint** repairs the other way: its damaged anchor becomes
     *absence* (the legacy spring point), and a stored centre is kept, because
     for an arc the centre is a real value. A legacy diagonal `half` arc has its
     `size` repaired to `quarter` — the reference app drew that half at
     `chord/√2`, which is exactly a quarter (`docs/CANVAS.md` §5), so nothing on
     screen moves;
  5. `name` is trimmed/collapsed like the backend and capped at
     `MAX_NAME_LENGTH`.
* Implemented in **one module** — `src/lib/kuficraft-file.ts` — used by both the
  editor and the dashboard: `exportProjectFile`, `parseProjectFile`,
  `downloadProjectFile`, `readProjectFile`, and the legacy bridge
  `upgradeItem`. Client-only; server code never reads project files.
* The file is the **document**, never a view: a circular board hides its
  line/arc items on screen (`docs/CANVAS.md` §3) but still writes, reads back
  and keeps them — export/import never drops an item because a grid cannot show
  it. (SVG/PNG exports and the dashboard thumbnail *are* views and leave them
  out.)
* Forward compatibility: readers reject unknown `version`s instead of guessing;
  writers must not emit unknown fields.

## v1 → v2 (reading an older file)

v1 is still readable; it is upgraded field by field before validation, so a v1
file cannot smuggle values past the v2 rules:

| v1 | v2 |
| --- | --- |
| `tile` `{t,i,j,q,s,r,c}` | `{type:"tile", column, row, zone, shape, rotation, color}` |
| `line` `{t,i1,j1,i2,j2,c}` | `{type:"line", from:{column,row}, to:{column,row}, color}` |
| `arch` `{t,i1,j1,i2,j2,d,c}` | `{type:"arc", from, to, direction, size:"half", color}` — v1’s `d` bulge flag becomes the sweep direction (`d === 1` → `counterclockwise`); a diagonal arch is stored as the `quarter` it was already drawn as (`docs/CANVAS.md` §5) |
| shapes `semi-hexagone` / `arc` | renamed `pentagon` / `curve` (`docs/CANVAS.md` §7) |
| `ratio: 0.5` (the old “متساوية” grid) | is a legal `1:1` — the equal cell, half ink and half space |

## Legacy (why there is no old JSON to import)

The old KufiCraft apps did **not** use JSON. They persisted raw SVG markup —
`localStorage.setItem("kq_data", board.svg.innerHTML)` — plus separate keys
(`kq_name`, `kq_mono`, `kq_size`), and exported PNG/SVG only. So:

* there is no legacy `.kuficraft` JSON in the wild;
* rescuing old artworks would mean parsing SVG markup back into grid items —
  a separate, lower-fidelity feature. Out of scope for v2; revisit only if users
  ask for it.
