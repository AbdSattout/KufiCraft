/**
 * Arabic copy for the failure modes of the passkey client plugin
 * (`@better-auth/passkey`) and the Convex sign-up action.
 * The plugin itself reports English codes/messages, so every string shown to
 * the user is mapped here instead of surfacing the raw error.
 *
 * The rule this module exists to enforce: **no failure ever means “you have no
 * account”**. WebAuthn cannot tell “no credential on this device” from
 * “cancelled”, so a cancelled or transient ceremony must produce a retry
 * message, never a suggestion to create a duplicate account.
 */

import { useSyncExternalStore } from "react";

export type PasskeyClientError = {
  code?: string;
  message?: string;
  status?: number;
};

const FALLBACK_MESSAGE = "حدث خطأ غير متوقع. حاول مرة أخرى.";
const CANCELLED_MESSAGE = "أُلغيت العملية أو انتهت المدة. حاول مرة أخرى.";
const NETWORK_MESSAGE = "تعذّر الاتصال. تحقق من الشبكة وحاول مرة أخرى.";
const ORIGIN_MESSAGE =
  "هذا العنوان لا يطابق نطاق مفاتيح المرور. افتح الموقع من عنوانه الرسمي.";

/** A cancelled, timed-out or user-dismissed ceremony — never “no account”. */
export function isCancellation(
  error: PasskeyClientError | null | undefined,
): boolean {
  switch (error?.code) {
    case "AUTH_CANCELLED":
    case "ERROR_CEREMONY_ABORTED":
    case "ERROR_TIMEOUT":
    case "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY":
    case "REGISTRATION_CANCELLED":
      return true;
    default:
      return false;
  }
}

export function passkeyErrorMessage(
  error: PasskeyClientError | null | undefined,
): string {
  // A 5xx through the auth proxy is the flaky link, not the user's key.
  if (typeof error?.status === "number" && error.status >= 500) {
    return NETWORK_MESSAGE;
  }
  switch (error?.code) {
    case "AUTH_CANCELLED":
    case "ERROR_CEREMONY_ABORTED":
    case "ERROR_TIMEOUT":
      return CANCELLED_MESSAGE;
    case "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY":
      // SimpleWebAuthn maps NotAllowedError here. It covers “the user closed
      // the sheet” as well as “no credential”, so the copy stays neutral and
      // never points at account creation.
      return "لم يتم اختيار مفتاح مرور. حاول مرة أخرى.";
    case "REGISTRATION_CANCELLED":
      return "أُلغي إنشاء مفتاح المرور قبل اكتماله. حاول مرة أخرى.";
    case "PREVIOUSLY_REGISTERED":
    case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
      return "هذا المفتاح مسجَّل مسبقًا. سجّل الدخول بدلًا من إنشاء حساب جديد.";
    case "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT":
      return "هذا الجهاز لا يدعم مفاتيح المرور القابلة للاكتشاف. جرّب جهازًا آخر.";
    case "CHALLENGE_NOT_FOUND":
      return "انتهت صلاحية المحاولة. أعد المحاولة من جديد.";
    case "PASSKEY_NOT_FOUND":
      return "لم يُعثر على مفتاح مرور لهذا الموقع على هذا الجهاز. جرّب جهازًا آخر.";
    case "ERROR_INVALID_RP_ID":
    case "ERROR_INVALID_DOMAIN":
      return ORIGIN_MESSAGE;
    case "AUTHENTICATION_FAILED":
      return "تعذّر التحقق من مفتاح المرور. حاول مرة أخرى.";
    case "FAILED_TO_VERIFY_REGISTRATION":
    case "FAILED_TO_UPDATE_PASSKEY":
    case "UNKNOWN_ERROR":
      return FALLBACK_MESSAGE;
    case "SESSION_REQUIRED":
      return "يجب تسجيل الدخول أولًا.";
    case "RESOLVED_USER_INVALID":
    default:
      return FALLBACK_MESSAGE;
  }
}

/**
 * Message for anything thrown while talking to Convex. A `ConvexError` payload
 * holds the Arabic string from `convex/authFlows.ts`; every other failure
 * degrades to the Arabic fallback. Raw `Error#message` values are
 * English/internal and must never reach a toast.
 */
export function unexpectedErrorMessage(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "data" in cause) {
    const data = (cause as { data: unknown }).data;
    if (typeof data === "string" && data.trim().length > 0) return data.trim();
    if (
      typeof data === "object" &&
      data !== null &&
      "message" in data &&
      typeof data.message === "string" &&
      data.message.trim().length > 0
    ) {
      return data.message.trim();
    }
  }
  const message =
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
      ? cause.message
      : "";
  if (/\b(fetch|network|load failed|failed to fetch)\b/i.test(message)) {
    return NETWORK_MESSAGE;
  }
  return FALLBACK_MESSAGE;
}

/** WebAuthn needs a secure context and a supporting browser. */
export function webAuthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined"
  );
}

/**
 * True when the browser can offer saved passkeys in its autofill UI
 * (conditional mediation). This is a progressive enhancement; the visible
 * button is the fallback everywhere else.
 */
export async function conditionalUiSupported(): Promise<boolean> {
  if (!webAuthnSupported()) return false;
  const publicKeyCredential = window.PublicKeyCredential as
    | (typeof PublicKeyCredential & {
        isConditionalMediationAvailable?: () => Promise<boolean>;
      })
    | undefined;
  if (typeof publicKeyCredential?.isConditionalMediationAvailable !== "function") {
    return false;
  }
  try {
    return await publicKeyCredential.isConditionalMediationAvailable();
  } catch {
    return false;
  }
}

const subscribeToNothing = () => () => {};

/**
 * Render-time, hydration-safe `webAuthnSupported()`. The server snapshot
 * assumes support so the markup hydrates unchanged; the client corrects the
 * value right after hydration.
 */
export function usePasskeySupport(): boolean {
  return useSyncExternalStore(subscribeToNothing, webAuthnSupported, () => true);
}
