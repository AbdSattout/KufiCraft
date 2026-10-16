/**
 * Arabic copy for the failure modes of the passkey client plugin
 * (`@better-auth/passkey`) and the Convex sign-up action.
 * The plugin itself reports English codes/messages, so every string shown to
 * the user is mapped here instead of surfacing the raw error.
 */

import { useSyncExternalStore } from "react";

export type PasskeyClientError = {
  code?: string;
  message?: string;
  status?: number;
};

const FALLBACK_MESSAGE = "حدث خطأ غير متوقع. حاول مرة أخرى.";

export function passkeyErrorMessage(
  error: PasskeyClientError | null | undefined,
): string {
  switch (error?.code) {
    case "AUTH_CANCELLED":
    case "ERROR_CEREMONY_ABORTED":
    case "ERROR_TIMEOUT":
      return "أُلغيت العملية أو انتهت المدة. حاول مرة أخرى.";
    case "REGISTRATION_CANCELLED":
      return "أُلغي إنشاء مفتاح المرور قبل اكتماله.";
    case "PREVIOUSLY_REGISTERED":
    case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
      return "مفتاح المرور هذا مسجَّل مسبقًا على هذا الجهاز.";
    case "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT":
      return "هذا الجهاز لا يدعم مفاتيح المرور القابلة للاكتشاف. جرّب جهازًا آخر.";
    case "CHALLENGE_NOT_FOUND":
      return "انتهت صلاحية المحاولة. أعد المحاولة من جديد.";
    case "PASSKEY_NOT_FOUND":
      return "لم يُعثر على مفتاح المرور المطلوب.";
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
 * Message for anything thrown while talking to Convex. `ConvexError` payloads
 * hold the Arabic string from `convex/authFlows.ts`; plain `Error`s keep their
 * message as a last resort.
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
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
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

const subscribeToNothing = () => () => {};

/**
 * Render-time, hydration-safe `webAuthnSupported()`. The server snapshot
 * assumes support so the markup hydrates unchanged; the client corrects the
 * value right after hydration.
 */
export function usePasskeySupport(): boolean {
  return useSyncExternalStore(subscribeToNothing, webAuthnSupported, () => true);
}
