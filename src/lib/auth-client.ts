import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

/**
 * Same-origin client: requests go to `/api/auth/*` on the Next.js app,
 * which proxies them to the Convex deployment's HTTP actions.
 */
export const authClient = createAuthClient({
  plugins: [convexClient(), passkeyClient()],
});
