import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { createResilientAuthFetch } from "@/lib/auth-fetch";

/**
 * Same-origin client: requests go to `/api/auth/*` on the Next.js app,
 * which proxies them to the Convex deployment's HTTP actions.
 *
 * `customFetchImpl` is the one seam Better Auth leaves for the transport, and
 * this machine's link to the deployment needs it: a GET no one answers within
 * four seconds is asked again instead of waiting out undici's ten-second
 * connect timeout (`src/lib/auth-fetch.ts`). POSTs — the passkey ceremonies,
 * sign-out — pass through untouched.
 */
export const authClient = createAuthClient({
  plugins: [convexClient(), passkeyClient()],
  fetchOptions: { customFetchImpl: createResilientAuthFetch() },
});
