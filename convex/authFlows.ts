import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import {
  DEFAULT_PASSKEY_NAME,
  normalizeAccountName,
} from "./lib/accountName";

/**
 * Passkey-first sign-up plumbing (see docs/AUTH.md).
 *
 * The auth card is public: the client asks `createSignUpContext({ name })` for
 * a short-lived signed context token, then hands that token to
 * `authClient.passkey.addPasskey({ context })`. The passkey plugin's
 * `resolveUser` hook (convex/auth.ts) verifies the token and creates the
 * account — no email, password or prior session is involved. The name the user
 * typed is signed into that token, so the user row, the WebAuthn user and the
 * passkey row all carry the same string.
 *
 * An account **is** its passkey: exactly one, never added to or deleted, and
 * the name people see is that passkey's name (docs/AUTH.md § Accounts). The
 * token is an HMAC-SHA256 signature over a JSON payload, keyed with the
 * deployment's `BETTER_AUTH_SECRET`; it proves nothing except "this client
 * asked for an account with this name a moment ago", which is all a first
 * passkey needs.
 */

/** How long a client may take between requesting the token and starting registration. */
const CONTEXT_TOKEN_TTL_MS = 5 * 60 * 1000;

type SignUpContextPayload = {
  /** Normalized account/passkey name chosen by the user. */
  name: string;
  expiresAt: number;
  nonce: string;
};

/** Synthetic email domain for login-less accounts — never shown or sent to. */
export const PASSKEY_EMAIL_DOMAIN = "@passkey.local";

/**
 * Name of the passkey a legacy account was created with, before the sign-up
 * card asked for a name. Kept only as a fallback for old tokens and old rows;
 * new accounts use the normalized name the user typed.
 *
 * Re-exported here because this module owned the constant before the shared
 * account-name contract existed.
 */
export { DEFAULT_PASSKEY_NAME } from "./lib/accountName";

/**
 * Internal login-less address for the created account. Better Auth requires a
 * unique `email` on `user`; nothing else in the app reads or shows it.
 */
export function signUpEmail(nonce: string): string {
  return `${nonce}${PASSKEY_EMAIL_DOMAIN}`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let value = "";
  for (let index = 0; index < bytes.length; index += 1) {
    value += bytes[index].toString(16).padStart(2, "0");
  }
  return value;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signValue(key: CryptoKey, value: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

function signaturesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

/** Mints the signed token handed to `authClient.passkey.addPasskey`. */
export async function createSignUpContextToken(
  secret: string,
  now: number,
  name: string,
): Promise<{ token: string; expiresAt: number }> {
  const normalizedName = normalizeAccountName(name);
  if (!normalizedName) {
    throw new Error("Account name is empty or too long");
  }
  const payload: SignUpContextPayload = {
    name: normalizedName,
    expiresAt: now + CONTEXT_TOKEN_TTL_MS,
    nonce: randomHex(16),
  };
  const key = await importHmacKey(secret);
  const payloadPart = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await signValue(key, payloadPart);
  return { token: `${payloadPart}.${signature}`, expiresAt: payload.expiresAt };
}

/**
 * Verifies signature, shape and expiry. Returns null for anything invalid so
 * callers can decide how to surface the failure.
 */
export async function verifySignUpContextToken(
  token: string | null | undefined,
  secret: string | undefined,
): Promise<SignUpContextPayload | null> {
  if (!token || !secret) return null;
  let key: CryptoKey;
  try {
    key = await importHmacKey(secret);
  } catch {
    return null;
  }
  const separatorIndex = token.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) return null;
  const payloadPart = token.slice(0, separatorIndex);
  const signaturePart = token.slice(separatorIndex + 1);
  const expectedSignature = await signValue(key, payloadPart);
  if (!signaturesMatch(expectedSignature, signaturePart)) return null;

  const payloadBytes = base64UrlToBytes(payloadPart);
  if (!payloadBytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const expiresAt = typeof record.expiresAt === "number" ? record.expiresAt : null;
  const nonce =
    typeof record.nonce === "string" && record.nonce.length >= 8 ? record.nonce : null;
  if (expiresAt === null || !nonce) return null;
  if (expiresAt < Date.now()) return null;

  /**
   * Tokens minted before the name field existed are still valid for their
   * five-minute TTL; they fall back to the legacy label. A token that carries
   * a name must carry a *valid, normalized* one — a tampered or malformed name
   * is rejected rather than silently replaced.
   */
  let name = DEFAULT_PASSKEY_NAME;
  if (record.name !== undefined) {
    if (typeof record.name !== "string") return null;
    const normalized = normalizeAccountName(record.name);
    if (!normalized) return null;
    name = normalized;
  }

  return { name, expiresAt, nonce };
}

/**
 * Public entry point for account creation: mints a context token that lets a
 * session-less client start one passkey registration. Anonymous on purpose —
 * the whole flow is session-less. The name is normalized here, once, and is
 * the only copy that reaches the token (and therefore `resolveUser`); the
 * client does not send it again to `addPasskey`.
 */
export const createSignUpContext = action({
  args: { name: v.string() },
  returns: v.object({ context: v.string(), expiresAt: v.number() }),
  handler: async (_ctx, { name }) => {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      throw new ConvexError("خدمة إنشاء الحساب غير مهيأة حاليًا");
    }
    const normalized = normalizeAccountName(name);
    if (!normalized) {
      throw new ConvexError("اكتب اسمًا للحساب (1–60 حرفًا).");
    }
    const { token, expiresAt } = await createSignUpContextToken(
      secret,
      Date.now(),
      normalized,
    );
    return { context: token, expiresAt };
  },
});
