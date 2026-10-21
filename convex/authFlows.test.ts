/// <reference types="vite/client" />

import { afterEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";
import {
  DEFAULT_PASSKEY_NAME,
  PASSKEY_EMAIL_DOMAIN,
  createSignUpContextToken,
  signUpEmail,
  verifySignUpContextToken,
} from "./authFlows";

/**
 * `convex/authFlows.ts` is the public, session-less entry point of sign-up:
 * `createSignUpContext({ name })` mints an HMAC-signed token carrying the
 * normalized account name, and the passkey plugin's `resolveUser`
 * (convex/auth.ts) verifies it before the account row is created. The name is
 * signed **into** the token on purpose: it is the one copy that names the user
 * row, the WebAuthn user and the passkey row.
 *
 * The modules map is scoped to the things this suite needs, exactly like
 * `projects.test.ts` (which deliberately excludes the auth module graph).
 */
const modules = import.meta.glob([
  "./authFlows.ts",
  "./lib/account-name.ts",
  "./_generated/*.js",
]);

const newTest = () => convexTest(undefined, modules);

const TEST_SECRET = "test-secret-for-auth-flows";

/** Arabic user-facing message specified by docs/AUTH.md. */
const SECRET_ERROR = "خدمة إنشاء الحساب غير مهيأة حاليًا";
const INVALID_NAME_ERROR = "اكتب اسمًا للحساب (1–60 حرفًا).";

const originalSecret = process.env.BETTER_AUTH_SECRET;
function useSecret(secret: string | undefined): void {
  if (secret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = secret;
}
afterEach(() => useSecret(originalSecret));

/* ------------------------------------------------------------------ */
/* test-only signer: lets us mint payloads the production function     */
/* would never mint (legacy/no-name, invalid shape).                   */
/* ------------------------------------------------------------------ */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signRawPayload(
  secret: string,
  payload: unknown,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payloadPart = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadPart),
  );
  return `${payloadPart}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/* ------------------------------------------------------------------ */
/* token contract                                                      */
/* ------------------------------------------------------------------ */

describe("sign-up context token", () => {
  const now = Date.now();

  it("round-trips name, nonce and expiry", async () => {
    const { token, expiresAt } = await createSignUpContextToken(
      TEST_SECRET,
      now,
      "عبد",
    );
    expect(expiresAt).toBeGreaterThan(now);
    const payload = await verifySignUpContextToken(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.name).toBe("عبد");
    expect(payload?.expiresAt).toBe(expiresAt);
    expect(payload?.nonce.length).toBeGreaterThanOrEqual(8);
  });

  it("signs the normalized name, not the raw input", async () => {
    const { token } = await createSignUpContextToken(
      TEST_SECRET,
      now,
      "  عبد\u200F   الله  ",
    );
    const payload = await verifySignUpContextToken(token, TEST_SECRET);
    expect(payload?.name).toBe("عبد الله");
  });

  it("refuses to mint a token for an empty or over-long name", async () => {
    await expect(
      createSignUpContextToken(TEST_SECRET, now, "   "),
    ).rejects.toThrow();
    await expect(
      createSignUpContextToken(TEST_SECRET, now, "a".repeat(61)),
    ).rejects.toThrow();
  });

  it("gives every token a fresh nonce", async () => {
    const first = await createSignUpContextToken(TEST_SECRET, now, "عبد");
    const second = await createSignUpContextToken(TEST_SECRET, now, "عبد");
    expect(first.token).not.toBe(second.token);
  });

  it("accepts a legacy token with no name and falls back to the default", async () => {
    const legacy = await signRawPayload(TEST_SECRET, {
      expiresAt: now + 60_000,
      nonce: "0123456789abcdef",
    });
    const payload = await verifySignUpContextToken(legacy, TEST_SECRET);
    expect(payload?.name).toBe(DEFAULT_PASSKEY_NAME);
  });

  it("rejects a signed token that carries an invalid name", async () => {
    for (const name of ["", "   ", "\u200B\u200F", "a".repeat(61), 42]) {
      const token = await signRawPayload(TEST_SECRET, {
        expiresAt: now + 60_000,
        nonce: "0123456789abcdef",
        name,
      });
      expect(await verifySignUpContextToken(token, TEST_SECRET)).toBeNull();
    }
  });

  it("normalizes a signed-in name before returning it", async () => {
    const token = await signRawPayload(TEST_SECRET, {
      expiresAt: now + 60_000,
      nonce: "0123456789abcdef",
      name: "  سارة\u200E  ",
    });
    const payload = await verifySignUpContextToken(token, TEST_SECRET);
    expect(payload?.name).toBe("سارة");
  });

  it("rejects a tampered payload", async () => {
    const { token } = await createSignUpContextToken(TEST_SECRET, now, "عبد");
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
    const { token } = await createSignUpContextToken(TEST_SECRET, now, "عبد");
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
    const { token } = await createSignUpContextToken(TEST_SECRET, now, "عبد");
    expect(await verifySignUpContextToken(token, "another-secret")).toBeNull();
  });

  it("rejects an expired token", async () => {
    // The TTL is 5 minutes; mint far enough in the past to be expired now.
    const { token } = await createSignUpContextToken(
      TEST_SECRET,
      Date.now() - 6 * 60 * 1000,
      "عبد",
    );
    expect(await verifySignUpContextToken(token, TEST_SECRET)).toBeNull();
  });

  it("rejects missing/undefined/empty/malformed tokens", async () => {
    const { token } = await createSignUpContextToken(TEST_SECRET, now, "عبد");
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
  it("mints a verifiable context carrying the normalized name", async () => {
    useSecret(TEST_SECRET);
    const t = newTest();
    const { context, expiresAt } = await t.action(
      api.authFlows.createSignUpContext,
      { name: "  عبد\u200F  " },
    );

    expect(expiresAt).toBeGreaterThan(Date.now());
    const payload = await verifySignUpContextToken(context, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.name).toBe("عبد");
    expect(payload?.nonce.length).toBeGreaterThanOrEqual(8);
  });

  it("rejects an empty name with the Arabic validation error", async () => {
    useSecret(TEST_SECRET);
    const t = newTest();
    let caught: unknown;
    try {
      await t.action(api.authFlows.createSignUpContext, { name: "   " });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    expect((caught as ConvexError<string>).data).toBe(INVALID_NAME_ERROR);
  });

  it("rejects an over-60 name with the Arabic validation error", async () => {
    useSecret(TEST_SECRET);
    const t = newTest();
    let caught: unknown;
    try {
      await t.action(api.authFlows.createSignUpContext, {
        name: "a".repeat(61),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    expect((caught as ConvexError<string>).data).toBe(INVALID_NAME_ERROR);
  });

  it("throws the Arabic configuration error when the secret is missing", async () => {
    useSecret(undefined);
    const t = newTest();
    let caught: unknown;
    try {
      await t.action(api.authFlows.createSignUpContext, { name: "عبد" });
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
