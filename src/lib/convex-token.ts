/**
 * KufiCraft — the Convex auth token, kept instead of re-asked.
 *
 * Every Convex auth token comes from `GET /api/auth/convex/token`, which the
 * Next server proxies to the deployment — the exact hop that can stall on this
 * machine. The source below sits in front of that call and:
 *
 * * **reuses** a token until it is close to its `exp` (the JWT says when), so a
 *   screen that remounts, a second tab, or Convex's own `setConfig` does not
 *   pay for another round trip;
 * * **single-flights** concurrent misses — two callers that both need a token
 *   make one request, not two;
 * * **never caches a failure**: an error (or an empty answer) is returned as
 *   `null` and the next caller asks again. A *still-fresh* cached token is left
 *   in place, so a failed forced refresh does not also destroy a token that
 *   works.
 *
 * `now`, `sleep` and the attempt count are injectable, which is what makes the
 * policy testable without fake timers.
 */

import { retryTransient, type Sleep } from "@/lib/retry";

export interface TokenSourceOptions {
  /** The raw call. Resolves `null` when the endpoint answered without a token. */
  request: () => Promise<string | null>;
  now?: () => number;
  sleep?: Sleep;
  /** Attempts per refresh, the first included. Default 2. */
  attempts?: number;
  backoffMs?: number;
  /** How long a token without a readable `exp` is reused. Default 5 minutes. */
  fallbackTtlMs?: number;
  /** Stop reusing a token this long before its `exp`. Default 30 seconds. */
  leewayMs?: number;
}

export interface TokenSource {
  /** A cached token, or a fresh one. `forceRefresh` skips the cache. */
  get(forceRefresh?: boolean): Promise<string | null>;
  /** Drops the cached token — a signed-out session must not keep one. */
  expire(): void;
}

/** `exp` of a JWT as epoch milliseconds, or null when it cannot be read. */
export function tokenExpiryMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims: unknown = JSON.parse(json);
    if (typeof claims !== "object" || claims === null) return null;
    const exp = (claims as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function createTokenSource({
  request,
  now = Date.now,
  sleep,
  attempts = 2,
  backoffMs = 250,
  fallbackTtlMs = 5 * 60_000,
  leewayMs = 30_000,
}: TokenSourceOptions): TokenSource {
  let cached: { token: string; freshUntil: number } | null = null;
  let inflight: Promise<string | null> | null = null;
  /** Bumped by `expire()`, so an in-flight answer cannot resurrect a token. */
  let generation = 0;

  const isFresh = () => cached !== null && cached.freshUntil > now();

  const load = async (): Promise<string | null> => {
    const startedAt = generation;
    let token: string;
    try {
      token = await retryTransient(
        async () => {
          const value = await request();
          // An empty answer is a failure, not a cache entry: the session may be
          // gone, and that has to be re-asked on the next call.
          if (!value) throw new Error("no token in the answer");
          return value;
        },
        { attempts, backoffMs, sleep },
      );
    } catch {
      return null;
    }
    if (startedAt === generation) {
      const expiry = tokenExpiryMs(token);
      const freshUntil = Math.min(
        expiry === null ? Number.POSITIVE_INFINITY : expiry - leewayMs,
        now() + fallbackTtlMs,
      );
      cached = freshUntil > now() ? { token, freshUntil } : null;
    }
    return token;
  };

  return {
    get(forceRefresh = false) {
      if (inflight !== null) return inflight;
      if (!forceRefresh && isFresh()) {
        return Promise.resolve(cached === null ? null : cached.token);
      }
      inflight = load().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    expire() {
      generation += 1;
      cached = null;
    },
  };
}
