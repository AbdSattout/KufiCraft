"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { createTokenSource } from "@/lib/convex-token";

/**
 * KufiCraft — Convex's view of the Better Auth session.
 *
 * This is the vendor's (`@convex-dev/better-auth/react`) auth hook, owned here
 * for one reason: the token path has to survive this machine's network, and the
 * vendor's version leaves no seam for that. It fetches the token with no
 * budget, no retry and no reuse window, so a `/api/auth/convex/token` call that
 * stalls — a fresh connection to the deployment can sit for undici's ten-second
 * connect timeout before it fails — leaves Convex without a token while the
 * session cookie is perfectly valid, and the screens above report an error for
 * a hiccup that is none of the visitor's doing.
 *
 * Kept from the vendor on purpose, because the screens depend on it:
 * `isLoading` means “the session is still unknown *and* there is no token yet”,
 * `isAuthenticated` means “there is a session, **or** a token in hand”, and a
 * token is dropped when the session goes away. New here: the token comes from
 * `createTokenSource` (reused until it nears its own expiry, one request for
 * concurrent callers, failures never cached), and `refetchConvexToken()` lets a
 * screen ask for a real retry instead of reloading the page.
 *
 * There is no cross-domain (`?ott=`) handling: the app reaches Convex through
 * the same-origin proxy and does not install `crossDomainClient`.
 */

/** The token endpoint, with a failure as `null` rather than a throw. */
async function fetchConvexToken(): Promise<string | null> {
  const { data } = await authClient.convex.token({
    fetchOptions: { throw: false },
  });
  return data?.token ?? null;
}

/** One source for the whole app: a shared cache, a shared single flight. */
const convexTokens = createTokenSource({ request: fetchConvexToken });

/**
 * Convex calls `setAuth()` again whenever the `fetchAccessToken` a hook returned
 * changes identity, which is the only public way back into the token path. The
 * hook below listens here and bumps a counter to hand Convex a new function.
 */
let rearmTokenFetch: (() => void) | null = null;

/** Asks Convex for a token again — the retry a screen can offer without a reload. */
export function refetchConvexToken(): void {
  rearmTokenFetch?.();
}

/** Only the first provider mount in the app's life uses its initial token. */
let initialTokenUsed = false;

export function createConvexAuthHook(initialToken?: string | null) {
  return function useConvexAuthFromBetterAuth() {
    const [generation, setGeneration] = useState(0);
    const { data: session, isPending: isSessionPending } = authClient.useSession();
    const sessionId = session?.session?.id;
    const [cachedToken, setCachedToken] = useState<string | null>(() =>
      initialTokenUsed ? null : (initialToken ?? null),
    );

    useEffect(() => {
      initialTokenUsed = true;
      rearmTokenFetch = () => setGeneration((value) => value + 1);
      return () => {
        rearmTokenFetch = null;
      };
    }, []);

    useEffect(() => {
      // Signed out for good: a token must not outlive its session.
      if (session || isSessionPending || cachedToken === null) return;
      convexTokens.expire();
      setCachedToken(null);
    }, [session, isSessionPending, cachedToken]);

    const fetchAccessToken = useCallback(
      async ({
        forceRefreshToken = false,
      }: {
        forceRefreshToken?: boolean;
      } = {}) => {
        const token = await convexTokens.get(forceRefreshToken);
        setCachedToken(token);
        return token;
      },
      // A new fetchAccessToken makes Convex run setAuth() again — the vendor
      // keys it on the session for exactly that reason, and `generation` is the
      // app's own retry. `convexTokens` never changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [sessionId, generation],
    );

    return useMemo(
      () => ({
        isLoading: isSessionPending && cachedToken === null,
        isAuthenticated: Boolean(session?.session) || cachedToken !== null,
        fetchAccessToken,
      }),
      [isSessionPending, session, cachedToken, fetchAccessToken],
    );
  };
}
