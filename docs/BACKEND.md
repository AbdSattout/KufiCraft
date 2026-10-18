# KufiCraft — backend contract (Convex)

Backend is **live** on the dev deployment `adamant-dragon-860`
(team `abdsat` / project `kuficraft`). `.env.local` is linked.

## Tables

`convex/schema.ts`

* `projects`: `userId` (Better Auth user id = `identity.subject`), `name`,
  `config` (`projectConfigValidator`), `items` (`canvasItemValidator[]`, deduped
  by key, last item renders on top), `itemCount`, `thumbnail` (compact SVG string
  or `null`), `createdAt`, `updatedAt`.
  Index: `by_user_and_updated` (its `userId` prefix also serves
  "all of one user's projects", so no separate `by_user` index is needed).
* Auth tables live inside the `betterAuth` component — never query them directly.

## Functions

`convex/projects.ts` — every function requires an authenticated caller and only
touches documents whose `userId === identity.subject`:

| function | args | returns |
| --- | --- | --- |
| `list` | — | summaries (no `items`), newest first, capped at `LIST_LIMIT` documents |
| `get` | `{ projectId }` | full doc with a repaired `config` (`sanitizeConfig`), or `null` if not found/not owner |
| `create` | `{ name, config }` | new id |
| `rename` | `{ projectId, name }` | — |
| `remove` | `{ projectId }` | — |
| `duplicate` | `{ projectId }` | new id (name + `(نسخة)`, items re-sanitised) |
| `updateConfig` | `{ projectId, patch }` | — (partial merge, sanitised) |
| `updateThumbnail` | `{ projectId, thumbnail }` | — (stores `null` when > 24 000 chars) |
| `applyOps` | `{ projectId, ops }` | `{ itemCount, updatedAt }` |

`ops` is an ordered batch of `{type:"add", items}` | `{type:"remove", keys}` |
`{type:"replace", items}` — one call per completed user gesture, atomic.

`convex/auth.ts` — Better Auth options (`createAuthOptions`), the passkey
`resolveUser`/`afterVerification` hooks, and `createAuth`. Nothing else: there is
no user-profile query, because an account has no profile — it is its passkey
(`docs/AUTH.md § Accounts`).

## Limits & conventions

* `MAX_ITEMS = 8_192`, enforced on **every** path that can add items — the
  `add` and `replace` branches of `applyOps` and the copy in `duplicate` — via
  `enforceItemLimit`, which throws the Arabic limit error. `create` starts empty
  (`items: []`), so it cannot exceed it. Exceeding the cap throws *before* the
  `ctx.db.patch`, so the mutation rolls back and the document is untouched.
  (Convex itself caps every array value at 8 192 elements, so a larger cap could
  only ever fail with a raw system error.)
* `MAX_NAME_LENGTH = 120`,
  `MAX_THUMBNAIL_LENGTH = 24_000`, `MAX_COLOR_LENGTH = 32` (ink/background and
  an item's `color` are CSS strings and are **truncated**, not rejected),
  `MAX_KEY_LENGTH = 64` (an item's `key` is **rejected** with the Arabic error
  when longer — truncating a key would silently merge distinct items; the
  longest generated key is an arc's, 48 characters),
  `ratio` is one of `RATIO_PRESETS` (`1:1` … `1:5`, the equal half-ink cell
  first, no space-less preset — `docs/CANVAS.md` §2), `base ∈ [4, 100]`, and the
  circular board's `circularSectors ∈ [MIN_CIRCULAR_SECTORS,
  MAX_CIRCULAR_SECTORS]` (rounded to a whole number of divisions).
* `list` is a bounded scan: `.take(LIST_LIMIT)` with `LIST_LIMIT = 100`
  (newest first). `items` live in the same document as the summary, so Convex
  reads the full document — including every item — just to project the summary.
  The ceiling is therefore *100 full documents per `list` call*. The structural
  fix (move `items` into their own per-project table / chunk them so summaries
  are cheap) is a known limitation, deliberately **not** attempted here.
* **Write sanitisation** (`sanitizeItem` / `sanitizeConfig` in
  `convex/projects.ts`) runs on every write path, so a document stored under an
  older contract is normalised (repaired) the next time it is written:
  * item keys are **re-derived from the geometry** (`tileKey`, `lineKey`,
    `strokeKey`, `arcKey`), so a client cannot store a non-canonical key, and an
    item whose `key` disagrees with its coordinates lands under the canonical one.
  * item coordinates (tile `column`/`row`, line/arc `from`/`to`,
    stroke `points`) are made finite, integer
    (`Math.trunc`) and clamped to `0 … maxGridIndex(base)`
    (`= floor(VIEWBOX_SIZE / base)`, at most `VIEWBOX_SIZE / 4 = 250` for
    `base = 4`). On a circular grid the sector axis
    (tile `row`, line/arc `to.row`, stroke point `row`) is capped at
    `circularSectors(config) - 1` (the board's own count — default
    `CIRCULAR_SECTORS - 1 = 35`). `NaN` → `0`, `+Infinity` → the bound it points
    at (a bare `Math.min/max` propagates `NaN` and would store a non-value).
  * an item colour is sliced to `MAX_COLOR_LENGTH`.
  * an item that does not match a v2 type is **dropped** (never stored): an
    unknown discriminant, a degenerate arc (`from` and `to` on the same cell) or
    a stroke with fewer than two points returns `null` and is skipped.
  * the `ratio` in `config` is snapped to the nearest `RATIO_PRESETS` entry
    (`snapRatio`; `NaN` → `DEFAULT_RATIO`; a v1 `0.5` → `2/3`).
  * `config` is rebuilt field by field on every read and write
    (`sanitizeConfig`). A field added later is `v.optional()` in the validator
    and defaults in the sanitiser, so a document written before it existed still
    validates and is repaired on read and on its next write. The removed
    `mergeLines` flag stays in the validator as `v.optional()` for exactly that
    reason and is dropped by the sanitiser.
    Asserted by `convex/projects.test.ts`.
* `duplicate` reserves room for the `" (نسخة)"` suffix before truncating the
  base name, so a name at the cap never loses the suffix.
* `updateThumbnail` deliberately does **not** bump `updatedAt` — thumbnails are
  derived from edits whose `applyOps` batch already bumped it (this keeps
  dashboard ordering a function of user edits, not thumbnail refreshes).
  Asserted by `convex/projects.test.ts`.
* Names are trimmed/collapsed; empty → `"لوحة بلا عنوان"`.
* Errors are thrown as `ConvexError` with **Arabic** user-facing messages
  (`"يجب تسجيل الدخول أولًا"`, `"المشروع غير موجود"`,
  `"تجاوزت اللوحة الحد الأقصى للعناصر"`, `"مفتاح العنصر أطول من الحد المسموح"`)
  — show `error.data` in a `sonner` toast.
* Validators are shared with the client from `convex/lib/model.ts`; the client
  imports them via `@/lib/canvas/model`. **Never** duplicate a validator.
* Thin handlers only — no business logic that belongs in the engine.

## Working on the backend

```bash
bunx convex dev --once     # push functions + regenerate convex/_generated (types)
bunx convex dev            # watch mode (leave running while developing)
bunx tsc --noEmit          # always green before committing
```

`convex/_generated` **is committed** so other checkouts/agents typecheck without
deploy access. Never edit it by hand.

> **A model change without a push breaks the app silently.** The deployment
> validates stored documents against the *deployed* validators; when the
> deployment is older than the client, new-format fields look invalid, queries
> return documents with those fields missing/empty and every write is rejected —
> the editor appears to “save then revert”. After touching
> `convex/lib/model.ts`, `convex/schema.ts` or `convex/projects.ts`, push with
> `bunx convex dev --once` (or keep `bunx convex dev` running) and verify:
>
> ```bash
> bunx convex function-spec | grep -c '"column"'   # > 0 on a v2 deployment
> ```
