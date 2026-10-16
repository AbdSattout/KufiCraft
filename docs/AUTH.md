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
| `convex/auth.ts` | `authComponent` (client with local schema), `createAuthOptions`, `createAuth`, `getCurrentUser` |
| `convex/auth.config.ts` | Convex auth provider config |
| `convex/convex.config.ts` | registers the **local** `./betterAuth/convex.config` |
| `convex/betterAuth/convex.config.ts` | component definition |
| `convex/betterAuth/schema.ts` | **generated** schema (user, session, account, verification, passkey, jwks) |
| `convex/betterAuth/auth.ts` | static `auth` export **for schema generation only** — never import at runtime |
| `convex/betterAuth/adapter.ts` | adapter functions (`create`/`findOne`/… ) from the local schema |
| `convex/http.ts` | `authComponent.registerRoutes(http, createAuth)` → mounts `/api/auth/*` |
| `src/lib/auth-client.ts` | `createAuthClient({ plugins: [convexClient(), passkeyClient()] })` |
| `src/lib/auth-server.ts` | `convexBetterAuthNextJs(...)` helpers (`getToken`, `preloadAuthQuery`, …) |
| `src/app/api/auth/[...all]/route.ts` | `export const { GET, POST } = handler` (proxies to Convex) |
| `src/components/convex-client-provider.tsx` | `ConvexBetterAuthProvider` (client) |
| `src/lib/canvas/model.ts` | unrelated but same pattern: re-export shim |

## Environment

Deployment env vars (set — `bunx convex env list`):

| var | dev value | prod |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | random 32B base64 | new random value |
| `SITE_URL` | `http://localhost:3000` | `https://<prod-domain>` |
| `PASSKEY_RP_ID` | `localhost` | bare domain, e.g. `kuficraft.app` |

`.env.local` (git-ignored): `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`,
`NEXT_PUBLIC_CONVEX_SITE_URL`, `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.
New worktrees/checkouts must copy it: `cp /home/abd/Coding/kuficraft/.env.local .`

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

## Passkey-first onboarding (the product requirement)

Sign-in/sign-up must work **without** passwords, email or OAuth:
“choose a name → create a passkey → you are in”. Required design:

1. **Sign-up**: `passkey()` with
   `registration: { requireSession: false, resolveUser: ... }`.
   `resolveUser` validates a signed, short-lived context token (HMAC with
   `BETTER_AUTH_SECRET`) that the client obtained from a Convex action, then
   returns/creates the user for the WebAuthn ceremony.
   *Preferred (chosen) shape*: a Convex action mints the token for a pending
   name; `resolveUser` creates the user row through the component adapter and
   returns `{ id, name }`; the client then calls
   `authClient.passkey.addPasskey({ name, context, createSession: true })`.
   Verify with the real API from `node_modules/@better-auth/passkey/dist/index.mjs`
   (see `registerPasskey`/`resolveUser`).
2. **Sign-in**: `authClient.signIn.passkey({ autoFill: true })`, with
   conditional UI (`autocomplete="username webauthn"`) on the name field.
3. **Management**: list / rename / delete passkeys
   (`authClient.passkey.listUserPasskeys` / `deletePasskey`), sign-out, and a
   guard for protected routes.
4. Behaviour **must be verified against the live dev deployment** (HTTP + real
   ceremony is browser-only; at minimum assert the option/verification endpoints
   return the expected statuses and shapes via curl or a test).

## Gotchas (learned the hard way)

* Passkey `generate-*` endpoints are **GET**, `verify-*`/`delete`/`update` are
  **POST**. A wrong method returns **404**, not 405 — do not chase it as a
  routing bug.
* `better-auth/minimal` is the runtime import in Convex functions (no Node deps).
* The generated schema must include the `passkey` table (it does) — otherwise the
  plugin will fail at runtime with “table not found”.
* `ConvexError` messages are user-facing Arabic strings; toasts display them raw.
* Never run two `bunx convex dev` pushes against the same deployment
  simultaneously — coordinate with the orchestrator.
