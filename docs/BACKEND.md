# KufiCraft — backend contract (Convex)

Backend is **live** on the dev deployment `adamant-dragon-860`
(team `abdsat` / project `kuficraft`). `.env.local` is linked.

## Tables

`convex/schema.ts`

* `projects`: `userId` (Better Auth user id = `identity.subject`), `name`,
  `config` (`projectConfigValidator`), `items` (`canvasItemValidator[]`, deduped
  by key, last item renders on top), `itemCount`, `thumbnail` (compact SVG string
  or `null`), `createdAt`, `updatedAt`.
  Indexes: `by_user`, `by_user_and_updated`.
* Auth tables live inside the `betterAuth` component — never query them directly.

## Functions

`convex/projects.ts` — every function requires an authenticated caller and only
touches documents whose `userId === identity.subject`:

| function | args | returns |
| --- | --- | --- |
| `list` | — | summaries (no `items`), newest first |
| `get` | `{ projectId }` | full doc, or `null` if not found/not owner |
| `create` | `{ name, config }` | new id |
| `rename` | `{ projectId, name }` | — |
| `remove` | `{ projectId }` | — |
| `duplicate` | `{ projectId }` | new id (name + `(نسخة)`) |
| `updateConfig` | `{ projectId, patch }` | — (partial merge, clamped) |
| `updateThumbnail` | `{ projectId, thumbnail }` | — (stores `null` when > 24 000 chars) |
| `applyOps` | `{ projectId, ops }` | `{ itemCount, updatedAt }` |

`ops` is an ordered batch of `{type:"add", items}` | `{type:"remove", keys}` |
`{type:"replace", items}` — one call per completed user gesture, atomic.

`convex/auth.ts` — `getCurrentUser` (profile or `null`).

## Limits & conventions

* `MAX_ITEMS = 20_000` (exceeding it throws), `MAX_NAME_LENGTH = 120`,
  `MAX_THUMBNAIL_LENGTH = 24_000`, `ratio ∈ [0.25, 0.75]`, `base ∈ [4, 100]`.
* Names are trimmed/collapsed; empty → `"لوحة بلا عنوان"`.
* Errors are thrown as `ConvexError` with **Arabic** user-facing messages
  (`"يجب تسجيل الدخول أولًا"`, `"المشروع غير موجود"`,
  `"تجاوزت اللوحة الحد الأقصى للعناصر"`) — show `error.data` in a `sonner` toast.
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
