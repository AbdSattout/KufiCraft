"use client";

import { useEffect } from "react";
import { useConvexAuth } from "convex/react";
import { authClient } from "@/lib/auth-client";
import { hardNavigate } from "@/components/auth/hard-navigate";
import { SIGN_IN_DIALOG_ROUTE } from "@/lib/route-guards";

/**
 * Client guard for the screens that need a session (`/app`, `/account`). The
 * proxy already turned anonymous visitors away, so reaching this with no session
 * means the cookie is stale (an expired session, or a deployment whose users
 * changed) — and because the proxy only *reads* that cookie, `/` would rewrite
 * straight back to the dashboard. Signing out is what clears it: it drops the
 * cookie, and the trip home then really lands on the landing, with the sign-in
 * dialog open (`SIGN_IN_DIALOG_ROUTE`).
 *
 * Callers keep rendering their skeleton until `isAuthenticated` is true.
 */
export function useRequireAuth(): {
  isLoading: boolean;
  isAuthenticated: boolean;
} {
  const { isLoading, isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    void (async () => {
      try {
        await authClient.signOut();
      } catch {
        // Navigating away is the point of this effect; a failed sign-out only
        // means the stale cookie survives and the banner shows again.
      }
      hardNavigate(SIGN_IN_DIALOG_ROUTE);
    })();
  }, [isLoading, isAuthenticated]);

  return { isLoading, isAuthenticated };
}
