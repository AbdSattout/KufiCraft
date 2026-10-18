"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth } from "convex/react";
import { authClient } from "@/lib/auth-client";
import { hardNavigate } from "@/components/auth/hard-navigate";
import { refetchConvexToken } from "@/lib/convex-auth";
import { backoffDelay } from "@/lib/retry";
import { SIGN_IN_DIALOG_ROUTE } from "@/lib/route-guards";
import {
  decideGate,
  SESSION_RETRIES,
  SESSION_RETRY_BACKOFF_MS,
  SESSION_RETRY_SLOW_MS,
} from "@/lib/session-gate";

export type SessionGate = {
  /** Signed in **and** Convex holds a token: screens that read Convex data may render. */
  ready: boolean;
  /** Signed in — the session exists, whatever Convex's token did. */
  isAuthenticated: boolean;
  /** Waiting on the session, or on Convex's token once the session is in. */
  isLoading: boolean;
  /** Authoritative “no session”: the redirect to `/?signin=1` is already running. */
  signedOut: boolean;
  /** A transient failure the gate has stopped being quiet about: show the notice. */
  reconnecting: boolean;
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
 * token, because a Convex query without a token answers `يجب تسجيل الدخول أولًا`
 * and `useQuery` *throws* that — rendering the boards' data early does not show
 * an error, it crashes the screen.
 *
 * What is *not* allowed is what this guard used to do: treat every failure as
 * an error screen. Only a resolved “no session” — a 200 with a null session, or
 * a clean 401 — is authoritative enough to leave (`src/lib/session-gate.ts`).
 * Everything else keeps the current screen, and the gate asks again a couple of
 * times before it admits anything to the visitor.
 */
export function useRequireAuth(): SessionGate {
  const { data: session, isPending, error, refetch } = authClient.useSession();
  const convex = useConvexAuth();
  const hasSession = Boolean(session?.session);

  const decision = useMemo(
    () =>
      decideGate({
        hasSession,
        sessionPending: isPending,
        sessionError: error,
        tokenPending: convex.isLoading,
        tokenReady: convex.isAuthenticated,
      }),
    [hasSession, isPending, error, convex.isLoading, convex.isAuthenticated],
  );

  /**
   * The gate's retry budget. These are bookkeeping, not screen state, so they
   * live in refs — only `gaveUp`, the one thing the visitor sees, is state.
   */
  const attemptsRef = useRef(0);
  const gaveUpRef = useRef(false);
  const [gaveUp, setGaveUp] = useState(false);

  const askAgain = useCallback(() => {
    // Both halves: the session refetch covers a failed `/get-session`, and the
    // token re-arm is the only way to retry a failed `/convex/token`.
    refetchConvexToken();
    void refetch();
  }, [refetch]);

  const settled = decision.ready || decision.signedOut;

  useEffect(() => {
    // A resolved gate starts the next failure with a fresh budget. The blips
    // while the gate is still `waiting` do not count as a resolution.
    if (!settled) return;
    attemptsRef.current = 0;
    if (!gaveUpRef.current) return;
    gaveUpRef.current = false;
    setGaveUp(false);
  }, [settled]);

  useEffect(() => {
    if (!decision.transient) return;

    let cancelled = false;
    let timer: number | undefined;

    /**
     * The couple of quiet attempts first, then one slow ping at a time. The
     * chain re-arms itself because `decision.transient` need not flip between
     * attempts: a token fetch that fails without a state change would
     * otherwise end the retries after one round.
     */
    const schedule = (attempt: number): void => {
      if (attempt >= SESSION_RETRIES && !gaveUpRef.current) {
        gaveUpRef.current = true;
        setGaveUp(true);
      }
      const delay =
        attempt < SESSION_RETRIES
          ? backoffDelay(attempt, SESSION_RETRY_BACKOFF_MS)
          : SESSION_RETRY_SLOW_MS;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        attemptsRef.current = attempt + 1;
        askAgain();
        schedule(attempt + 1);
      }, delay);
    };

    schedule(attemptsRef.current);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [decision.transient, error, askAgain]);

  useEffect(() => {
    if (!decision.signedOut) return;
    hardNavigate(SIGN_IN_DIALOG_ROUTE);
  }, [decision.signedOut]);

  const retry = useCallback(() => {
    // A visitor's retry deserves a fresh budget, not the remains of one.
    attemptsRef.current = 0;
    gaveUpRef.current = false;
    setGaveUp(false);
    askAgain();
  }, [askAgain]);

  return {
    ready: decision.ready,
    isAuthenticated: hasSession,
    isLoading: decision.waiting,
    signedOut: decision.signedOut,
    reconnecting: decision.transient && gaveUp,
    retry,
  };
}
