"use client";

import { useCallback, useEffect } from "react";
import { useConvexAuth } from "convex/react";
import { authClient } from "@/lib/auth-client";
import { hardNavigate } from "@/components/auth/hard-navigate";
import { SIGN_IN_DIALOG_ROUTE } from "@/lib/route-guards";

export type SessionGate = {
  /** Signed in **and** Convex holds a token: screens that read Convex data may render. */
  ready: boolean;
  /** Signed in — the session exists, whatever Convex's token did. */
  isAuthenticated: boolean;
  /** Waiting on the session, or on Convex's token once the session is in. */
  isLoading: boolean;
  /** The app cannot show server data: the session request failed, or Convex never got a token. */
  unavailable: boolean;
  /** The session request itself failed — no token involved. */
  sessionFailed: boolean;
  retry: () => void;
};

/**
 * Client guard for the screens that need a session — the boards (`/`), a board
 * (`/<id>`) and `/account`.
 *
 * It reads the **session** (`authClient.useSession`), not only Convex's auth
 * state, and that distinction is the point: when `/api/auth/convex/token` fails,
 * Convex reports an anonymous client while the session cookie is perfectly
 * valid, so a guard on Convex's state alone throws that visitor out of the
 * editor for a hiccup that is none of their doing.
 *
 * `ready` is the other half of it: the session is real **and** Convex holds a
 * token. Until then the screens wait, because a Convex query without a token
 * answers `يجب تسجيل الدخول أولًا`, and `useQuery` *throws* that — rendering the
 * boards' data early does not show an error, it crashes the screen.
 *
 * When no answer arrives (a timeout, DNS, a 500 from the auth proxy), or the
 * session is live but Convex never received a token, the screens offer a retry
 * instead of guessing. Only a resolved “no session” — including a 401 —
 * navigates to `/?signin=1`: the landing with the sign-in dialog open, which
 * `src/proxy.ts` renders whatever the cookie says, so a cookie it still believes
 * in cannot bounce the visitor back here forever.
 */
export function useRequireAuth(): SessionGate {
  const { data: session, isPending, error, refetch } = authClient.useSession();
  const convex = useConvexAuth();
  const hasSession = Boolean(session?.session);

  // A failed session request is not evidence of anything…
  const sessionFailed = error !== null && error.status !== 401;
  // …but a live session with no Convex token means the token endpoint failed.
  const tokenMissing = hasSession && !convex.isLoading && !convex.isAuthenticated;

  useEffect(() => {
    if (isPending || hasSession || sessionFailed) return;
    hardNavigate(SIGN_IN_DIALOG_ROUTE);
  }, [isPending, hasSession, sessionFailed]);

  const retry = useCallback(() => {
    if (tokenMissing) {
      // Convex only asks for a token when the session changes, and nothing here
      // can change it: a reload is the retry that can actually work.
      window.location.reload();
      return;
    }
    void refetch();
  }, [tokenMissing, refetch]);

  return {
    ready: hasSession && convex.isAuthenticated,
    isAuthenticated: hasSession,
    isLoading: isPending || (hasSession && convex.isLoading),
    unavailable: !isPending && (sessionFailed || tokenMissing),
    sessionFailed,
    retry,
  };
}
