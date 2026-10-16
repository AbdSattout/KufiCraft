# KufiCraft — plan, waves and working agreement

Arabic-first, RTL web app for designing **square kufic** (الكوفي المربع) on a
square or circular grid, with customisable ink ratio, 9 fragment shapes,
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

* C `t3/d25ec469` backend contract tests (42 convex-test cases, split vitest
  projects) + the post-merge backend fixes (`MAX_COLOR_LENGTH`, `duplicate`).
* E `t3/9192986c` editor (`/app/[projectId]`, shared `CanvasPreview`, tools,
  selection, history, export; 44 new tests). 156 tests total on `main`.

**Wave 2.5 — in flight** (worktree agent: editor prefs + `.kuficraft` file)
**Wave 3 — in flight** (review agents: Convex backend, passkey auth security)

| wave | work | who |
| --- | --- | --- |
| 1 | A auth & account UX · B canvas engine + tests · D dashboard · F landing | merged ✅ |
| 2 | E editor (needs B+A merged) · C backend tests (convex-test) | merged ✅ |
| 2.5 | editor settings persistence (localStorage) · `.kuficraft` export/import (`docs/FORMAT.md`) | delegated, in flight |
| 3 | reviews (`convex-reviewer`, `better-auth-security`), browser QA, deploy docs | delegated + orchestrator |

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
   (`bunx convex deploy --yes`, done again after the wave 1 + 2 merges), env vars
   set (`SITE_URL=https://kuficraft.vercel.app`,
   `PASSKEY_RP_ID=kuficraft.vercel.app`), auth routes verified live (`/api/auth/ok`
   → 200, `generate-authenticate-options` → 200 with `rpId: kuficraft.vercel.app`).
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
