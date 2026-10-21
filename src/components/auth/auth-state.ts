/**
 * Pure decisions for the one-field auth dialog.
 *
 * The field doubles as the WebAuthn username field and as the new-account
 * name, so the same input can submit two different intents:
 *
 * * **empty** (or whitespace only) → sign in: `get()`, with the browser's
 *   saved-passkey suggestions already offered by conditional UI;
 * * **a typed name** → create: `create()`, with that normalized name.
 *
 * Nothing is inferred from a failed ceremony: a cancelled or empty sign-in
 * never turns into an account creation by itself. The visitor changes intent
 * by typing (or clearing) the field, not by failing.
 */

import { normalizeAccountName } from "@/lib/account-name";

export type AuthState = {
  busy: boolean;
  error: string | null;
};

export type AuthEvent =
  | { type: "START" }
  | { type: "FAIL"; message: string }
  | { type: "SUCCESS" }
  | { type: "RESET" };

export const initialAuthState: AuthState = {
  busy: false,
  error: null,
};

export function authReducer(state: AuthState, event: AuthEvent): AuthState {
  switch (event.type) {
    case "START":
      return { busy: true, error: null };
    case "FAIL":
      return { busy: false, error: event.message };
    case "SUCCESS":
      return { busy: false, error: null };
    case "RESET":
      return initialAuthState;
  }
}

export type AuthSubmitPlan =
  | { action: "sign-in" }
  | { action: "create"; name: string }
  | { action: "invalid-name" };

/**
 * Decides what the one button does from what is in the field.
 *
 * A value that is not empty but normalizes away (zero-width/bidi/control
 * characters only, or longer than the limit) is rejected instead of silently
 * becoming a sign-in — the visitor clearly meant to name an account.
 */
export function planAuthSubmit(rawValue: string): AuthSubmitPlan {
  if (rawValue.trim() === "") return { action: "sign-in" };
  const name = normalizeAccountName(rawValue);
  if (name === null) return { action: "invalid-name" };
  return { action: "create", name };
}
