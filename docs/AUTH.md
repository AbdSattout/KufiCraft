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
| Action `authFlows:createSignUpContext` | mints the sign-up context token (no arguments, no display name — an account is its passkey) |
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
| `convex/authFlows.ts` | sign-up context token (HMAC mint/verify) + public `createSignUpContext` action + `DEFAULT_PASSKEY_NAME` (the account's first name) |
| `convex/auth.config.ts` | Convex auth provider config |
| `convex/convex.config.ts` | registers the **local** `./betterAuth/convex.config` |
| `convex/betterAuth/convex.config.ts` | component definition |
| `convex/betterAuth/schema.ts` | **generated** schema (user, session, account, verification, passkey, jwks) |
| `convex/betterAuth/auth.ts` | static `auth` export **for schema generation only** — never import at runtime |
| `convex/betterAuth/adapter.ts` | adapter functions (`create`/`findOne`/… ) from the local schema |
| `convex/http.ts` | `authComponent.registerRoutes(http, createAuth)` → mounts `/api/auth/*` |
| `src/lib/auth-client.ts` | `createAuthClient({ plugins: [convexClient(), passkeyClient()] })` |
| `src/app/(auth)/{layout,account}` | Arabic RTL shell: `/account` is “الحساب والأمان” (there is no sign-in route — the dialog lives on the landing) |
| `src/app/page.tsx`, `src/app/[projectId]/page.tsx` | the boards (home) and a board — one segment apart, no `/app` prefix |
| `src/components/auth/**` | the sign-in dialog (one button, silent auto-attempt) and its CTA triggers, account screen + account & security card (account name = passkey name, sign-out), passkey error mapping, `require-auth` guard (`useSession`, so a failed Convex token cannot sign anyone out) |
| `src/proxy.ts` + `src/lib/route-guards.ts` | pre-render routing: `/` is the boards with a session and the landing without one, `/?signin=1` is the landing either way, `/account` and `/<id>` → `/?signin=1` without a session, and `/app`, `/app/<id>`, `/signin`, `/signup` redirect for old links |
| `src/lib/auth-server.ts` | `convexBetterAuthNextJs(...)` helpers (`getToken`, `preloadAuthQuery`, …) |
| `src/app/api/auth/[...all]/route.ts` | `export const { GET, POST } = handler` (proxies to Convex) |
| `src/components/convex-client-provider.tsx` | `ConvexBetterAuthProvider` (client) |
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

* **The name lives on the passkey.** `DEFAULT_PASSKEY_NAME` (`convex/authFlows.ts`)
  names the passkey a new account is created with, so it starts as “مفتاح المرور”
  and shows in the header. `/account` renames that same passkey
  (`authClient.passkey.updatePasskey`), and the plugin's `$listPasskeys` listener
  refreshes both the account screen and the header, so the new name *is* the new
  account name. The browser never tells us what the OS called the credential, so
  the first name is ours, not the platform's.
* **No add, no delete.** `account-security.tsx` deliberately offers neither: a
  second passkey would be a second account's key, and deleting the only one would
  leave the account with no way back in (the plugin's `add-passkey` and
  `delete-passkey` endpoints still exist server-side; the app simply never calls
  them). Losing the passkey means losing the account — the boards go with it.
* **No display name in the token or the user row.** `createSignUpContext` takes
  no arguments, and the token payload is only `{expiresAt, nonce}`. The created
  `user` row still carries a `name` because Better Auth's schema requires one —
  it is the same `DEFAULT_PASSKEY_NAME` label and nothing reads it.
* **Signing in and signing up are the same ceremony.** Someone with a passkey for
  this site signs in; someone without one needs a *different* WebAuthn call
  (`create()` rather than `get()`), and the browser gives no signal that
  distinguishes “no credentials here” from “the user cancelled”. So the dialog
  has **one button**: it runs the sign-in ceremony, and only after an attempt
  comes back without a session does that same button switch to creating the
  account's passkey. Nothing is a form — there is nothing to type.

## Passkey-first onboarding (the product requirement)

Sign-in/sign-up must work **without** passwords, email or OAuth:
“touch the button → create a passkey → you are in”. Implemented shape:

1. **Create** (the dialog's button once a sign-in attempt came back without a
   session, or immediately for a device with no passkey):
   * The client calls the Convex action `authFlows:createSignUpContext({})`.
     The action mints a context token: base64url JSON `{expiresAt, nonce}`
     signed with HMAC-SHA256 over `BETTER_AUTH_SECRET` (TTL 5 min; verification
     requires both fields).
   * The client calls `authClient.passkey.addPasskey({ context })`.
     `@better-auth/passkey@1.6.33` has **no** client-side `createSession`
     option — any doc claiming otherwise is wrong.
   * Server-side, `registration.resolveUser` (`convex/auth.ts`) verifies the
     token and creates the user through the component adapter with a synthetic
     unique email (`<nonce>@passkey.local`, method `passkey`).
   * `registration.afterVerification` creates the session via
     `internalAdapter.createSession(user.id)`, writes the cookie with
     `setSessionCookie` from `better-auth/cookies` (because
     `verify-registration` returns 200 but does **not** create a session by
     itself) and returns the passkey's name — `DEFAULT_PASSKEY_NAME`.
   * The client full-page-navigates to `/` after the ceremony — the passkey
     client never fires `$sessionSignal` on registration. `/` is the boards for
     that fresh cookie, so the visitor lands on “لوحاتي”.
2. **Sign in** (the dialog's first button): `authClient.signIn.passkey()`. The
   sheet lists every passkey this site has on the device and one of them signs in;
   both paths end with a full-page navigation, not client routing (the session
   atom update can unmount the dialog before the promise continuation runs).
   * The dialog lives on the landing and is opened by a click — a CTA, or the
     `?signin=1` flag the guards redirect with — so on mount the same call is
     attempted once, silently, **only** while `navigator.userActivation.isActive`.
     That activation is what lets a browser open a WebAuthn prompt without a
     fresh gesture; on a direct load or refresh there is none, `get()` would
     reject with `NotAllowedError`, and the button is the way in.
   * There is **no conditional-UI input**: it would need a visible
     `autocomplete="username webauthn"` field, and the dialog has no fields.
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

