"use client";

import { useCallback, useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { hardNavigate } from "@/components/auth/hard-navigate";
import { SIGN_IN_DIALOG_ROUTE } from "@/lib/route-guards";

export type RequireAuth = {
  /** The session request is still in flight. */
  isLoading: boolean;
  isAuthenticated: boolean;
  /** The session request failed: no answer, so the screens offer to ask again. */
  unavailable: boolean;
  retry: () => void;
};

/**
 * Client guard for the screens that need a session — the boards (`/`), a board
 * (`/<id>`) and `/account`.
 *
 * It reads the **session**, not Convex's auth state, and that distinction is the
 * point: when `/api/auth/convex/token` fails, Convex reports an anonymous client
 * while the session cookie is perfectly valid, so a guard on Convex's state
 * throws that visitor out of the editor for a hiccup that is none of their
 * doing. `useSession` answers the question that matters — “is there a session?”
 *
 * When the request *failed* (a timeout, DNS, a 500 from the auth proxy) there is
 * no answer at all, so the screens keep the visitor where they are and show a
 * retry instead of guessing. Only a resolved “no session” — including a 401 —
 * navigates to `/?signin=1`: the landing with the sign-in dialog open, which
 * `src/proxy.ts` renders whatever the cookie says, so a cookie it still believes
 * in cannot bounce the visitor back here forever.
 */
export function useRequireAuth(): RequireAuth {
  const { data: session, isPending, error, refetch } = authClient.useSession();
  const isAuthenticated = Boolean(session?.session);
  const unanswered = error !== null && error.status !== 401;

  useEffect(() => {
    if (isPending || isAuthenticated || unanswered) return;
    hardNavigate(SIGN_IN_DIALOG_ROUTE);
  }, [isPending, isAuthenticated, unanswered]);

  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    isLoading: isPending,
    isAuthenticated,
    unavailable: unanswered && !isPending,
    retry,
  };
}
