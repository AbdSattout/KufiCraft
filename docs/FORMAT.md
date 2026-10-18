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
* A `stroke` point may carry an optional `anchor: { x, y }` — where inside the
  cell's **ink region** the point sits, as fractions of its extent (`0…1`,
  `docs/CANVAS.md` §3). Absent means the cell centre, and the centre is never
  written (`0.5, 0.5` is dropped on write), so a file from before anchors existed
  is unchanged.

### Style fields (`rounding`, `border`)

Two optional fields extend an item without changing its key or geometry — a file
that omits them renders **exactly** like a v2 file written before they existed.

```jsonc
// tile only — rounded corners
"rounding": { "radius": 0.15, "corners": 15 }

// any item — an outside border on the sides of the item's box
"border": { "sides": 5, "width": 2, "color": "#7c2d12" }
```

* `rounding.radius` is a **fraction of the shorter side** of the item's box,
  `0 < radius ≤ 0.5`, so a radius survives a change of cell size. `0.5` makes a
  pill; larger values are clamped because two corners would meet.
* `rounding.corners` is a bit mask of the corners **as seen on screen** — never
  mirrored by writing direction: `1` top-left, `2` top-right, `4` bottom-right,
  `8` bottom-left, `15` (default) all four. A vertex at a box corner follows its
  own bit; interior vertices of a shape (e.g. the hamza notch) follow the radius
  alone. Bits outside `15` are dropped.
* The curve is generated from the shape's own geometry with the cubic
  midpoint-control construction of the reference `rounding.js` (Apache-2.0,
  Yona Appletree) — **not** an arc or a quadratic. Deliberate deviations: the
  reference's mutating “virtual close line” is replaced by trimming each edge
  exactly at the closing corner, and the radius is relative rather than a
  length.
* `border.sides` is a bit mask of the sides of the item's box: `1` top,
  `2` right, `4` bottom, `8` left, `15` all four. `border.width` is in **viewBox
  units** (`1…12`, default `2` when the field is present but broken). `color`
  is optional; absent means the item's resolved colour (`color ?? config.ink`).
* The border stroke lives **outside** the item: its inner edge touches the item's
  box, so it never covers or erodes ink, and enabled neighbours make an exact
  square outer corner. Each side is a separate subpath with butt caps.
* Normalisation on read/write (backend and file import): radius clamped to
  `[0, 0.5]`, masks masked to the four real bits, width clamped to `[1, 12]`,
  colours capped at `MAX_COLOR_LENGTH`. A zero radius drops `rounding`; a
  zero-side border drops `border` (file import also drops a border whose `sides`
  is missing or not a number rather than guessing all four) — absent is the
  canonical “off” state, so a round-trip stays byte-stable.

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
     anything else (wrong shape, `NaN`, a stored centre) becomes the cell
     centre — so a write that was valid before anchors existed can never be
     refused for one;
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
| `arch` `{t,i1,j1,i2,j2,d,c}` | `{type:"arc", from, to, direction, size:"half", color}` — v1’s `d` bulge flag becomes the sweep direction (`d === 1` → `counterclockwise`) |
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
