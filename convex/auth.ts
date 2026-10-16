import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import type { GenericCtx } from "@convex-dev/better-auth/utils";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { passkey } from "@better-auth/passkey";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";

/**
 * Convex + Better Auth, "local install" flavor: the auth schema lives in
 * `convex/betterAuth/schema.ts` (generated from these options with
 * `bunx auth generate`), so we can use plugins Convex does not ship
 * first-class support for — here, passkeys.
 */

// Local install: the component's schema is generated from our own auth
// options (see convex/betterAuth/schema.ts + `bunx auth generate`).
export const authComponent = createClient<DataModel, typeof authSchema>(
  components.betterAuth,
  { local: { schema: authSchema } },
);

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";
  const rpID = process.env.PASSKEY_RP_ID ?? "localhost";
  return {
    appName: "KufiCraft",
    baseURL: siteUrl,
    secret: process.env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    // KufiCraft is passkey-only: no passwords, no email flows.
    emailAndPassword: { enabled: false },
    plugins: [
      passkey({
        rpID,
        rpName: "KufiCraft",
        origin: siteUrl,
      }),
      // Required for Convex compatibility.
      convex({ authConfig }),
    ],
  } satisfies BetterAuthOptions;
};

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));

/** Current user profile, or null when signed out. */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return {
      id: identity.subject,
      name: identity.name ?? null,
      email: identity.email ?? null,
      image: identity.pictureUrl ?? null,
    };
  },
});
