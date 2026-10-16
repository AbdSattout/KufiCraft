import { createAuth } from "../auth";

/**
 * Static instance used ONLY by the Better Auth CLI to generate
 * `convex/betterAuth/schema.ts`. Never import this file at runtime.
 *
 *   cd convex/betterAuth && bunx auth generate
 */
export const auth = createAuth({} as Parameters<typeof createAuth>[0]);
