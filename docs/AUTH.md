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
| Action `authFlows:createSignUpContext` | mints the sign-up context token; `ConvexError` Arabic for names outside 1–60 chars |
| `GET /api/auth/passkey/generate-register-options?context=…` | 200 challenge/rp/user for a valid minted context; **400** Arabic messages for missing/invalid/expired/tampered tokens |
| `POST /api/auth/passkey/verify-registration` | 200 in a real browser (Chromium virtual authenticator E2E): session cookie set, redirect to `/app`, passkey listed, rename/delete/sign-out/sign-in all pass |

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
| `convex/auth.ts` | `authComponent` (client with local schema), `createAuthOptions` (with the passkey `resolveUser`/`afterVerification` hooks), `createAuth`, `getCurrentUser` |
| `convex/authFlows.ts` | sign-up context token (HMAC mint/verify) + public `createSignUpContext` action |
| `convex/auth.config.ts` | Convex auth provider config |
| `convex/convex.config.ts` | registers the **local** `./betterAuth/convex.config` |
| `convex/betterAuth/convex.config.ts` | component definition |
| `convex/betterAuth/schema.ts` | **generated** schema (user, session, account, verification, passkey, jwks) |
| `convex/betterAuth/auth.ts` | static `auth` export **for schema generation only** — never import at runtime |
| `convex/betterAuth/adapter.ts` | adapter functions (`create`/`findOne`/… ) from the local schema |
| `convex/http.ts` | `authComponent.registerRoutes(http, createAuth)` → mounts `/api/auth/*` |
| `src/lib/auth-client.ts` | `createAuthClient({ plugins: [convexClient(), passkeyClient()] })` |
| `src/app/(auth)/{layout,signin,signup}` | Arabic RTL sign-up (`name → passkey`) and sign-in/account routes |
| `src/components/auth/**` | sign-up form, sign-in panel (conditional UI), account & security card, passkey error mapping, `require-auth` guard |
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

`SITE_URL` and `PASSKEY_RP_ID` are **required**: `createAuthOptions` fails
closed (`requireAuthEnv`) when either is unset, instead of silently binding
passkeys to `localhost`. The only caller allowed to supply fallbacks is the
schema-generation shim `convex/betterAuth/auth.ts` (see below), which runs
without deployment env.

`.env.local` (git-ignored): `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`,
`NEXT_PUBLIC_CONVEX_SITE_URL`, `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.
New worktrees/checkouts must copy it: `cp /home/abd/Coding/kuficraft/.env.local .`

## Rate limiting and abuse controls

Better Auth only enables its limiter automatically when
`NODE_ENV === "production"`, so `createAuthOptions` sets an explicit `rateLimit`
block (`enabled: true`, global `60 s / 100`). The unauthenticated `/passkey/*`
endpoints get tighter per-path rules:

| path | window | max |
| --- | --- | --- |
| `/passkey/generate-register-options` | 60 s | 10 |
| `/passkey/verify-registration` | 60 s | 20 |
| `/passkey/generate-authenticate-options` | 60 s | 20 |

Rules are keyed **without** the `/api/auth` prefix — Better Auth normalises the
path before looking a rule up. The first row matters most: every call mints a
`user` row (see the onboarding section).

### What it does and does not give you

* **Storage stays in-memory (the default).** No secondary storage is configured,
  so counters live inside each Convex isolate. There is **no `rateLimit` table**,
  which is why this change needs **no auth schema regeneration and no deployment
  change** (see "Changing auth options" below).
* **Best-effort, per isolate.** Convex can run many isolates and counters do not
  survive an isolate restart, so under real load the effective limit can be
  higher than the numbers above. Treat this as abuse friction, not a hard quota;
  a shared store (Convex or Redis as secondary storage) is the follow-up if you
  need one.
* **Unknown client IPs share one bucket.** The limiter keys on the request IP, so
  requests with no usable IP fall into a single bucket and throttle each other
  instead of an attacker.
* **The context token is not single-use by design.** Its only job is to prove
  "this client asked for an account with this name seconds ago". `resolveUser` is
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

Editing the `rateLimit` block alone does **not** need this flow: with the default
in-memory storage there is no `rateLimit` table, so the generated schema is
unchanged and there is nothing to regenerate or push.

## Passkey-first onboarding (the product requirement)

Sign-in/sign-up must work **without** passwords, email or OAuth:
“choose a name → create a passkey → you are in”. Implemented shape:

1. **Sign-up** (`/signup`, name only — no session, no email):
   * The form calls the Convex action `authFlows:createSignUpContext({ name })`.
     The action mints a context token: base64url JSON `{name, expiresAt,
     nonce}` signed with HMAC-SHA256 over `BETTER_AUTH_SECRET` (TTL 5 min,
     name 1–60 chars; verification requires all three fields).
   * The client calls `authClient.passkey.addPasskey({ name, context })`.
     `@better-auth/passkey@1.6.33` has **no** client-side `createSession`
     option — any doc claiming otherwise is wrong.
   * Server-side, `registration.resolveUser` (`convex/auth.ts`) verifies the
     token and creates the user through the component adapter with a synthetic
     unique email (`<nonce>@passkey.local`, method `passkey`).
   * `registration.afterVerification` creates the session via
     `internalAdapter.createSession(user.id)` and writes the cookie with
     `setSessionCookie` from `better-auth/cookies`, because
     `verify-registration` returns 200 but does **not** create a session by
     itself.
   * The client full-page-navigates to `/app` after the ceremony — the passkey
     client never fires `$sessionSignal` on registration.
2. **Sign-in** (`/signin`): `authClient.signIn.passkey({ autoFill: true })`
   with conditional UI (`autocomplete="username webauthn"` on the name field)
   — the chosen passkey signs in straight from the browser dropdown — plus an
   explicit button flow with real error reporting. Both paths end with a
   full-page navigation, not client routing: the session atom update can
   unmount the card before the promise continuation runs.
3. **Management**: `/signin` renders the account & security card when a session
   exists — list / rename / delete passkeys and sign-out
   (`authClient.passkey.*`); `require-auth` guards protected routes.
4. Behaviour **is verified against the live dev deployment**: HTTP checks for
   every option/verify endpoint plus a real-browser Chromium virtual
   authenticator E2E (sign-up → account → rename → sign-out → conditional-UI
   sign-in → button sign-in → delete).

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
* Display names are normalised on **both** sides of the token boundary:
  `normalizeDisplayName` (`convex/authFlows.ts`) applies NFC, strips C0/C1
  controls (their whitespace members `\t`/`\n`/`\r` are kept, so they collapse
  rather than glue words together), the soft hyphen, the Arabic letter mark,
  zero-width/bidi marks (`U+200B–U+200F`), bidi overrides (`U+202A–U+202E`),
  invisible/bidi isolates (`U+2060–U+2069`) and the BOM, then trims/collapses
  whitespace and caps at 60 chars. Without this an RTL override could render a
  name reversed or invisible and impersonate another user; `\s` matches none of
  those characters. A token minted under the old rules is re-checked on verify.

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
2. **The last-passkey guard is UI-only.** `account-security.tsx` disables delete
   while one passkey remains (`isOnlyPasskey`) and explains it in Arabic, but the
   server does not enforce it: `@better-auth/passkey`'s `delete-passkey` calls
   `ctx.context.adapter.delete` directly, bypassing `deleteWithHooks`, so a
   `hooks.before` guard never runs. Enforcing it server-side needs a custom
   endpoint or a patch around the plugin, verified against the live deployment.

