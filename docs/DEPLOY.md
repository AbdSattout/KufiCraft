# KufiCraft — deployment guide

## What is already deployed

| piece | where | notes |
| --- | --- | --- |
| Convex **dev** deployment | `adamant-dragon-860` (team `abdsat`, project `kuficraft`) | `NEXT_PUBLIC_CONVEX_URL=https://adamant-dragon-860.convex.cloud`, site `…convex.site` |
| Dev env vars | set on the dev deployment | `BETTER_AUTH_SECRET`, `SITE_URL=http://localhost:3000`, `PASSKEY_RP_ID=localhost` |
| Git repo | `git@github.com:AbdSattout/KufiCraft.git` (private) | branch `main` |

`.env.local` (git-ignored) holds `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`,
`NEXT_PUBLIC_CONVEX_SITE_URL`, `NEXT_PUBLIC_SITE_URL`.

## Local development

```bash
bun install
cp .env.local .            # in a fresh checkout: copy from the main working copy
bunx convex dev            # watch mode: pushes functions, keeps _generated fresh
bun dev                    # http://localhost:3000 (Turbopack)
```

Passkeys in development require `http://localhost:3000` (WebAuthn allows
`localhost` over HTTP; any other host needs HTTPS) and
`PASSKEY_RP_ID=localhost`.

## Production

### 1. Convex

```bash
bunx convex deploy         # creates/uses the production deployment for the project
```

Then set production-only env vars (they must NOT be the dev values):

```bash
bunx convex env set --prod BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
bunx convex env set --prod SITE_URL "https://<your-domain>"
bunx convex env set --prod PASSKEY_RP_ID "<your-domain>"   # bare host, no scheme
bunx convex env set --prod --list
```

### 2. Hosting (decision pending)

The app is a standard Next.js server app; anything that runs `next build` /
`next start` works.

* **Vercel** — zero config; set `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`
  (prod values) and `NEXT_PUBLIC_SITE_URL=https://<domain>` in the project env.
  Preview deployments should point at the dev Convex deployment.
* **Cloudflare Workers/Pages** — needs `@opennextjs/cloudflare`; the auth proxy
  route and Convex client work unchanged. More setup work (Workers runtime
  instead of Node, no `openssl`), so prefer Vercel unless there is a reason.

### 3. Domain and passkeys (important)

WebAuthn credentials are bound to the **origin** (`PASSKEY_RP_ID` + `SITE_URL`):

* moving domains (or `www` vs apex) invalidates existing passkeys — pick the
  final domain before inviting users;
* `PASSKEY_RP_ID` must be the bare registrable domain (`kuficraft.app`) and the
  app must be served over HTTPS;
* users can always register a new passkey from the account screen, so a domain
  change is recoverable but needs support.

### 4. Post-deploy checklist

- [ ] `curl https://<domain>/api/auth/ok` → `{"ok":true}`
- [ ] `curl https://<domain>/api/auth/passkey/generate-authenticate-options` → challenge JSON
- [ ] create a passkey in a desktop browser, sign out, sign in with it
- [ ] create a project, draw, reload the page (data persists)
- [ ] open the same project on a phone: passkey prompt appears, edits sync live
- [ ] export SVG + PNG
- [ ] check the Convex dashboard for function errors and the usage graphs

## Data & backups

```bash
bunx convex export --prod --path ./backup.zip      # full data export
bunx convex export --path ./dev-backup.zip         # dev deployment
```

Old KufiCraft artworks live in the **browser localStorage** of the old site; a
migration helper (import JSON/PNG of old projects) is a candidate for a later
wave — decide with the user.
