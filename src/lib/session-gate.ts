/**
 * KufiCraft — what the client's auth gate is allowed to conclude.
 *
 * The load-bearing invariant: a screen may leave for the sign-in dialog **only
 * on a resolved, authoritative “no session”** — a 200 whose session is null, or
 * a clean 401. A timeout, `fetch failed`, an aborted request, a 5xx, or a
 * session that exists while Convex has not received a token are all *transient*:
 * the screen stays, nothing navigates, and the gate says it is reconnecting.
 *
 * That is not politeness — it is the bug this codebase already fought: turning a
 * hiccup into a signed-out state sends a visitor the proxy still trusts to
 * `/?signin=1`, and the proxy's rule that `/?signin=1` renders the landing
 * whatever the cookie says is what keeps that from becoming a loop
 * (`src/lib/route-guards.ts`, docs/AUTH.md § Gotchas).
 *
 * The decision is pure so it can be tested without a DOM (the gate component
 * itself has no harness — see docs/AUTH.md § Transient failures).
 */

export type SessionOutcome =
  | "authenticated"
  | "pending"
  | "no-session"
  | "transient";

export interface GateInput {
  /** A session object arrived. */
  hasSession: boolean;
  /** The session request is still in flight. */
  sessionPending: boolean;
  /** The session request's error, if it failed (`BetterFetchError`, or a throw). */
  sessionError: unknown;
  /** Convex is still fetching or holding a token. */
  tokenPending: boolean;
  /** Convex holds a token the backend accepted. */
  tokenReady: boolean;
}

export interface GateDecision {
  /** Authoritative signed-out: the gate may navigate to `/?signin=1`. */
  signedOut: boolean;
  /** Nothing to decide yet — keep the screen on its normal loading state. */
  waiting: boolean;
  /** A transient failure: keep the screen; the quiet notice comes after retries. */
  transient: boolean;
  /** Signed in **and** Convex holds a token: server data may render. */
  ready: boolean;
}

/** `error.status` when the failure carried one, else null. */
export function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/**
 * What the session request itself said.
 *
 * A session object wins over any error: Better Auth keeps the last session data
 * when a refetch fails, and a live session must never be doubted because a
 * later request timed out. Only a 401 — or a resolved answer with no error and
 * no session — is authoritative. Every other failure (a 400/403/500, a throw,
 * an abort) is treated as transient, which is the safe direction: the cost of
 * assuming “transient” is a retry, the cost of guessing “signed out” is a
 * redirect loop.
 */
export function sessionOutcome(input: GateInput): SessionOutcome {
  if (input.hasSession) return "authenticated";
  if (input.sessionPending) return "pending";
  if (input.sessionError == null) return "no-session";
  return errorStatus(input.sessionError) === 401 ? "no-session" : "transient";
}

export function decideGate(input: GateInput): GateDecision {
  const session = sessionOutcome(input);

  if (session === "pending") {
    return { signedOut: false, waiting: true, transient: false, ready: false };
  }
  if (session === "no-session") {
    return { signedOut: true, waiting: false, transient: false, ready: false };
  }
  if (session === "transient") {
    return { signedOut: false, waiting: false, transient: true, ready: false };
  }

  // Authenticated. The screens still need Convex's token before they can read
  // server data, and a token that never arrived is transient too: the session
  // is real, so this must never read as “signed out”.
  if (input.tokenReady) {
    return { signedOut: false, waiting: false, transient: false, ready: true };
  }
  if (input.tokenPending) {
    return { signedOut: false, waiting: true, transient: false, ready: false };
  }
  return { signedOut: false, waiting: false, transient: true, ready: false };
}

/** Session refetches the gate makes by itself before it stops being quiet. */
export const SESSION_RETRIES = 2;
/** Backoff before the gate's first retry; doubled for the second. */
export const SESSION_RETRY_BACKOFF_MS = 400;
/**
 * Once those are spent the gate keeps asking, slowly, for as long as the
 * failure is on screen: the notice promises the app is reconnecting, so it has
 * to be — otherwise a link that heals on its own leaves the visitor with a dead
 * screen and a button.
 */
export const SESSION_RETRY_SLOW_MS = 10_000;
