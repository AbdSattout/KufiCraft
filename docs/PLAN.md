# KufiCraft — plan, waves and working agreement

Arabic-first, RTL web app for designing **square kufic** (الكوفي المربع) on a
square or circular grid, with customisable ink ratio, 10 fragment shapes,
auto-merge to lines, per-item colour/shape/rotation, live sync and export.
Replaces the old localStorage-only KufiCraft. Stack: Next.js 16 (App Router,
Turbopack) · React 19 · Tailwind v4 + shadcn (RTL) · Convex (realtime DB +
backend) · Better Auth (passkeys, local-install component) · Bun · vitest.

## Status

**Wave 0 — done (orchestrator)**

* Project scaffolded on Next.js 16.4.2, shadcn initialized with RTL, 35 UI
  components vendored, theme (paper/ink/saffron oklch) + Arabic fonts wired.
* `convex/lib/model.ts` — the shared canvas model/validators (**the contract**),
  client alias at `src/lib/canvas/model.ts`.
* Backend live: `projects` table + 9 functions (`convex/projects.ts`), pushed to
  dev deployment `adamant-dragon-860` (team `abdsat`, project `kuficraft`).
* Better Auth (passkey-only, local install) live: schema generated, env vars set,
  `@simplewebauthn/server` verified running in Convex's V8 runtime,
  `/api/auth/*` proxied by Next and answering.
* Docs: `PLAN.md`, `CANVAS.md`, `BACKEND.md`, `AUTH.md`, `UI.md`,
  `reference/` (old implementations for porting).

**Wave 1 — done and merged into `main`**

* A `t3/4ac0bfd3` passkey auth + account UX (sign-up without a session via an
  HMAC context token, sign-in conditional UI, `/signin` account & security).
  Full browser E2E passed with a Chromium virtual authenticator.
* B `t3/50cac3fd` canvas engine (geometry, grid, ops, render + 68 tests).
* D `t3/7f2b8438` dashboard (`/app`: cards, create dialog, empty/loading).
* F `t3/a73d8263` landing page (`(marketing)` route group) — design-taste skill,
  own kufi geometry, live ink-ratio instrument, 5 commits.

**Wave 2 — done and merged into `main`**

* C `t3/d25ec469` backend contract tests (convex-test) + the post-merge backend
  fixes (`MAX_COLOR_LENGTH`, `duplicate`).
* E `t3/9192986c` editor (`/app/[projectId]`, shared `CanvasPreview`, tools,
  selection, history, export; 44 new tests).

**Wave 2.5 — done and merged into `main`** (`t3/a2267529`)

* Editor preferences + `last-config` in browser storage
  (`src/lib/editor-prefs.ts`); document settings (grid, line shape, ratio) stay in
  the document and `last-config`, never in the prefs.
* `.kuficraft` v1 export/import (`src/lib/kuficraft-file.ts`, `docs/FORMAT.md`)
  with a dashboard button and drag-and-drop import.
* Ratio presets 1:1 … 1:5 in the editor settings panel and the new-project
  dialog; `RATIO_PRESETS`/`snapRatio`/`ratioLabel` in `convex/lib/model.ts` are
  the single source of truth (ink is always the larger part, so the range is
  clamped at 1:1).
* Client-side `MAX_ITEMS` guard in `applyCommit`.

**Wave 3 — done: reviews applied and deployed**

* The Convex backend review and the passkey/auth security review both returned
  “ship with fixes”; they landed as `t3/c5319af2` (`1d68328`…`b4a27f2`) plus the
  orchestrator follow-up `e2d29e0` (analysis-safe origin guard; rate limiting on
  the auth component's shared `rateLimit` table — the default in-memory store
  measured no effect across Convex isolates).
* `main` (`e2d29e0`) is deployed: prod Convex `acrobatic-pika-276` pushed,
  Vercel production green, `/`, `/signin`, `/signup`, `/app`, `/api/auth/ok` all
  200; write path exercised end-to-end against dev (ratio snapping 0.3 → 0.5 and
  0.9 → 5/6, index clamping, oversized-key rejection, cross-user ownership).
* **226 tests** — 71 convex-test (`convex/**`), 155 client (`src/**`).

**Wave 4 — model v2 rewrite (this branch)**

* The item model was rewritten to match the reference app one-to-one: items are
  **classes** (`KufiItem` → `Tile` / `Line` / `Stroke` / `Arc`), field names are
  full words (`column`, `zone`, `from`, `points`, …), and the old one-letter
  names and redundant `arch` type are gone (`docs/CANVAS.md` §3).
* Tools are **one class each in a registry** (`REGISTRY` in
  `src/components/editor/tools.ts`): `select | pen | line | eraser | arc | hand`,
  with the rail icons, labels and shortcuts read from the classes — no
  `switch (tool)`.
  Shape ids were renamed (`semi-hexagone` → `pentagon`, `arc` → `curve`, the
  untitled tenth → `comb`).
* Pen colours **exactly the cells the pointer is moved over** — one fragment per
  pointer position, nothing interpolated between positions and nothing merged;
  identity dedup and no hover preview (see the follow-up below). Line and arc
  take **click-click as well as drag**; both show the armed start cell as a
  filled highlight. Arc geometry was ported from `kufi.js` and now exposes
  direction + size controls and configurable cap/join ends.
* Colour is **per fragment** (`resolvedColor`), so changing the document ink
  never repaints what is already drawn; the toolbar shape icons respect rotation.
* The sidebar was reorganised: **one** colour control (`لون الحبر` is the pen's
  colour *and* the project ink; the separate “لون الرسم” picker and its inline
  “لون الحبر” reset button are gone), the shapes section title no longer collides
  with the grid-type word (the always-on “مربعة” reset became a contextual
  “إعادة الشكل”), the selection actions appear only with a selection instead of
  a disabled block, and the panels read top-to-bottom as drawing → colours →
  board → wipe (`docs/UI.md`).
* The ink ratio now reads `1:1 … 1:5`; `MIN_RATIO`/`MAX_RATIO` are the numeric
  extremes. The construction grid is two families: whole-cell borders (0.28)
  plus the stronger inner ink edges (0.55).
* **Follow-up (live testing): the ratio axis has no space-less preset.** `1:1`
  used to be the old «mono» grid ported as `ratio = 1`: the ink fragment was the
  whole cell and the space fragments were zero-width, so a tile's zone was
  invisible until the ratio moved and then reappeared as a different shape, and
  two same-zone neighbours touched at `1:1` and nowhere else — switching the
  ratio broke the pattern's connectivity. `1:1` is the honest equal cell now
  (half ink, half space, the lightest of the five) and the invariant in
  `docs/CANVAS.md` §2 holds at every preset: the four fragments of a cell tile
  it with positive area, and what touches depends only on cells and zones. A
  stored `ratio: 1` snaps to `5/6` on read; the inner grid family is now drawn at
  every preset.
* `.kuficraft` is **format v2** (still reads v1; `docs/FORMAT.md`), the backend
  validators/sanitisers follow (`docs/BACKEND.md`), and the docs were rewritten
  in the same branch.
* **Follow-up (live testing):** the pen lost its gap fill and the merge feature
  went with it. `config.mergeLines` is **gone**, replaced by
  `config.straightLinesAsSquares` (sidebar toggle under خيارات اللوحة, default
  **on**): the line tool draws a run with no diagonal segment as one square per
  cell — the reference app's straight line — or as a single solid bar when it is
  off. The pen never merges: what the overlay previews is what the pointer
  touched, cell by cell. `anchorsBetween` and `MAX_PEN_GAP` were deleted. The
  backend tolerates documents that still carry `mergeLines`: the validator keeps
  the field `v.optional()` and `sanitizeConfig` repairs the document on read
  (`get`) and on its next write.
* **Follow-up (live testing):** the canvas scroller and the missing hand tool.
  The stage used to centre the surface with `justify-center`, so an overflowing
  board also spilled off the inline-**start** edge — the one direction a scroll
  container cannot reach, which is why the board could not be scrolled
  sideways; it now centres with `margin: auto` (auto margins collapse to zero
  once the surface overflows). The old app's **hand tool** is back:
  `KufiTool.pans` marks it as a view tool, the controller drags the viewport
  (`panScrollOffset`, with `horizontalScrollSign` handling the RTL `scrollLeft`
  conventions), and a double click on the canvas or on its rail button recentres
  the board (`centreScroll`). Every tool now also carries its own status-bar
  `hint`, replacing the `tool === "line"` special case. Open: zoom keeps the
  inline-start edge anchored, so zooming in from a centred board jumps to a
  corner — anchoring at the view centre instead is a possible follow-up.
* **Follow-up (live testing):** dragging a selection **wiped the board**. The
  select tool's move handed the document only the moved fragments
  (`shiftSelection`, the helper the live preview needs) where a commit must be
  the whole board — `toOps` diffs it against the document, so every other item
  read as “deleted”. It now commits `moveItems` (clamped to the grid, moved
  items on top), and `shiftSelection` says out loud that it is preview-only.
* **Follow-up (live testing):** the account screens and the home route. Sign-in
  and sign-up were two routes behind two header buttons, and `/signin` doubled
  as the passkey/sessions screen — so the page you land on while signed *out*
  talked about a session you did not have. `/signin` is now **one card** with
  both ways in (an existing passkey, or a name plus a new passkey); passkey
  management moved to `/account` (“الحساب والأمان”) and `/signup` is a redirect
  for old links. The boards became the **home route**: `src/proxy.ts` (the
  renamed middleware, Node runtime) rewrites `/` to `/app` when a session cookie
  is present — `src/lib/route-guards.ts` holds the rules and their tests — so the
  landing stays statically prerendered for everyone else and a signed-in visitor
  never sees it flash by. Anonymous `/app`, `/app/…` and `/account` are
  redirected to `/signin` there too; `/signin` is deliberately never bounced on
  the cookie (a stale one would loop) — the screen itself sends a live session
  home. The header lost its «لوحاتي» button (the boards *are* the home route) and
  its two anonymous buttons, and its account menu now sits inside a
  `DropdownMenuGroup`: Base UI's `Menu.GroupLabel` needs the group context, and
  the old markup threw `MenuGroupContext is missing`.
* **Follow-up (live testing):** the account *model*. An account is not a profile
  with keys attached — it **is** its passkey: exactly one, never added to or
  deleted, and its name is the account's name. Everything that assumed otherwise
  went: the display-name field and the whole `normalizeDisplayName` sanitiser
  (with its bidi/zero-width hardening) on both sides of the sign-up token, the
  name in the token payload (`{expiresAt, nonce}` now), the `name` in
  `resolveUser`'s WebAuthn user, `api.auth.getCurrentUser`, the add/rename/delete
  passkey list on `/account` (it is one name row with a pencil now, editing the
  passkey itself) and the last-passkey guard that only existed because delete
  did. `/signin` followed: no field, no “حساب جديد” section, **one button**. It
  signs in; only when an attempt comes back without a session — the one symptom
  of “no passkey on this device” a WebAuthn call can show, since `get()` rejects
  identically for a cancel — does the same button switch to creating the
  account's passkey. The ceremony is also attempted once on arrival, silently,
  but **only** while `navigator.userActivation.isActive`, i.e. when the visitor
  got here by clicking (that is what lets a browser open a prompt without a
  fresh gesture); on a refresh nothing opens and the button is the way in. The
  header reads the passkey's name for the account name, so a rename on
  `/account` updates it through the plugin's `$listPasskeys` listener.
* **Follow-up:** the sign-in *screen* became a **dialog on the landing**. `/signin`
  was a page a signed-in visitor could not reach and that the landing linked to
  for no reason; the ceremony is now `SignInDialogProvider` (the root layout)
  opened by every CTA — the hero, the closing section, the footer and the
  header's «تسجيل الدخول» — while `/signin` and `/signup` survive only as
  redirects to `/?signin=1`. The guards send an anonymous visitor who wanted
  `/app` or `/account` to that same flag, which the dialog reads with
  `useSyncExternalStore` (server snapshot: closed) — so `/` stays statically
  prerendered, hydration stays clean, and dismissing the dialog strips the flag.
  Making the landing the anonymous fallback added one real hazard: `/` is
  rewritten on the cookie while the client guard's own fallback is a plain `/`
  URL, so the two can disagree about who is signed in — see the next bullet.
* **Follow-up (live testing): the infinite redirect, and the routes.** Two
  screens claimed `/`, and the guards decided between them from the session
  cookie alone. The loop: the boards' guard read *Convex*'s auth state, which
  reports an anonymous client whenever `/api/auth/convex/token` fails, while the
  sign-in screen read the *session* — valid — and sent the visitor back. With a
  flaky network to the deployment that ping-ponged `/` ↔ `/signin` for as long
  as the tab stayed open, hammering the auth endpoints. The guard now reads the
  session too (`authClient.useSession`), and when the session request itself
  fails it does not guess: the screens show a retry. The other half was the
  routing: `/` is the boards (the landing moved to `/welcome`, still served at
  `/` by a rewrite), a board is `/<id>` — no more `/app` prefix — and
  `/?signin=1`, the fallback the guard navigates to, is the landing **whatever
  the cookie says**, because a stale cookie is exactly when the proxy and the
  client disagree.
* **Follow-up (user review): no half-routes, and no screen that crashes on a
  hiccup.** `/welcome` was still an address anyone could visit and keep, and
  `/app` was still a redirect: both are gone as *addresses* — `/welcome`
  redirects to `/` (it is only where the landing's markup lives, which is the
  price of `/` being a single URL with the boards on it), `/app` has no rule at
  all, and `/app/<id>` is a plain 404. The crash the user hit next was the same
  flaky token endpoint from the other side: with the session valid but
  `/api/auth/convex/token` failing, the boards rendered `ProjectsView` with no
  token, and Convex answers that with `يجب تسجيل الدخول أولًا` — thrown, so
  `useQuery` took the whole screen down. `useRequireAuth` now exposes `ready`
  (a session **and** a Convex token), the Convex-reading screens wait for it
  behind their skeletons, and when the token never arrives they show the retry —
  a reload, because nothing in the app can make Convex ask for the token again.
  `/account` needs only the session, so it gates on `sessionFailed` and keeps
  working while Convex is unreachable.

* **Follow-up (live testing): the pen's gap fill came back, then became
  zone-aware.** A fast drag reported one position per `pointermove` and the pen
  painted exactly those cells, so a quick stroke came out as scattered points.
  `move` first walked the cells between its last anchor and the new one with
  `anchorsAlongLine` — a *supercover* rasterisation of the segment between the
  two cell centres (one cell per gridline crossed, **both** cells at an exact
  corner crossing, so a diagonal stroke stays edge-connected and is never
  dotted at any preset — every one of them has real space). A second pass added
  `anchorsAlongStroke`: it keeps the pointer's real segment and every fragment
  it crossed, so a fast drag now paints exactly what a slow drag over the same
  path paints, rather than one endpoint zone per cell. There is no
  `MAX_PEN_GAP` teleport rule and no maximum gap this time, the fill is bounded
  by the grid's own cell count, and the pen still never merges a run. The
  eraser sweeps the old cell walk (each cell the drag flew over is hit-tested
  at its centre), so a quick erase no longer skips what it passed.

| wave | work | who |
| --- | --- | --- |
| 1 | A auth & account UX · B canvas engine + tests · D dashboard · F landing | merged ✅ |
| 2 | E editor (needs B+A merged) · C backend tests (convex-test) | merged ✅ |
| 2.5 | editor prefs (browser storage) · `.kuficraft` export/import (`docs/FORMAT.md`) · ratio presets | merged ✅ |
| 3 | backend + auth reviews and their fixes · write-path QA · prod deploy | done ✅ |
| 4 | model v2 (item classes · tool registry · pen/line/arc gestures · per-item colour · equal 1:1 cell · grid families · file format v2 · docs) | this branch |

## File ownership (avoid collisions)

| owner | files |
| --- | --- |
| orchestrator | `src/app/layout.tsx`, `src/app/globals.css`, `package.json`, `convex/lib/model.ts`, `convex/schema.ts`, `convex/projects.ts`, `docs/**` |
| A (auth) | `convex/auth.ts`, `convex/betterAuth/**`, `src/lib/auth-*.ts`, `src/components/convex-client-provider.tsx`, `src/app/(auth)/**`, `src/components/auth/**`, `src/app/api/auth/**` |
| B (engine) | `src/lib/canvas/**` (except `model.ts`) |
| D (dashboard) | `src/app/app/**` (dashboard only), `src/components/dashboard/**` |
| E (editor) | `src/app/app/[projectId]/**`, `src/components/editor/**`, `src/components/canvas/**` |
| F (landing) | `src/app/(marketing)/**`, `src/components/marketing/**` |

Shared files (`layout.tsx`, `site-header.tsx`) are edited by the orchestrator or
by exactly one wave member; if you need a change there, ask instead of editing.

## Rules for agents

1. Work in the assigned worktree/branch. `cp /home/abd/Coding/kuficraft/.env.local .`
   immediately (it is git-ignored, but every checkout needs it).
2. **Do not** run `bunx convex dev`, `convex deploy` or `bunx auth generate`
   unless your brief explicitly grants it — the dev deployment is shared.
3. `bunx tsc --noEmit` must pass before you report back. **Run `bunx next typegen`
   first in a fresh checkout** — `LayoutProps<"/">` and route types live in
   `.next/types`, which a new worktree does not have yet. Then
   `bun run lint`, `bun run test`, and `bun run build` for UI work.
4. The docs are the contract: `docs/CANVAS.md`, `docs/BACKEND.md`, `docs/AUTH.md`,
   `docs/UI.md`. Deviating is fine **only** if you update the doc in the same
   branch and call it out in your report.
5. No `any`, no `@ts-ignore`, no unused code, no TODOs left behind.
   Arabic copy for every user-visible string; numbers/Latin inline where natural.
6. Commit in small logical commits with the prefix `feat(<area>):` / `fix(…)` /
   `test(…)`; end your report with: branch, files touched, commands run,
   what you verified, what you could not verify, and any contract change.

## Definition of done (per wave item)

* Typecheck + lint + its own tests green; feature verified against the dev
  deployment by the owner where possible (curl/HTTP or Playwright-less manual
  script), otherwise explicitly reported as unverified.
* No new dependencies without orchestrator approval.
* Doc updated when a contract changed.

## Deploy plan (after wave 3)

1. Convex **prod** deployment `acrobatic-pika-276` — functions pushed
   (`bunx convex deploy --yes`; last run after wave 2.5 + 3, including the auth
   component's `rateLimit` table), env vars
   set (`SITE_URL=https://kuficraft.vercel.app`,
   `PASSKEY_RP_ID=kuficraft.vercel.app`), auth routes verified live (`/api/auth/ok`
   → 200, `generate-authenticate-options` → 200 with `rpId: kuficraft.vercel.app`,
   `rateLimit` rows being written with the prod deployment).
2. Vercel project `kuficraft` (git-connected to `AbdSattout/KufiCraft@main`):
   production env vars point at the prod Convex deployment
   (`NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`) plus
   `NEXT_PUBLIC_SITE_URL=https://kuficraft.vercel.app`; see `docs/DEPLOY.md`.
   Every push to `main` redeploys; run `bunx convex deploy` after convex changes.
3. Repo visibility (user): currently **private**, `AbdSattout/KufiCraft`.
4. Custom domain (user): passkeys bind to the origin — decide before inviting
   users; `PASSKEY_RP_ID` + `SITE_URL` must move together.

## Open questions for the user

* Custom domain (and whether `www` is used) — passkey re-registration is needed
  if it changes later.
* Repo visibility (private → public).
* Whether to build an SVG-markup importer to rescue old KufiCraft localStorage
  artworks (the old apps never stored JSON — see `docs/FORMAT.md` § Legacy).
