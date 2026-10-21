import { describe, expect, it } from "vitest";
import {
  isCancellation,
  passkeyErrorMessage,
  unexpectedErrorMessage,
} from "./passkey-errors";

describe("passkeyErrorMessage", () => {
  it("keeps cancellation and timeout as retry, never create", () => {
    for (const code of [
      "AUTH_CANCELLED",
      "ERROR_CEREMONY_ABORTED",
      "ERROR_TIMEOUT",
    ]) {
      const message = passkeyErrorMessage({ code });
      expect(message).toContain("حاول مرة أخرى");
      expect(message).not.toContain("إنشاء");
    }
  });

  it("maps the SimpleWebAuthn NotAllowedError passthrough without suggesting create", () => {
    const message = passkeyErrorMessage({
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
    });
    expect(message).toContain("حاول مرة أخرى");
    expect(message).not.toContain("حساب جديد");
  });

  it("maps CHALLENGE_NOT_FOUND to a retry", () => {
    expect(passkeyErrorMessage({ code: "CHALLENGE_NOT_FOUND" })).toContain(
      "أعد المحاولة",
    );
  });

  it("gives PASSKEY_NOT_FOUND the try-another-device copy", () => {
    const message = passkeyErrorMessage({ code: "PASSKEY_NOT_FOUND" });
    expect(message).toContain("هذا الجهاز");
    expect(message).toContain("جهازًا آخر");
  });

  it("maps RP/domain configuration failures to an origin message", () => {
    expect(passkeyErrorMessage({ code: "ERROR_INVALID_RP_ID" })).toContain(
      "نطاق مفاتيح المرور",
    );
    expect(passkeyErrorMessage({ code: "ERROR_INVALID_DOMAIN" })).toContain(
      "نطاق مفاتيح المرور",
    );
  });

  it("maps 5xx and network failures to the connection message", () => {
    expect(passkeyErrorMessage({ code: "UNKNOWN_ERROR", status: 503 })).toBe(
      "تعذّر الاتصال. تحقق من الشبكة وحاول مرة أخرى.",
    );
  });

  it("tells a previously registered credential to sign in", () => {
    const message = passkeyErrorMessage({ code: "PREVIOUSLY_REGISTERED" });
    expect(message).toContain("سجّل الدخول");
  });

  it("falls back to the generic message for unknown codes", () => {
    expect(passkeyErrorMessage({ code: "SOMETHING_NEW" })).toBe(
      "حدث خطأ غير متوقع. حاول مرة أخرى.",
    );
  });
});

describe("isCancellation", () => {
  it("recognises every cancellation-shaped code", () => {
    for (const code of [
      "AUTH_CANCELLED",
      "ERROR_CEREMONY_ABORTED",
      "ERROR_TIMEOUT",
      "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      "REGISTRATION_CANCELLED",
    ]) {
      expect(isCancellation({ code })).toBe(true);
    }
    expect(isCancellation({ code: "PASSKEY_NOT_FOUND" })).toBe(false);
    expect(isCancellation(null)).toBe(false);
  });
});

describe("unexpectedErrorMessage", () => {
  it("surfaces a ConvexError string payload", () => {
    expect(unexpectedErrorMessage({ data: "اكتب اسمًا للحساب (1–60 حرفًا)." })).toBe(
      "اكتب اسمًا للحساب (1–60 حرفًا).",
    );
  });

  it("surfaces a nested ConvexError message payload", () => {
    expect(unexpectedErrorMessage({ data: { message: "تم استخدام الطلب." } })).toBe(
      "تم استخدام الطلب.",
    );
  });

  it("maps fetch-shaped failures to the network message", () => {
    expect(unexpectedErrorMessage(new TypeError("fetch failed"))).toBe(
      "تعذّر الاتصال. تحقق من الشبكة وحاول مرة أخرى.",
    );
  });

  it("never leaks a raw internal error message", () => {
    expect(unexpectedErrorMessage(new Error("ECONNRESET at 10.0.0.1"))).not.toContain(
      "ECONNRESET",
    );
  });
});
