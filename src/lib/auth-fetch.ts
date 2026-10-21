/**
 * KufiCraft — the fetch the Better Auth client uses for `/api/auth/*`.
 *
 * Every one of those calls is proxied by the Next server to the Convex
 * deployment, and on this machine that one hop is the whole problem: a bare
 * request to the site takes seconds, and a fresh connection can sit until
 * undici's 10-second connect timeout before it fails. The app cannot fix the
 * network, so it does the two things it can:
 *
 * * **fail a dead attempt fast.** A GET gets a 4-second budget to produce
 *   response headers; a connection that is never going to answer is abandoned
 *   while a *second* attempt still has time to win. The budget is deliberately
 *   not a whole-request timeout — it is cleared as soon as the answer arrives,
 *   so a slow body is never cut in half.
 * * **ask again, once.** GETs are idempotent reads; the passkey and sign-out
 *   ceremonies are POSTs and are passed through completely untouched — a
 *   replayed ceremony would be a second account, not a second read. The one
 *   GET that is *not* a read is `generate-register-options` (it mints a user
 *   row): it gets the budget but never a replay, because a replay with the
 *   same context token fails as "already used" even when the first attempt is
 *   the one that created the row.
 *
 * A caller's own abort (Better Auth cancels a superseded session fetch) is
 * passed through: it is not a failure to retry.
 */

import { retryTransient, type Sleep } from "@/lib/retry";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ResilientFetchOptions {
  /** Attempts per GET, the first included. Default 2. */
  attempts?: number;
  backoffMs?: number;
  /** Time to response headers before an attempt is abandoned. Default 4000 ms. */
  timeoutMs?: number;
  sleep?: Sleep;
}

export const AUTH_GET_TIMEOUT_MS = 4_000;
export const AUTH_GET_ATTEMPTS = 2;
export const AUTH_GET_BACKOFF_MS = 250;

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (typeof init?.method === "string") return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if ("url" in input) return input.url;
  return input.href;
}

/**
 * `generate-register-options` is a GET, but it is not a read: it mints a user
 * row before the authenticator answers. Replaying it with the same context
 * token makes `resolveUser` reject the repeat ("تم استخدام…") even when the
 * first attempt is the one that created the row. The budget still applies —
 * one attempt only.
 */
function isRegistrationOptionsGet(input: RequestInfo | URL): boolean {
  return urlOf(input).includes("/passkey/generate-register-options");
}

function signalOf(input: RequestInfo | URL, init?: RequestInit): AbortSignal | undefined {
  if (init?.signal) return init.signal;
  if (typeof Request !== "undefined" && input instanceof Request) return input.signal;
  return undefined;
}

function combine(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const present = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return AbortSignal.any(present);
}

async function fetchWithinBudget(
  impl: FetchLike,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(), timeoutMs);
  try {
    return await impl(input, {
      ...init,
      signal: combine([signalOf(input, init), budget.signal]),
    });
  } finally {
    // Headers are in (or the attempt is over): the body must not be aborted.
    clearTimeout(timer);
  }
}

export function createResilientAuthFetch(
  impl: FetchLike = (input, init) => fetch(input, init),
  {
    attempts = AUTH_GET_ATTEMPTS,
    backoffMs = AUTH_GET_BACKOFF_MS,
    timeoutMs = AUTH_GET_TIMEOUT_MS,
    sleep,
  }: ResilientFetchOptions = {},
): FetchLike {
  return (input, init) => {
    if (methodOf(input, init) !== "GET") return impl(input, init);
    const caller = signalOf(input, init);
    if (isRegistrationOptionsGet(input)) {
      // One bounded attempt: the retry would consume the context token's
      // single registration. The budget still ends a dead connection fast.
      return fetchWithinBudget(impl, input, init, timeoutMs);
    }
    return retryTransient(
      () => fetchWithinBudget(impl, input, init, timeoutMs),
      {
        attempts,
        backoffMs,
        sleep,
        // The caller cancelled: that is not this layer's failure to retry.
        shouldRetry: () => !caller?.aborted,
      },
    );
  };
}
