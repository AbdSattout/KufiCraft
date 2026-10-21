/**
 * The account-name contract, shared by the Convex sign-up action and the
 * client (via `src/lib/account-name.ts`).
 *
 * An account **is** its passkey, and the name entered at creation is written to
 * all three labels the product has: `user.name`, the WebAuthn user name the OS
 * sheet shows, and `passkey.name` (the header and `/account` read this one).
 * Normalizing in one place is what keeps those strings identical.
 *
 * Security-relevant characters (bidi overrides, zero-width spaces, controls)
 * are stripped. ZWNJ (`U+200C`) and ZWJ (`U+200D`) are deliberately kept:
 * they are meaningful in Persian/Arabic orthography and emoji respectively.
 */

export const MAX_ACCOUNT_NAME_LENGTH = 60;

/** Legacy fallback for passkeys created before accounts had a chosen name. */
export const DEFAULT_PASSKEY_NAME = "مفتاح المرور";

const FORBIDDEN_NAME_CHARS =
  /[\u0000-\u0008\u000E-\u001F\u007F-\u009F\u00AD\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

/**
 * Returns the name to store, or `null` when it is empty or longer than
 * {@link MAX_ACCOUNT_NAME_LENGTH} UTF-16 units after normalization.
 *
 * The length check is on UTF-16 units (JavaScript's `.length`), the same unit
 * the `<input maxLength>` and the server-side validator use.
 */
export function normalizeAccountName(raw: string): string | null {
  const name = raw
    .normalize("NFC")
    .replace(FORBIDDEN_NAME_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length === 0 || name.length > MAX_ACCOUNT_NAME_LENGTH) return null;
  return name;
}

/** True while a passkey still carries the legacy/default label. */
export function isDefaultAccountName(
  name: string | null | undefined,
): boolean {
  const trimmed = name?.trim();
  return !trimmed || trimmed === DEFAULT_PASSKEY_NAME;
}
