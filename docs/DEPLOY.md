# KufiCraft — deployment guide

## What is already deployed

| piece | where | notes |
| --- | --- | --- |
| Convex **dev** deployment | `adamant-dragon-860` (team `abdsat`, project `kuficraft`) | `NEXT_PUBLIC_CONVEX_URL=https://adamant-dragon-860.convex.cloud`, site `…convex.site` |
| Convex **prod** deployment | `acrobatic-pika-276` | functions pushed, env vars set, `https://acrobatic-pika-276.convex.cloud` / `.convex.site` |
| Dev env vars | set on the dev deployment | `BETTER_AUTH_SECRET`, `SITE_URL=http://localhost:3000`, `PASSKEY_RP_ID=localhost` |
| Prod env vars | set on the prod deployment | `BETTER_AUTH_SECRET`, `SITE_URL=https://kuficraft.vercel.app`, `PASSKEY_RP_ID=kuficraft.vercel.app` |
| Vercel | project `kuficraft` → https://kuficraft.vercel.app | git-connected to `AbdSattout/KufiCraft@main` |
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

## Production (current setup)

### 1. Convex — done

```bash
bunx convex deploy          # pushes functions to the prod deployment acrobatic-pika-276
```

Prod-only env vars (already set; re-set only when the domain changes):

```bash
bunx convex env set --prod BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
bunx convex env set --prod SITE_URL "https://kuficraft.vercel.app"
bunx convex env set --prod PASSKEY_RP_ID "kuficraft.vercel.app"   # bare host, no scheme
bunx convex env set --prod --list
```

Run `bunx convex deploy` after **every** merge that touches `convex/`.

### 2. Vercel — env vars to confirm

The Vercel project currently proxies auth through the **dev** deployment; switch
it to the prod URLs (Project → Settings → Environment Variables, Production):

| variable | value |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | `https://acrobatic-pika-276.convex.cloud` |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | `https://acrobatic-pika-276.convex.site` |
| `NEXT_PUBLIC_SITE_URL` | `https://kuficraft.vercel.app` |

Preview deployments: point them at the dev deployment values if you want
previews to share dev data; note that passkeys do **not** work on preview URLs
(the RP ID only covers `kuficraft.vercel.app`). Redeploy after changing env vars
(`vercel --prod` or “Redeploy” in the dashboard).

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
