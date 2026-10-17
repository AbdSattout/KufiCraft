/// <reference types="vite/client" />

import { afterEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";
import {
  PASSKEY_EMAIL_DOMAIN,
  createSignUpContextToken,
  signUpEmail,
  verifySignUpContextToken,
} from "./authFlows";

/**
 * `convex/authFlows.ts` is the public, session-less entry point of sign-up:
 * `createSignUpContext` mints an HMAC-signed token and the passkey plugin's
 * `resolveUser` (convex/auth.ts) verifies it before the account row is created.
 * There is no display name to carry — an account *is* its passkey
 * (docs/AUTH.md § Accounts) — so the token is only a short-lived, signed
 * "go ahead" for one registration ceremony.
 *
 * The modules map is scoped to the two things this suite needs, exactly like
 * `projects.test.ts` (which deliberately excludes the auth module graph).
 */
const modules = import.meta.glob(["./authFlows.ts", "./_generated/*.js"]);

const newTest = () => convexTest(undefined, modules);

const TEST_SECRET = "test-secret-for-auth-flows";

/** Arabic user-facing message specified by docs/AUTH.md. */
const SECRET_ERROR = "خدمة إنشاء الحساب غير مهيأة حاليًا";

const originalSecret = process.env.BETTER_AUTH_SECRET;
function useSecret(secret: string | undefined): void {
  if (secret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = secret;
}
afterEach(() => useSecret(originalSecret));

/* ------------------------------------------------------------------ */
/* token contract                                                      */
/* ------------------------------------------------------------------ */

describe("sign-up context token", () => {
  const now = Date.now();

  it("round-trips nonce and expiry", async () => {
    const { token, expiresAt } = await createSignUpContextToken(TEST_SECRET, now);
    expect(expiresAt).toBeGreaterThan(now);
    const payload = await verifySignUpContextToken(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.expiresAt).toBe(expiresAt);
    expect(payload?.nonce.length).toBeGreaterThanOrEqual(8);
  });

  it("gives every token a fresh nonce", async () => {
    const first = await createSignUpContextToken(TEST_SECRET, now);
    const second = await createSignUpContextToken(TEST_SECRET, now);
    expect(first.token).not.toBe(second.token);
  });

  it("rejects a tampered payload", async () => {
    const { token } = await createSignUpContextToken(TEST_SECRET, now);
    const separator = token.indexOf(".");
    const payloadPart = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const flipped =
      payloadPart.slice(0, 2) +
      (payloadPart[2] === "A" ? "B" : "A") +
      payloadPart.slice(3);
    expect(flipped).not.toBe(payloadPart);
    expect(
      await verifySignUpContextToken(`${flipped}.${signature}`, TEST_SECRET),
    ).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const { token } = await createSignUpContextToken(TEST_SECRET, now);
    const separator = token.indexOf(".");
    const payloadPart = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const last = signature.slice(-1);
    const flipped = signature.slice(0, -1) + (last === "A" ? "B" : "A");
    expect(flipped).not.toBe(signature);
    expect(
      await verifySignUpContextToken(`${payloadPart}.${flipped}`, TEST_SECRET),
    ).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const { token } = await createSignUpContextToken(TEST_SECRET, now);
    expect(await verifySignUpContextToken(token, "another-secret")).toBeNull();
  });

  it("rejects an expired token", async () => {
    // The TTL is 5 minutes; mint far enough in the past to be expired now.
    const { token } = await createSignUpContextToken(
      TEST_SECRET,
      Date.now() - 6 * 60 * 1000,
    );
    expect(await verifySignUpContextToken(token, TEST_SECRET)).toBeNull();
  });

  it("rejects missing/undefined/empty/malformed tokens", async () => {
    const { token } = await createSignUpContextToken(TEST_SECRET, now);
    expect(await verifySignUpContextToken(null, TEST_SECRET)).toBeNull();
    expect(await verifySignUpContextToken(undefined, TEST_SECRET)).toBeNull();
    expect(await verifySignUpContextToken("", TEST_SECRET)).toBeNull();
    expect(await verifySignUpContextToken(token, undefined)).toBeNull();
    expect(await verifySignUpContextToken(token, "")).toBeNull();
    expect(await verifySignUpContextToken("no-separator", TEST_SECRET)).toBeNull();
    expect(await verifySignUpContextToken(`${token}.`, TEST_SECRET)).toBeNull();
    expect(await verifySignUpContextToken(`.${token}`, TEST_SECRET)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* createSignUpContext (public action)                                 */
/* ------------------------------------------------------------------ */

describe("createSignUpContext action", () => {
  it("mints a verifiable context", async () => {
    useSecret(TEST_SECRET);
    const t = newTest();
    const { context, expiresAt } = await t.action(
      api.authFlows.createSignUpContext,
      {},
    );

    expect(expiresAt).toBeGreaterThan(Date.now());
    const payload = await verifySignUpContextToken(context, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.nonce.length).toBeGreaterThanOrEqual(8);
  });

  it("throws the Arabic configuration error when the secret is missing", async () => {
    useSecret(undefined);
    const t = newTest();
    let caught: unknown;
    try {
      await t.action(api.authFlows.createSignUpContext, {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    expect((caught as ConvexError<string>).data).toBe(SECRET_ERROR);
  });

  it("derives a unique synthetic address per token", () => {
    expect(signUpEmail("abc")).toBe(`abc${PASSKEY_EMAIL_DOMAIN}`);
    expect(signUpEmail("abc")).not.toBe(signUpEmail("def"));
  });
});
