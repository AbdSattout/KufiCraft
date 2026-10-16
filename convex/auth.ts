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
import { signUpEmail, verifySignUpContextToken, PASSKEY_EMAIL_DOMAIN } from "./authFlows";
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
     * Explicit rate limiting: Better Auth only enables its limiter when
     * `NODE_ENV === "production"`, so without this block the unauthenticated
     * `/passkey/*` endpoints were effectively unmetered.
     *
     * Storage is the **database** (the auth component's own `rateLimit` table)
     * rather than the default in-memory store: Convex spreads http requests
     * over many isolates, so a per-isolate counter measured zero effective
     * limiting — a 110-request burst against a 100/60 s rule produced no 429.
     * The counters therefore have to live where every isolate can see them.
     * `bunx auth generate` + a deployment push create the table.
     */
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        /** Mints a `user` row per call — the most expensive public path. */
        "/passkey/generate-register-options": { window: 60, max: 10 },
        "/passkey/verify-registration": { window: 60, max: 20 },
        "/passkey/generate-authenticate-options": { window: 60, max: 20 },
      },
    },
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
            return { name: SIGN_UP_PASSKEY_NAME };
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

/** Current user profile, or null when signed out. */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const email = identity.email ?? null;
    return {
      id: identity.subject,
      name: identity.name ?? null,
      // Login-less accounts carry a synthetic `<nonce>@passkey.local`
      // address; never expose it (docs/AUTH.md).
      email:
        email !== null && email.endsWith(PASSKEY_EMAIL_DOMAIN) ? null : email,
      image: identity.pictureUrl ?? null,
    };
  },
});
