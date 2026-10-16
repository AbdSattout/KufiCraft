import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import type { GenericCtx } from "@convex-dev/better-auth/utils";
import { APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { passkey } from "@better-auth/passkey";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import { signUpEmail, verifySignUpContextToken } from "./authFlows";
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

/** Default label for the passkey created by the sign-up flow. */
const SIGN_UP_PASSKEY_NAME = "مفتاح المرور";

/**
 * `better-auth/*` type entries resolve `better-auth@1.6.33`'s nested
 * `@better-auth/core`, while plugin callbacks are typed against the hoisted
 * `@better-auth/core`. Both point at the same runtime implementation, so this
 * is a types-only bridge for the one call that crosses the boundary.
 */
type PasskeyPluginOptions = NonNullable<
  ReturnType<typeof passkey>["options"]
>;
type PasskeyRegistrationHooks = NonNullable<
  PasskeyPluginOptions["registration"]
>;
type PluginEndpointContext = Parameters<
  NonNullable<PasskeyRegistrationHooks["afterVerification"]>
>[0]["ctx"];

const applySessionCookie = setSessionCookie as unknown as (
  ctx: PluginEndpointContext,
  session: Parameters<typeof setSessionCookie>[1],
) => Promise<void>;

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
        registration: {
          // Passkey-first sign-up: `/signup` has no session and no email.
          requireSession: false,
          /**
           * Called by `GET /passkey/generate-register-options?context=…`.
           * The context token is minted by `createSignUpContext`
           * (convex/authFlows.ts) and signed with `BETTER_AUTH_SECRET`.
           * Verified here, then the account row is created and returned as
           * the WebAuthn user for the ceremony.
           */
          resolveUser: async ({ ctx: endpointCtx, context }) => {
            const payload = await verifySignUpContextToken(
              context,
              process.env.BETTER_AUTH_SECRET,
            );
            if (!payload) {
              throw new APIError("BAD_REQUEST", {
                message: "انتهت صلاحية طلب إنشاء الحساب. أعد المحاولة من جديد.",
              });
            }
            const user = await endpointCtx.context.internalAdapter.createUser(
              { name: payload.name, email: signUpEmail(payload.nonce) },
              { method: "passkey" },
            );
            return {
              id: user.id,
              name: payload.name,
              displayName: payload.name,
            };
          },
          /**
           * Called by `POST /passkey/verify-registration` once the
           * authenticator answered. For a fresh sign-up the plugin does not
           * open a session on its own (it only stores the passkey row), so we
           * do it here — that is what makes "create a passkey → you are in"
           * work. When an already signed-in user adds another passkey, the
           * freshly issued session for the same user simply replaces the
           * cookie.
           */
          afterVerification: async ({ ctx: endpointCtx, user }) => {
            const createdSession =
              await endpointCtx.context.internalAdapter.createSession(user.id);
            const fullUser =
              await endpointCtx.context.internalAdapter.findUserById(user.id);
            if (fullUser) {
              await applySessionCookie(endpointCtx, {
                session: createdSession,
                user: fullUser,
              });
            }
            return { name: SIGN_UP_PASSKEY_NAME };
          },
        },
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
