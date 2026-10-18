/**
 * KufiCraft — the save/connection state behind the editor's indicator.
 *
 * The old editor had a boolean (`saving`) and a toast for every failure, which
 * is exactly what turns a flaky link into a screen that flashes an error on
 * every click. This module replaces both with one honest, quiet state:
 *
 * * `saved` — the server acknowledged everything; the screen matches it;
 * * `saving` — writes are in flight and nothing has gone wrong *yet*;
 * * `retrying` — a write was rejected as transient, or has been in flight for
 *   long enough that silence is no longer innocent;
 * * `offline` — the same, but longer, or the browser itself says it is offline.
 *
 * The invariant that matters: a pending change is never reported as `saved`.
 * The indicator may be quiet, but it may not lie about a change that has not
 * landed.
 */

import { ConvexError } from "convex/values";
import { AUTH_REQUIRED_MESSAGE } from "../../convex/lib/auth";

export type SaveState = "saved" | "saving" | "retrying" | "offline";

/**
 * The message every Convex function throws when the caller has no session —
 * defined once in `requireUserId`'s module and imported from there, so the
 * string the server throws and the string the editor matches can never drift.
 * It is the one *transient* rejection the editor can classify: the token will
 * come back and the write is re-sent.
 */
export { AUTH_REQUIRED_MESSAGE };

/** Silence after which an in-flight write is called retrying. */
export const SAVE_STALL_MS = 5_000;
/** How long a held write stays “retrying” before it is called offline. */
export const SAVE_OUTAGE_MS = 15_000;
/** How often the indicator's clock ticks while something is pending. */
export const SAVE_TICK_MS = 1_000;
/** How often a held document is offered to the server again. */
export const RESYNC_RETRY_MS = 10_000;

export interface SaveSnapshot {
  /** Writes not acknowledged by the server: in flight **or** held. */
  pending: number;
  /** When the oldest pending write was made, or null when nothing is pending. */
  since: number | null;
  /** Pending writes the server rejected as transient (waiting for the resync). */
  held: number;
  /** `navigator.onLine`, or true where the browser cannot say. */
  online: boolean;
  /** Now, so the decision is a pure function of the snapshot. */
  now: number;
}

export function saveStateOf({
  pending,
  since,
  held,
  online,
  now,
}: SaveSnapshot): SaveState {
  if (pending === 0) return "saved";
  if (!online) return "offline";

  const waited = since === null ? 0 : now - since;
  // A held write is already known to be unsaved; a rejected one is only worth
  // the stronger word once it has been unsaved for a while.
  if (held > 0) return waited >= SAVE_OUTAGE_MS ? "offline" : "retrying";
  // Nothing failed, but a write that has been in flight for seconds is not
  // "saving" in any useful sense on a link like this one.
  return waited >= SAVE_STALL_MS ? "retrying" : "saving";
}

/**
 * Is this rejection worth holding on to?
 *
 * The Convex client replays mutations that were never *acknowledged*, so a
 * stalled write needs no help. A mutation the server *rejected* is different:
 * the usual rejection here is `requireUserId`, i.e. the client was between
 * tokens for a moment. That one is transient — the same document is offered
 * again once Convex holds a token. Anything else (the item cap, a missing
 * board, a validation error) is the server's verdict and is surfaced as it was.
 */
export function isTransientSaveError(error: unknown): boolean {
  if (error instanceof ConvexError) return error.data === AUTH_REQUIRED_MESSAGE;
  if (typeof error !== "object" || error === null) return false;

  const shape = error as { name?: unknown; message?: unknown; cause?: unknown };
  if (shape.name === "AbortError" || shape.name === "TimeoutError") return true;
  if (typeof shape.message === "string" && shape.message.includes("fetch failed")) {
    return true;
  }
  const cause = shape.cause as { code?: unknown } | undefined;
  return typeof cause?.code === "string" && cause.code.startsWith("UND_ERR");
}
