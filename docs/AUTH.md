# KufiCraft — authentication (Better Auth + Convex, passkey-only)

## Status: wired and verified ✅

Verified live on `https://adamant-dragon-860.convex.site` (dev deployment):

| check | result |
| --- | --- |
| `GET /api/auth/ok` | `{"ok":true}` |
| `GET /api/auth/get-session` | `null` (200) |
| `POST /api/auth/sign-out` | `{"success":true}` |
| `GET /api/auth/passkey/generate-authenticate-options` | real WebAuthn challenge ✅ → **`@simplewebauthn/server` runs in Convex V8** |
| `GET /api/auth/passkey/list-user-passkeys` | `401 UNAUTHORIZED` (expected without a session) |
| `GET http://localhost:3000/api/auth/ok` | proxied through Next.js ✅ |
| Action `authFlows:createSignUpContext` | takes `{ name }`, normalizes it, and mints the sign-up context token that carries it |
| `GET /api/auth/passkey/generate-register-options?context=…` | 200 challenge/rp/user for a valid minted context; **400** Arabic messages for missing/invalid/expired/tampered tokens |
| `POST /api/auth/passkey/verify-registration` | 200 in a real browser (Chromium virtual authenticator E2E): session cookie set, redirect to `/`, passkey listed, rename/sign-out/sign-in all pass |

Behaviour beyond the endpoints above is covered by `convex/**` unit tests;
everything about the live deployment that a unit test cannot reach is marked
"unverified" below.

## Pinned versions (do not bump without checking `peerDependencies`)

* `better-auth@1.6.33` and `@better-auth/passkey@1.6.33` — the Convex component
  requires `better-auth >=1.6.11 <1.7.0`; the passkey plugin must match the
  `better-auth` minor line.
* `@convex-dev/better-auth@0.12.5`.
* Passkey plugin is **not** in Convex's supported-plugin list → we use the
  **local install** flow (own schema under `convex/betterAuth/`).

## Files

| file | role |
| --- | --- |
| `convex/auth.ts` | `authComponent` (client with local schema), `createAuthOptions` (with the passkey `resolveUser`/`afterVerification` hooks), `createAuth` |
| `convex/authFlows.ts` | sign-up context token (HMAC mint/verify over `{name, expiresAt, nonce}`) + public `createSignUpContext({ name })` action + `DEFAULT_PASSKEY_NAME` re-export (legacy fallback only) |
| `convex/lib/accountName.ts` | the shared name contract: `MAX_ACCOUNT_NAME_LENGTH`, `normalizeAccountName`, `isDefaultAccountName`, `DEFAULT_PASSKEY_NAME` (client alias: `src/lib/account-name.ts`) |
| `convex/auth.config.ts` | Convex auth provider config |
| `convex/convex.config.ts` | registers the **local** `./betterAuth/convex.config` |
| `convex/betterAuth/convex.config.ts` | component definition |
| `convex/betterAuth/schema.ts` | **generated** schema (user, session, account, verification, passkey, jwks) |
| `convex/betterAuth/auth.ts` | static `auth` export **for schema generation only** — never import at runtime |
| `convex/betterAuth/adapter.ts` | adapter functions (`create`/`findOne`/… ) from the local schema |
| `convex/http.ts` | `authComponent.registerRoutes(http, createAuth)` → mounts `/api/auth/*` |
| `src/lib/auth-client.ts` | `createAuthClient({ plugins: [convexClient(), passkeyClient()], fetchOptions: { customFetchImpl } })` — the resilient fetch of § Transient failures |
| `src/lib/{auth-fetch,retry,session-gate,convex-token,save-state}.ts` | the resilience layer: budgeted+retried auth GETs, the session gate decision, the Convex token cache, the save-state mapping (each with a sibling `*.test.ts`) |
| `src/app/(auth)/{layout,account}` | Arabic RTL shell: `/account` is “الحساب والأمان” (there is no sign-in route — the auth panel lives on the landing) |
| `src/app/page.tsx`, `src/app/[projectId]/page.tsx` | the boards (home) and a board — one segment apart, no `/app` prefix |
| `src/components/auth/**` | the one-field auth dialog (empty field = sign in, typed name = create), its host (`SignInDialogProvider`), CTA triggers, account screen + account & security card (account name = passkey name, sign-out), passkey error mapping, `require-auth` guard (`useSession`, so a failed Convex token cannot sign anyone out) |
| `src/proxy.ts` + `src/lib/route-guards.ts` | pre-render routing: `/` is the boards with a session and the landing without one, `/?signin=1` is the landing either way, `/account` and `/<id>` → `/?signin=1` without a session, and `/signin`/`/signup` redirect for the old sign-in addresses |
| `src/lib/auth-server.ts` | `convexBetterAuthNextJs(...)` helpers (`getToken`, `preloadAuthQuery`, …) |
| `src/app/api/auth/[...all]/route.ts` | `export const { GET, POST } = handler` (proxies to Convex) |
| `src/components/convex-client-provider.tsx` | `ConvexProviderWithAuth` on the client, authenticated by `src/lib/convex-auth.ts` (the vendor's hook, made resilient) |
| `src/lib/canvas/model.ts` | unrelated but same pattern: re-export shim |

## Environment

Deployment env vars (set — `bunx convex env list`):

| var | dev value | prod |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | random 32B base64 | new random value |
| `SITE_URL` | `http://localhost:3000` | `https://kuficraft.vercel.app` |
| `PASSKEY_RP_ID` | `localhost` | `kuficraft.vercel.app` |

`SITE_URL` and `PASSKEY_RP_ID` are **required for a live request**: `createAuth`
asserts both (`assertAuthOrigins`) on every real request and fails closed rather
than binding passkeys to `localhost`. The assertion cannot live in
`createAuthOptions`, because the library evaluates that factory **at module
load** — `createApi` derives the auth tables from it and `registerRoutes` builds
a throwaway instance — and module load also happens in Convex's module-analysis
phase, which has **no deployment env**. A throw there fails the entire push
(`InvalidModules`) before anything is deployed, so the factory degrades to a
localhost fallback on that path only; the request path (a real action context)
never gets it. `convex/betterAuth/auth.ts` passes explicit origins for the same
reason: `bunx auth generate` runs without deployment env.

`.env.local` (git-ignored): `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`,
`NEXT_PUBLIC_CONVEX_SITE_URL`, `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.
New worktrees/checkouts must copy it: `cp /home/abd/Coding/kuficraft/.env.local .`

## Rate limiting and abuse controls

**The limiter is off** (`rateLimit: { enabled: false }` in `createAuthOptions`) —
explicitly `false`, not simply omitted, because Better Auth enables its limiter by
itself when `NODE_ENV === "production"`.

It was written, measured, and then removed because it could not do the job:

* **It cannot key on a user.** Better Auth builds every bucket key as
  `createRateLimitKey(ip, path)` → `"<ip>|<path>"`; there is no user dimension,
  so "limit per user" is not expressible.
* **The IP it sees is not the visitor's.** Through the Next proxy Convex
  overwrites the forwarding headers with its own peer, so buckets read
  `35.173.223.1|/passkey/generate-authenticate-options` — a Vercel **egress** IP
  that every visitor shares, and Vercel spreads invocations over a pool of them.
  It therefore throttled innocent visitors who happened to share an egress IP
  while an abuser rotated. (Direct `*.convex.site` calls *are* keyed on the true
  client IP and unspoofable — but that is the same reachable endpoint, so it buys
  nothing on its own.)
* **The path worth protecting is pre-auth.** `passkey/generate-register-options`
  mints a `user` row before the authenticator answers, but it runs before any
  account exists — there is no user id to key on there either.
* **It cost something.** With `storage: "database"` every auth request paid a
  component read + write for that non-protection; with the default in-memory
  store it measured *zero* limiting (a 110-request burst against a 100/60 s rule
  produced no 429s at all, because Convex spreads HTTP across isolates).

Measured on dev, same 15-request burst: with the limiter enabled and
database-backed → 429s; with `enabled: false` → 15 × 400 and no new counter rows.
The `rateLimit` table created while the database store was in use still exists in
the deployment with stale rows; nothing writes to it.

Doing abuse control properly, if it is ever needed, means bot verification on the
sign-up form (Cloudflare Turnstile) or a **global** cap on minting sign-up
contexts — not IP rate limiting; see § Known follow-ups.

One thing the limiter was never responsible for is still enforced:
**the context token is not single-use by design.** Its only job is to prove
  "this client asked for an account a moment ago". `resolveUser` is
  the real gate: a missing/invalid/expired/tampered token is rejected with the
  Arabic "انتهت صلاحية طلب إنشاء الحساب" **400**, and a *repeat* (the derived
  account already exists) is rejected with the Arabic "تم استخدام طلب إنشاء
  الحساب مسبقًا. ابدأ من جديد." **400** — a clean 4xx instead of the adapter's
  opaque unique-email 500.

## Changing auth options

The schema is generated from the options. After editing
`createAuthOptions` in `convex/auth.ts`:

```bash
cd convex/betterAuth && bunx auth generate --output ./schema.ts -y
cd ../../ && bunx convex dev --once      # push component + functions
bunx tsc --noEmit
```

(That is the documented local-install flow; `-y` skips the overwrite prompt.
The shim `convex/betterAuth/auth.ts` exists only so the CLI can load the
options without a request context.)

Editing `rateLimit` in `createAuthOptions` needs this flow only when it changes
the schema — i.e. when `storage: "database"` is switched back on, since that
makes the auth schema own a `rateLimit` table, and a regeneration + push that
omits it breaks every auth request with “table not found”. The current
`rateLimit: { enabled: false }` has no table.

## Accounts

An account **is** its passkey — one account, one passkey, and the passkey's name
is the account's name. There is no profile name, no email login, no password and
no recovery address:

* **The name lives on the passkey.** The name typed at creation is normalized
  once (`normalizeAccountName`, `convex/lib/accountName.ts`, max 60 units) and
  written to three places that must stay identical: `user.name`, the WebAuthn
  user the OS sheet shows, and the passkey row. The passkey row is what the
  header and `/account` read; `/account` renames that same passkey
  (`authClient.passkey.updatePasskey`), the plugin's `$listPasskeys` listener
  refreshes both the account screen and the header, and the rename also
  mirrors `user.name` best-effort via `authClient.updateUser`. `DEFAULT_PASSKEY_NAME`
  (“مفتاح المرور”) survives only as the fallback for accounts created before the
  card asked for a name, and as the `afterVerification` fallback when a
  registration somehow carries none. The OS/browser label of an existing
  credential cannot be changed after creation — a rename only changes what
  KufiCraft displays.
* **No add, no delete.** `account-security.tsx` deliberately offers neither: a
  second passkey would be a second account's key, and deleting the only one would
  leave the account with no way back in (the plugin's `add-passkey` and
  `delete-passkey` endpoints still exist server-side; the app simply never calls
  them). Losing the passkey means losing the account — the boards go with it.
* **The name is signed into the token, and the token is the only carrier.**
  `createSignUpContext` takes `{ name }`, normalizes it server-side (empty,
  over-60 or characters that normalize away are rejected with the Arabic
  `اكتب اسمًا للحساب (1–60 حرفًا).`), and signs a token payload of
  `{name, expiresAt, nonce}`. `resolveUser` verifies the token and passes
  `payload.name` to `createUser` and to the WebAuthn user; the client does not
  send the name a second time to `addPasskey`. Tokens minted before the name
  field existed are still accepted for their 5-minute TTL and fall back to
  `DEFAULT_PASSKEY_NAME`; a token that *does* carry an invalid name is rejected.
* **One field, two intents — and a failure is never an intent.** The auth
  dialog has one `اسم الحساب` field and one button: submitting it *empty* runs
  the sign-in `get()` (the field is also the WebAuthn username field, so
  conditional-UI suggestions can sign in without the button), and submitting a
  *typed name* runs the registration `create()` with that name. Which intent a
  value means is decided by the pure `planAuthSubmit`
  (`src/components/auth/auth-state.ts`) — never by a failed ceremony. A
  cancelled sign-in leaves the field empty with a retry message and never
  creates an account; a cancelled registration leaves the typed name in place.
  There is no auto-attempt effect.

## Passkey-first onboarding (the product requirement)

Sign-in/sign-up must work **without** passwords, email or OAuth:
“touch the button → create a passkey → you are in”. Implemented shape:

1. **Create** (type a name, then “إنشاء حساب”):
   * The client calls the Convex action `authFlows:createSignUpContext({ name })`.
     The action normalizes the name (empty/over-60/characters-that-normalize-away
     → Arabic `ConvexError` `اكتب اسمًا للحساب (1–60 حرفًا).`) and mints a context
     token: base64url JSON `{name, expiresAt, nonce}` signed with HMAC-SHA256
     over `BETTER_AUTH_SECRET` (TTL 5 min; verification requires the expiry and
     nonce and validates the name when present).
   * The client calls `authClient.passkey.addPasskey({ context })`.
     `@better-auth/passkey@1.6.33` has **no** client-side `createSession`
     option — any doc claiming otherwise is wrong.
   * Server-side, `registration.resolveUser` (`convex/auth.ts`) verifies the
     token and creates the user through the component adapter with a synthetic
     unique email (`<nonce>@passkey.local`, method `passkey`), using
     `payload.name` for the row and the WebAuthn user.
   * `registration.afterVerification` creates the session via
     `internalAdapter.createSession(user.id)`, writes the cookie with
     `setSessionCookie` from `better-auth/cookies` (because
     `verify-registration` returns 200 but does **not** create a session by
     itself) and returns the passkey's name (`user.name` or the legacy
     `DEFAULT_PASSKEY_NAME` fallback).
   * The client full-page-navigates to `/` after the ceremony — the passkey
     client never fires `$sessionSignal` on registration. `/` is the boards for
     that fresh cookie, so the visitor lands on “لوحاتي”.
2. **Sign in** (leave the field empty, then “الدخول بمفتاح المرور”):
   `authClient.signIn.passkey()`. The sheet lists every passkey this site has
   on the device and one of them signs in; both paths end with a full-page
   navigation, not client routing (the session atom update can unmount the
   dialog before the promise continuation runs).
   * The dialog is opened by a click — a CTA, or the `?signin=1` flag the
     guards redirect with — and its field is `autoFocus`ed.
   * Where the browser supports conditional mediation, the visible
     `autoComplete="username webauthn"` field arms a conditional `get()` so
     saved passkeys appear in the browser's own autofill; choosing one signs in
     without the button. A manual `get()`/`create()` aborts the pending
     conditional ceremony, so the field re-arms when an attempt settles (and
     when it is focused while empty) — without that, suggestions would stop
     after the first attempt. This is an enhancement only; the
     “الدخول بمفتاح المرور” button is the reliable path everywhere else.
   * There is no *modal* auto-attempt on mount: the only automatic `get()` is
     the conditional-mediation one, which waits for the browser's autofill
     selection and never opens a passkey sheet by itself. A cancellation or
     `NotAllowedError` can therefore never be mistaken for “this visitor has no
     account”.
3. **Management**: `/account` renders the account & security card for a session —
   the account name with a rename dialog, plus sign-out. The dialog never shows
   it (the landing is what a session-less visitor sees, and a live session sees
   the boards at `/`), and `useRequireAuth` covers a session that expires
   mid-visit: it sends the visitor to `/?signin=1`, which the proxy renders as
   the landing whatever the cookie says — the rule that keeps a cookie it still
   believes in from ping-ponging them between the two screens.
4. Behaviour **is verified against the live dev deployment**: HTTP checks for
   every option/verify endpoint plus a real-browser Chromium virtual
   authenticator E2E (sign-up → account → rename → sign-out → sign-in).

## Transient failures on the way to the deployment

**The rule, first: only a resolved, authoritative “no session” may sign anyone
out** — a 200 whose session is null, or a clean 401. Everything else is
*transient*: a timeout, `fetch failed`, an aborted request, a 5xx from the auth
proxy, or a session that is live while Convex has not received a token. A
transient failure keeps the current screen, navigates nowhere, and shows at most
a quiet “جارٍ إعادة الاتصال…”. The decision is the pure function in
`src/lib/session-gate.ts` (tests: `session-gate.test.ts`), and `useRequireAuth`
is its only caller: it navigates on `signedOut` alone. Guessing “signed out”
from a hiccup is what the `/?signin=1` rule then has to undo (§ Gotchas).

Why this exists: every `/api/auth/*` call is proxied by the Next server to the
deployment, and **on this machine that one hop is unreliable.** Measured from
Node 26 against `*.convex.site`:

| probe | result |
| --- | --- |
| IPv6 (`curl -6`) | never connects — `connect` never completes |
| IPv4 (`curl -4`) | connects in 0.28–0.56 s |
| fresh `fetch`, new process | 1.4–2 s when it works; **`UND_ERR_CONNECT_TIMEOUT` at ~10.5 s on a quarter to four fifths of fresh attempts** |
| the same with `--dns-result-order=ipv4first` | IPv4 is first in DNS, and the stalls remain — the loss is on the IPv4 path too |
| second request in a warm process | 0.4–0.8 s (connection reuse) |

undici gives a fresh connection 10 s before it gives up, which is what turned a
click into an error flash instead of a wait.

The same failure seen from the app, while the dev server was running:
`GET /api/auth/get-session` through the proxy answered **500 after 10.5–13.5 s**
— the proxy's own outbound call stalling out. That 500 is the transient case in
the first paragraph, and it is why a 5xx must never be read as “signed out”.

What the client does about it:

* **A budget, for GETs only.** `src/lib/auth-fetch.ts` is the `customFetchImpl`
  the Better Auth client uses (`src/lib/auth-client.ts`): a GET that has not
  produced response headers within 4 s is abandoned and asked again once, after
  a 250 ms backoff. The budget is cleared the moment headers arrive, so a slow
  *body* is never cut in half, and a caller's own abort (Better Auth cancels a
  superseded session fetch) is not a failure to retry. POSTs pass through
  untouched: `passkey/verify-registration` and `sign-out` are writes, and a
  replayed one is a second account, not a second read. The one GET that is
  explicitly **not** retried is `generate-register-options`: it mints a `user`
  row before the authenticator answers, and a replay with the same context token
  would be rejected as “تم استخدام…” even when the first attempt is the one that
  created the row. It still gets the budget, as a single bounded attempt.
* **A token that is kept.** `src/lib/convex-token.ts` reuses the Convex token
  until shortly before its JWT `exp`, gives concurrent callers one request
  (single flight) and never caches a failure. It is wired in
  `src/lib/convex-auth.ts` — our replacement for the vendor's
  `ConvexBetterAuthProvider` hook, with the same `isLoading`/`isAuthenticated`
  semantics plus `refetchConvexToken()`, the only public way to make Convex run
  `setAuth()` again (a real retry instead of a page reload).
* **A gate that waits.** `useRequireAuth` refetches the session and re-arms the
  token twice (400 ms, then 800 ms) before it shows anything; after that the
  screens keep what they had and show the quiet Arabic “جارٍ إعادة الاتصال…”
  with a manual retry — and the gate keeps asking, one slow ping every 10 s, so
  a link that heals on its own heals the app too.
* **A save indicator that does not lie.** The editor's top bar is the single
  place the app reports writes: `محفوظ تلقائيًا` / `جارٍ الحفظ…` /
  `تعذّر الاتصال — جارٍ إعادة المحاولة…` / `غير محفوظ — ستتم إعادة المحاولة`
  (`src/lib/save-state.ts`, mapped in `src/components/editor/editor-top-bar.tsx`).
  A transient rejection is never a toast: the change stays in the overlay **and**
  in the queue, so the indicator cannot report `saved` for a change that has not
  landed. Convex's client already replays mutations it never got an answer for;
  a mutation the server *rejected* while the client was between tokens is not
  replayed by it, so the held document is offered again as one `replace` —
  order-safe and idempotent (`applyOps` dedupes by key) — where a replayed
  *diff* would be stale. `convex/projects.ts` is unchanged.
* **The `dev`/`start` hint.** Both scripts run Node with
  `--dns-result-order=ipv4first` because this machine's IPv6 route to
  `*.convex.site` never connects. It is a workaround for this machine, not a
  product decision, and it does **not** make the stalls go away on its own
  (measured above) — the budget and the retry are what do.

Deliberately not done: reimplementing the Next auth proxy
(`src/app/api/auth/[...all]/route.ts`) to retry the outbound call. That proxy is
the library's `handler`, which accepts no `fetch`/`signal` knob, and a
client-side retry is the better shape anyway: it can start while the dead
attempt is still stuck where a server-side sequential retry would have to wait
out the 10 s first. The knob is documented as out of reach rather than patched
around.

## Gotchas (learned the hard way)

* Passkey `generate-*` endpoints are **GET**, `verify-*`/`delete`/`update` are
  **POST**. A wrong method returns **404**, not 405 — do not chase it as a
  routing bug.
* `better-auth/minimal` is the runtime import in Convex functions (no Node deps).
* The generated schema must include the `passkey` table (it does) — otherwise the
  plugin will fail at runtime with “table not found”.
* `ConvexError` messages are user-facing Arabic strings; toasts display them raw.
* `verify-registration` does **not** create a session (only `afterVerification`
  does here); `$sessionSignal` fires on `verify-authentication` only, so
  post-registration navigation must be a full page load.
* rpID is port-agnostic, but the plugin's origin check requires the browser
  origin to equal `SITE_URL` — browser tests from a second dev port need a
  temporary `SITE_URL` flip (restore it afterwards).
* Never run two `bunx convex dev` pushes against the same deployment
  simultaneously — coordinate with the orchestrator.
* The account's name is the passkey's name, so renaming a passkey renames the
  account: `updatePasskey` triggers the plugin's `$listPasskeys` listener, which
  is what makes the header (and `/account`) show the new name without a reload.
  Keep both reading the same source — nothing else stores a name.
* `generate-register-options` is a GET that must **not** be retried
  (`src/lib/auth-fetch.ts` special-cases it): it mints a `user` row, so a replay
  with the same context token is a rejected duplicate, not a harmless read.
* Conditional UI is armed by the dialog's one field
  (`autoComplete="username webauthn"`) and must be re-armed whenever it is
  superseded: a manual `get()`/`create()` aborts the pending conditional
  ceremony, so `AuthPanel` keys its effect by a `conditionalArm` counter that
  bumps when the field is focused while empty or a sign-in attempt settles.
  Without the re-arm, browser suggestions stop after the first attempt. Only
  one conditional `get()` is pending at a time — each arming aborts the
  previous one, and they share the challenge cookie.
* Every `id`/`htmlFor` pair in `AuthPanel` is prefixed with `useId()`, so a
  second mount can never make a label point at another instance's field.

## Migrations

* **Old typed names → passkey rows.** Accounts created before the sign-up card
  asked for a name stored the typed name on `user.name` but left the passkey row
  at `DEFAULT_PASSKEY_NAME`; the header and `/account` read the passkey row, so
  those accounts still show «مفتاح المرور». `convex/migrations/backfillPasskeyNames.ts`
  contains the pure planner (`planPasskeyNameBackfill`, unit-tested) and an
  internal action (`backfillPasskeyNames`) that wraps it over the auth
  component with `dryRun` defaulting to `true`. It has **not** been executed
  against any deployment. To run it after this change is deployed:

  ```bash
  bunx convex run migrations/backfillPasskeyNames:backfillPasskeyNames '{"dryRun": true}'
  # review `updates`, then:
  bunx convex run migrations/backfillPasskeyNames:backfillPasskeyNames '{"dryRun": false}'
  ```

  Only passkeys whose own name is missing/default *and* whose owner has a real
  name are touched; the plan is idempotent, and an owner that never got a name
  is left alone. The OS/browser label of existing credentials cannot be
  backfilled — only what KufiCraft displays.

## Known follow-ups (deliberately not done here)

Each item below was in scope but needed the live stack, a migration, or a
redesign, so it is left open rather than half-done:

1. **Orphaned `user` rows.** A successful `generate-register-options` call mints
   a `user` row before the authenticator answers; if the ceremony is never
   completed, that row — plus its synthetic `<nonce>@passkey.local` email — stays
   behind. `resolveUser` only reaps the row if the *same* token is replayed. A
   real fix needs a component-side sweep (a cron deleting accounts with no
   `passkey` and no `session`), which cannot be exercised against the current
   adapter surface from a unit test.
2. **The passkey endpoints still allow add and delete; the app does not.** An
   account is one passkey (docs/AUTH.md § Accounts), so `/account` exposes
   neither `addPasskey` nor `deletePasskey`, and no server-side rule enforces
   either — `@better-auth/passkey`'s `delete-passkey` calls
   `ctx.context.adapter.delete` directly, bypassing `deleteWithHooks`, so a
   `hooks.before` guard would never run anyway. If the UI ever grows an “add a
   passkey on this device” action (the one real use for it), it has to come with
   that guard; today nothing can even reach the endpoints.
3. **The sign-up context token travels in a query string.** The plugin's
   `generate-register-options` is a `GET`, so the token rides in
   `?context=…` and therefore appears in access logs and in any `Referer` the
   page would send (the landing links nowhere cross-origin). Accepted as-is: the
   token is 5-minute, single-purpose, and not a session credential. Moving it to
   a header would need a custom endpoint or a plugin patch.
4. **No abuse control on the public sign-up path.** With the limiter off (see
   § Rate limiting) nothing meters `passkey/generate-register-options`, so an
   unauthenticated caller can mint `user` rows bounded only by their own effort.
   The two honest fixes, in order of preference:
   * **Bot verification in the sign-in dialog** — Cloudflare Turnstile in front
     of the button, verified server-side before the context token is minted.
     Stops scripted abuse without penalising real visitors (and Convex cannot
     see the client IP, so a challenge is the only reliable signal).
   * **A global mint cap** — count `createSignUpContext` mints in a window in a
     normal app table and refuse past a limit. It is IP-agnostic, so it cannot be
     dodged by rotating, at the cost of a sign-up-wide ceiling an attacker could
     exhaust on purpose.

