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
  (`src/lib/editor-prefs.ts`); document settings (grid, merge, ratio) stay in the
  document and `last-config`, never in the prefs.
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
  `src/components/editor/tools.ts`): `select | pen | line | eraser | arc`, with
  the rail icons, labels and shortcuts read from the classes — no `switch (tool)`.
  Shape ids were renamed (`semi-hexagone` → `pentagon`, `arc` → `curve`, the
  untitled tenth → `comb`).
* Pen paints **only the anchors the pointer crossed** (gap fill between the last
  anchor and the new one, `MAX_PEN_GAP = 8` for a teleport, identity dedup, no
  hover preview). Line and arc take **click-click as well as drag**; both show
  the armed start cell as a filled highlight. Arc geometry was ported from
  `kufi.js` and now exposes direction + size controls with butt/mitre heads.
* Colour is **per fragment** (`resolvedColor`), so changing the document ink
  never repaints what is already drawn; the toolbar shape icons respect rotation.
* The sidebar was reorganised: **one** colour control (`لون الحبر` is the pen's
  colour *and* the project ink; the separate “لون الرسم” picker and its inline
  “لون الحبر” reset button are gone), the shapes section title no longer collides
  with the grid-type word (the always-on “مربعة” reset became a contextual
  “إعادة الشكل”), the selection actions appear only with a selection instead of
  a disabled block, and the panels read top-to-bottom as drawing → colours →
  board → wipe (`docs/UI.md`).
* The ink ratio now reads `1:1 … 1:5` where **`1:1` is the space-less mono cell**
  (ink fills the whole cell); `MIN_RATIO`/`MAX_RATIO` are the numeric extremes.
  The construction grid is two families: whole-cell borders (0.28) plus the
  stronger inner ink edges (0.55), the latter empty at `1:1`.
* `.kuficraft` is **format v2** (still reads v1; `docs/FORMAT.md`), the backend
  validators/sanitisers follow (`docs/BACKEND.md`), and the docs were rewritten
  in the same branch.

| wave | work | who |
| --- | --- | --- |
| 1 | A auth & account UX · B canvas engine + tests · D dashboard · F landing | merged ✅ |
| 2 | E editor (needs B+A merged) · C backend tests (convex-test) | merged ✅ |
| 2.5 | editor prefs (browser storage) · `.kuficraft` export/import (`docs/FORMAT.md`) · ratio presets | merged ✅ |
| 3 | backend + auth reviews and their fixes · write-path QA · prod deploy | done ✅ |
| 4 | model v2 (item classes · tool registry · pen/line/arc gestures · per-item colour · space-less 1:1 · grid families · file format v2 · docs) | this branch |

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
