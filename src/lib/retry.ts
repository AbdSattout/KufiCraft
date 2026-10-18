/**
 * KufiCraft — retry for **idempotent** work on a flaky link.
 *
 * Only a GET (the session, the Convex token) or a read-only re-ask may be
 * wrapped in this. The Convex client already queues *mutations* and replays
 * them after a socket restart, and the passkey ceremonies are POSTs that must
 * never be replayed — a second registration is a second account. The decision
 * of what is idempotent stays with the caller; this helper only knows how to
 * ask again a couple of times with a backoff.
 *
 * `sleep` is injectable so the tests need no fake timers, and a caller that
 * must abandon its retries can pass its own abortable wait.
 */

export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export interface RetryOptions {
  /** Total attempts, the first one included. Default 2 (one retry). */
  attempts?: number;
  /** Delay before the second attempt; doubled for every attempt after it. */
  backoffMs?: number;
  sleep?: Sleep;
  /** Called before every attempt but the first; `false` stops retrying now. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/** Delay before attempt `index` (0-based) — `backoffMs`, then twice that, … */
export function backoffDelay(index: number, backoffMs: number): number {
  return backoffMs * 2 ** Math.max(0, index);
}

/**
 * Runs `run` until it resolves, then resolves with its value; the last error is
 * rethrown when every attempt failed, so the caller keeps deciding what a
 * failure means (a quiet reconnect, a notice, a toast).
 */
export async function retryTransient<T>(
  run: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 2));
  const backoffMs = options.backoffMs ?? 250;
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts - 1) break;
      if (!shouldRetry(error, attempt)) break;
      await sleep(backoffDelay(attempt, backoffMs));
    }
  }
  throw lastError;
}
