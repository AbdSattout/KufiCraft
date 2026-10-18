import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";

/**
 * The one message every Convex function throws for a caller with no session.
 *
 * The editor's save path matches on this exact string to tell “the token
 * blipped” apart from “the server rejected the write”
 * (`src/lib/save-state.ts`), so it lives here once and is imported from
 * there — never retyped.
 */
export const AUTH_REQUIRED_MESSAGE = "يجب تسجيل الدخول أولًا";

/**
 * Returns the Better Auth user id of the caller.
 *
 * The Convex `convex()` plugin from `@convex-dev/better-auth` puts the
 * Better Auth user id into the JWT subject, so `identity.subject` is the
 * stable ownership key for every document.
 */
export async function requireUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError(AUTH_REQUIRED_MESSAGE);
  }
  return identity.subject;
}
