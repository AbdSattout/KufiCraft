import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";

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
    throw new ConvexError("يجب تسجيل الدخول أولًا");
  }
  return identity.subject;
}

/** Same as `requireUserId` but returns null instead of throwing. */
export async function getUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}
