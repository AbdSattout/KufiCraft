import { createAuth } from "../auth";

/**
 * Static instance used ONLY by the Better Auth CLI to generate
 * `convex/betterAuth/schema.ts`. Never import this file at runtime.
 *
 *   cd convex/betterAuth && bunx auth generate
 */
export const auth = createAuth({} as Parameters<typeof createAuth>[0], {
  // Schema generation is a local, deployment-less operation: supply the
  // origins explicitly so the request-time env assertion in `createAuth`
  // (docs/AUTH.md § Environment) never needs deployment env here.
  siteUrl: "http://localhost:3000",
  rpID: "localhost",
});
