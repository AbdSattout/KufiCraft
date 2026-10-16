import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";

/**
 * Passkey-first sign-up plumbing (see docs/AUTH.md).
 *
 * `/signup` is public: a visitor types a display name, the client asks
 * `createSignUpContext` for a short-lived signed context token, and hands that
 * token to `authClient.passkey.addPasskey({ context })`. The passkey plugin's
 * `resolveUser` hook (convex/auth.ts) verifies the token and creates the
 * account — no email, password or prior session is involved.
 *
 * The token is an HMAC-SHA256 signature over a JSON payload, keyed with the
 * deployment's `BETTER_AUTH_SECRET`. It only proves "this client asked to
 * create an account with this name a moment ago"; it is consumed by
 * `resolveUser` at the start of the WebAuthn ceremony and expires quickly.
 */

/** How long a client may take between requesting the token and starting registration. */
const CONTEXT_TOKEN_TTL_MS = 5 * 60 * 1000;

/** Matches MAX_DISPLAY_NAME_LENGTH on the client form. */
export const MAX_DISPLAY_NAME_LENGTH = 60;

type SignUpContextPayload = {
  name: string;
  expiresAt: number;
  nonce: string;
};

/** Collapses whitespace and enforces the length bound; null when unusable. */
export function normalizeDisplayName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > MAX_DISPLAY_NAME_LENGTH) return null;
  return name;
}

/**
 * Internal login-less address for the created account. Better Auth requires a
 * unique `email` on `user`; nothing else in the app reads or shows it.
 */
export function signUpEmail(nonce: string): string {
  return `${nonce}@passkey.local`;
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
  name: string,
  secret: string,
  now: number,
): Promise<{ token: string; expiresAt: number }> {
  const payload: SignUpContextPayload = {
    name,
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
  const name = typeof record.name === "string" ? normalizeDisplayName(record.name) : null;
  const expiresAt = typeof record.expiresAt === "number" ? record.expiresAt : null;
  const nonce =
    typeof record.nonce === "string" && record.nonce.length >= 8 ? record.nonce : null;
  if (!name || expiresAt === null || !nonce) return null;
  if (expiresAt < Date.now()) return null;
  return { name, expiresAt, nonce };
}

/**
 * Public entry point for `/signup`: mints a context token for the pending
 * display name. Anonymous on purpose — the whole flow is session-less.
 */
export const createSignUpContext = action({
  args: { name: v.string() },
  returns: v.object({ context: v.string(), expiresAt: v.number() }),
  handler: async (_ctx, args) => {
    const name = normalizeDisplayName(args.name);
    if (!name) {
      throw new ConvexError(
        `اكتب اسمًا من 1 إلى ${MAX_DISPLAY_NAME_LENGTH} حرفًا`,
      );
    }
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      throw new ConvexError("خدمة إنشاء الحساب غير مهيأة حاليًا");
    }
    const { token, expiresAt } = await createSignUpContextToken(
      name,
      secret,
      Date.now(),
    );
    return { context: token, expiresAt };
  },
});
