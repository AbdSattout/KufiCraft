/// <reference types="vite/client" />

import { afterEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";
import {
  MAX_DISPLAY_NAME_LENGTH,
  PASSKEY_EMAIL_DOMAIN,
  createSignUpContextToken,
  normalizeDisplayName,
  signUpEmail,
  verifySignUpContextToken,
} from "./authFlows";

/**
 * `convex/authFlows.ts` is the public, session-less entry point of sign-up:
 * `createSignUpContext` mints an HMAC-signed token, the passkey plugin's
 * `resolveUser` (convex/auth.ts) verifies it, and the display name in that
 * token becomes the account name. This suite covers the token contract, the
 * action's Arabic errors, and the display-name sanitiser.
 *
 * The modules map is scoped to the two things this suite needs, exactly like
 * `projects.test.ts` (which deliberately excludes the auth module graph).
 */
const modules = import.meta.glob(["./authFlows.ts", "./_generated/*.js"]);

const newTest = () => convexTest(undefined, modules);

const TEST_SECRET = "test-secret-for-auth-flows";

/** Arabic user-facing messages specified by docs/AUTH.md. */
const NAME_ERROR = `اكتب اسمًا من 1 إلى ${MAX_DISPLAY_NAME_LENGTH} حرفًا`;
const SECRET_ERROR = "خدمة إنشاء الحساب غير مهيأة حاليًا";

/** The bidi override that can make a name render reversed. */
const RLO = "\u202E";
/** A zero-width space: invisible, so two different names can look identical. */
const ZWSP = "\u200B";
/** A C0 control code. */
const BELL = "\u0007";

const originalSecret = process.env.BETTER_AUTH_SECRET;
function useSecret(secret: string | undefined): void {
  if (secret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = secret;
}
afterEach(() => useSecret(originalSecret));

/* ------------------------------------------------------------------ */
/* normalizeDisplayName (MINOR-1)                                      */
/* ------------------------------------------------------------------ */

describe("normalizeDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeDisplayName("  ليان   الكوفي \n المربع ")).toBe(
      "ليان الكوفي المربع",
    );
  });

  it("normalises to NFC", () => {
    // "أ" precomposed vs. alef + hamza above.
    expect(normalizeDisplayName("ا\u0654حمد")).toBe(normalizeDisplayName("أحمد"));
    expect(normalizeDisplayName("ا\u0654حمد")).toBe("أحمد");
  });

  it("strips bidi/zero-width/control characters", () => {
    // Reproduced before the fix: the RLO sequence survived and rendered the
    // stored name reversed.
    expect(normalizeDisplayName(`عبد${RLO}الله`)).toBe("عبدالله");
    expect(normalizeDisplayName(`م${ZWSP}ستخدم`)).toBe("مستخدم");
    expect(normalizeDisplayName(`ا${BELL}حمد`)).toBe("احمد");
    // Bidi isolates U+2066–U+2069, embeddings U+202A–U+202E, marks U+200E/200F.
    expect(normalizeDisplayName("a\u2066b\u2069c")).toBe("abc");
    expect(normalizeDisplayName("a\u202Ab\u202Ec")).toBe("abc");
    expect(normalizeDisplayName("a\u200Eb\u200Fc")).toBe("abc");
    // C1 control (U+0085 NEL): stripped, not collapsed.
    expect(normalizeDisplayName("a\u0085b")).toBe("ab");
    // C0 whitespace controls (\t) collapse to a single space, so words stay
    // separated.
    expect(normalizeDisplayName("a\tb")).toBe("a b");
    expect(normalizeDisplayName("ليان\n\nالكوفي")).toBe("ليان الكوفي");
  });

  it("rejects a name that is only format characters", () => {
    expect(normalizeDisplayName(RLO + ZWSP)).toBeNull();
    expect(normalizeDisplayName("")).toBeNull();
    expect(normalizeDisplayName("   ")).toBeNull();
  });

  it("keeps the length cap after stripping", () => {
    const exact = "ا".repeat(MAX_DISPLAY_NAME_LENGTH);
    expect(normalizeDisplayName(exact)).toBe(exact);
    expect(normalizeDisplayName("ا".repeat(MAX_DISPLAY_NAME_LENGTH + 1))).toBeNull();
    // Filler format characters must not be able to smuggle a name past the cap.
    expect(
      normalizeDisplayName(
        "ا".repeat(MAX_DISPLAY_NAME_LENGTH + 5) + ZWSP.repeat(50),
      ),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* token contract                                                      */
/* ------------------------------------------------------------------ */

describe("sign-up context token", () => {
  const now = Date.now();

  it("round-trips name, nonce and expiry", async () => {
    const { token, expiresAt } = await createSignUpContextToken(
      `ليان${RLO}`,
      TEST_SECRET,
      now,
    );
    expect(expiresAt).toBeGreaterThan(now);
    const payload = await verifySignUpContextToken(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.name).toBe("ليان");
    expect(payload?.expiresAt).toBe(expiresAt);
    expect(payload?.nonce.length).toBeGreaterThanOrEqual(8);
  });

  it("gives every token a fresh nonce", async () => {
    const first = await createSignUpContextToken("ليان", TEST_SECRET, now);
    const second = await createSignUpContextToken("ليان", TEST_SECRET, now);
    expect(first.token).not.toBe(second.token);
  });

  it("rejects a tampered payload", async () => {
    const { token } = await createSignUpContextToken("ليان", TEST_SECRET, now);
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
    const { token } = await createSignUpContextToken("ليان", TEST_SECRET, now);
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
    const { token } = await createSignUpContextToken("ليان", TEST_SECRET, now);
    expect(await verifySignUpContextToken(token, "another-secret")).toBeNull();
  });

  it("rejects an expired token", async () => {
    // The TTL is 5 minutes; mint far enough in the past to be expired now.
    const { token } = await createSignUpContextToken(
      "ليان",
      TEST_SECRET,
      Date.now() - 6 * 60 * 1000,
    );
    expect(await verifySignUpContextToken(token, TEST_SECRET)).toBeNull();
  });

  it("rejects missing/undefined/empty/malformed tokens", async () => {
    const { token } = await createSignUpContextToken("ليان", TEST_SECRET, now);
    expect(await verifySignUpContextToken(null, TEST_SECRET)).toBeNull();
    expect(await verifySignUpContextToken(undefined, TEST_SECRET)).toBeNull();
    expect(await verifySignUpContextToken("", TEST_SECRET)).toBeNull();
    expect(await verifySignUpContextToken(token, undefined)).toBeNull();
    expect(await verifySignUpContextToken(token, "")).toBeNull();
    expect(await verifySignUpContextToken("no-separator", TEST_SECRET)).toBeNull();
    expect(await verifySignUpContextToken(`${token}.`, TEST_SECRET)).toBeNull();
    expect(await verifySignUpContextToken(`.${token}`, TEST_SECRET)).toBeNull();
  });

  it("rejects a signed payload whose name is invalid", async () => {
    // `createSignUpContextToken` does not sanitise; verification must.
    const oversized = await createSignUpContextToken(
      "ا".repeat(MAX_DISPLAY_NAME_LENGTH + 1),
      TEST_SECRET,
      now,
    );
    expect(
      await verifySignUpContextToken(oversized.token, TEST_SECRET),
    ).toBeNull();
    const onlyFormat = await createSignUpContextToken(RLO + ZWSP, TEST_SECRET, now);
    expect(
      await verifySignUpContextToken(onlyFormat.token, TEST_SECRET),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* createSignUpContext (public action)                                 */
/* ------------------------------------------------------------------ */

describe("createSignUpContext action", () => {
  it("mints a verifiable context for a valid name", async () => {
    useSecret(TEST_SECRET);
    const t = newTest();
    const { context, expiresAt } = await t.action(
      api.authFlows.createSignUpContext,
      { name: `  ليان${RLO}   الكوفي ` },
    );

    expect(expiresAt).toBeGreaterThan(Date.now());
    const payload = await verifySignUpContextToken(context, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.name).toBe("ليان الكوفي");
    expect(payload?.nonce.length).toBeGreaterThanOrEqual(8);
  });

  it("throws the Arabic name error for an unusable name", async () => {
    useSecret(TEST_SECRET);
    const t = newTest();
    for (const name of ["", "   ", RLO + ZWSP, "ا".repeat(MAX_DISPLAY_NAME_LENGTH + 1)]) {
      await expect(
        t.action(api.authFlows.createSignUpContext, { name }),
      ).rejects.toMatchObject({
        data: NAME_ERROR,
      });
    }
  });

  it("throws the Arabic configuration error when the secret is missing", async () => {
    useSecret(undefined);
    const t = newTest();
    let caught: unknown;
    try {
      await t.action(api.authFlows.createSignUpContext, { name: "ليان" });
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
