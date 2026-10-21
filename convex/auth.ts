import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import type { GenericCtx } from "@convex-dev/better-auth/utils";
import { APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { passkey } from "@better-auth/passkey";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import {
  DEFAULT_PASSKEY_NAME,
  signUpEmail,
  verifySignUpContextToken,
} from "./authFlows";
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

/**
 * Values the schema-generation shim may supply so `bunx auth generate` works
 * without deployment env. **Never** passed by a live request: one must fail
 * closed rather than bind passkeys to a guessed origin.
 */
export interface AuthOriginOverrides {
  siteUrl?: string;
  rpID?: string;
}

/**
 * The library evaluates the options factory **at module load**, not only per
 * request: `createApi` (convex/betterAuth/adapter.ts) derives the auth tables
 * from `createAuthOptions({})`, and `registerRoutes` builds a throwaway
 * instance to read the base path. That evaluation also runs during Convex's
 * module-analysis phase, which has **no deployment env** — a throw there fails
 * the whole push (`InvalidModules`) before anything is deployed, so the origin
 * must degrade to a fallback for that path. A live request carries a real
 * action context, and `createAuth` is where it fails closed.
 */
const MODULE_LOAD_FALLBACK = {
  siteUrl: "http://localhost:3000",
  rpID: "localhost",
} as const;

/** Deployment env, trimmed; `undefined` when unset or blank. */
function authEnv(name: "SITE_URL" | "PASSKEY_RP_ID"): string | undefined {
  const value = process.env[name]?.trim();
  return value !== undefined && value.length > 0 ? value : undefined;
}

/**
 * Fails closed for a live request: a deployment that never set these must not
 * bind passkeys to a guessed origin (docs/AUTH.md § Environment). The only
 * context without them is the library's own module-load evaluation, which is
 * detected by the action context it does not have.
 */
function assertAuthOrigins(): void {
  const missing = (["SITE_URL", "PASSKEY_RP_ID"] as const).filter(
    (name) => authEnv(name) === undefined,
  );
  if (missing.length === 0) return;
  throw new Error(
    `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set — KufiCraft auth fails closed instead of silently falling back to localhost. Set ${missing.length > 1 ? "them" : "it"} on the Convex deployment (see docs/AUTH.md).`,
  );
}

/** A real http-action context exposes `runQuery`; the module-load `{}` does not. */
function isLiveRequest(ctx: unknown): boolean {
  const candidate = ctx as { runQuery?: unknown } | null;
  return typeof candidate?.runQuery === "function";
}

export const createAuthOptions = (
  ctx: GenericCtx<DataModel>,
  overrides?: AuthOriginOverrides,
) => {
  const siteUrl =
    overrides?.siteUrl ?? authEnv("SITE_URL") ?? MODULE_LOAD_FALLBACK.siteUrl;
  const rpID =
    overrides?.rpID ?? authEnv("PASSKEY_RP_ID") ?? MODULE_LOAD_FALLBACK.rpID;
  return {
    appName: "KufiCraft",
    baseURL: siteUrl,
    secret: process.env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    // KufiCraft is passkey-only: no passwords, no email flows.
    emailAndPassword: { enabled: false },
    /**
     * Rate limiting is **off on purpose**, and this is an explicit `false`
     * rather than an omitted key: Better Auth turns its limiter on by itself
     * when `NODE_ENV === "production"`, so deleting the block would quietly
     * re-enable the in-memory limiter.
     *
     * Why off — measured, not assumed (docs/AUTH.md § Rate limiting):
     *  - Better Auth can only key a bucket by `"<ip>|<path>"`
     *    (`createRateLimitKey`), so there is no way to limit a *user*.
     *  - Through the Next proxy Convex sees Vercel's egress IP, not the
     *    browser's, so every user shares a bucket: the limits do not constrain
     *    an abuser (a Vercel egress pool spreads requests) but they do let one
     *    visitor throttle every other visitor.
     *  - The one path worth protecting — `passkey/generate-register-options`,
     *    which mints a `user` row before the authenticator answers — is
     *    pre-auth by definition, so it has no user id to key on either.
     * With `storage: "database"` every auth request also paid a component
     * read + write for that non-protection. If abuse control is needed later,
     * the honest fixes are bot verification on the sign-up form (Turnstile) or
     * a global cap on minting sign-up contexts; both are recorded in
     * docs/AUTH.md § Known follow-ups.
     */
    rateLimit: { enabled: false },
    plugins: [
      passkey({
        rpID,
        rpName: "KufiCraft",
        origin: siteUrl,
        /**
         * Anonymous sign-in sends no `allowCredentials`, so it can only find a
         * *discoverable* credential. `"preferred"` (the plugin default) lets an
         * authenticator create a non-discoverable one, which then exists in the
         * database but is invisible to sign-in. Requiring a resident key closes
         * that failure; an authenticator that cannot comply fails the
         * registration clearly instead of silently creating an unusable key.
         */
        authenticatorSelection: { residentKey: "required" },
        registration: {
          // Passkey-first sign-up: the auth panel's create section has no
          // session and no email.
          requireSession: false,
          /**
           * Called by `GET /passkey/generate-register-options?context=…`.
           * The context token is minted by `createSignUpContext`
           * (convex/authFlows.ts) and signed with `BETTER_AUTH_SECRET`.
           * Verified here, then the account row is created and returned as
           * the WebAuthn user for the ceremony. The name comes from the signed
           * token, never from the client query string.
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
            const email = signUpEmail(payload.nonce);
            const existing =
              await endpointCtx.context.internalAdapter.findUserByEmail(email);
            if (existing) {
              /**
               * The context token is **not single-use by design**, but the
               * account it mints is: creating it twice would hit the adapter's
               * unique-email constraint and surface an opaque 500. Detect the
               * repeat here and fail with a clean Arabic 4xx instead
               * (docs/AUTH.md).
               */
              throw new APIError("BAD_REQUEST", {
                message: "تم استخدام طلب إنشاء الحساب مسبقًا. ابدأ من جديد.",
              });
            }
            /**
             * An account **is** its passkey, so the user row, the WebAuthn
             * user the OS prompt shows and the passkey row must all carry the
             * same normalized name. This is the token's name; the client never
             * sends a second copy.
             */
            const user = await endpointCtx.context.internalAdapter.createUser(
              { name: payload.name, email },
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
            return { name: user.name || DEFAULT_PASSKEY_NAME };
          },
        },
      }),
      // Required for Convex compatibility.
      convex({ authConfig }),
    ],
  } satisfies BetterAuthOptions;
};

export const createAuth = (
  ctx: GenericCtx<DataModel>,
  overrides?: AuthOriginOverrides,
) => {
  // Overrides mean the deployment-less schema shim (`bunx auth generate`) or a
  // test; anything else that is not a real request is the library building its
  // throwaway instance at module load.
  if (overrides === undefined && isLiveRequest(ctx)) assertAuthOrigins();
  return betterAuth(createAuthOptions(ctx, overrides));
};
