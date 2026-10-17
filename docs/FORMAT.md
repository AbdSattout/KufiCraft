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
     so a v1 `0.5` becomes `2/3` —, `base ∈ [4, 100]`,
     `gridType ∈ {square, circular}`, unknown fields dropped);
  4. `items` are structurally validated against the model (type discriminants
     `tile`/`line`/`stroke`/`arc`, a non-empty string key, finite integer
     coordinates inside the grid), key-deduped, and re-keyed from their geometry
     so a file cannot smuggle a non-canonical key; items that fail validation are
     dropped (only model fields are kept), as are degenerate arcs and strokes
     with fewer than two points; the list is capped at `MAX_ITEMS` (excess
     dropped, with a warning toast);
  5. `name` is trimmed/collapsed like the backend and capped at
     `MAX_NAME_LENGTH`.
* Implemented in **one module** — `src/lib/kuficraft-file.ts` — used by both the
  editor and the dashboard: `exportProjectFile`, `parseProjectFile`,
  `downloadProjectFile`, `readProjectFile`, and the legacy bridge
  `upgradeItem`. Client-only; server code never reads project files.
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
| `ratio: 0.5` (the old “متساوية” cell) | snaps to `2/3`; `1:1` is now the space-less mono cell |

## Legacy (why there is no old JSON to import)

The old KufiCraft apps did **not** use JSON. They persisted raw SVG markup —
`localStorage.setItem("kq_data", board.svg.innerHTML)` — plus separate keys
(`kq_name`, `kq_mono`, `kq_size`), and exported PNG/SVG only. So:

* there is no legacy `.kuficraft` JSON in the wild;
* rescuing old artworks would mean parsing SVG markup back into grid items —
  a separate, lower-fidelity feature. Out of scope for v2; revisit only if users
  ask for it.
