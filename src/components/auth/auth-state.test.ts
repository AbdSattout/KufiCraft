import { describe, expect, it } from "vitest";
import {
  authReducer,
  initialAuthState,
  planAuthSubmit,
  type AuthState,
} from "./auth-state";

describe("authReducer", () => {
  it("starts idle with no error", () => {
    expect(initialAuthState).toEqual({ busy: false, error: null });
  });

  it("clears the error when an attempt starts", () => {
    const failed = authReducer(initialAuthState, {
      type: "FAIL",
      message: "فشل",
    });
    expect(authReducer(failed, { type: "START" })).toEqual({
      busy: true,
      error: null,
    });
  });

  it("keeps the failure message and stops being busy", () => {
    const next = authReducer(
      authReducer(initialAuthState, { type: "START" }),
      { type: "FAIL", message: "أُلغيت العملية أو انتهت المدة. حاول مرة أخرى." },
    );
    expect(next.busy).toBe(false);
    expect(next.error).toContain("حاول مرة أخرى");
  });

  it("drops the error on success", () => {
    const failed: AuthState = { busy: false, error: "فشل" };
    expect(authReducer(failed, { type: "SUCCESS" })).toEqual({
      busy: false,
      error: null,
    });
  });

  it("RESET returns to the initial state", () => {
    const dirty: AuthState = { busy: true, error: "فشل" };
    expect(authReducer(dirty, { type: "RESET" })).toEqual(initialAuthState);
  });
});

describe("planAuthSubmit", () => {
  it("signs in when the field is empty", () => {
    expect(planAuthSubmit("")).toEqual({ action: "sign-in" });
  });

  it("signs in when the field is only whitespace", () => {
    expect(planAuthSubmit("   \u00a0 ")).toEqual({ action: "sign-in" });
  });

  it("creates with the normalized name when one is typed", () => {
    expect(planAuthSubmit("  محمد   علي  ")).toEqual({
      action: "create",
      name: "محمد علي",
    });
  });

  it("normalizes compatibility forms (NFC)", () => {
    // "أ" as alef + hamza above, decomposed.
    const plan = planAuthSubmit("\u0627\u0654سامة");
    expect(plan).toEqual({ action: "create", name: "أسامة" });
  });

  it("keeps ZWNJ, which is meaningful in Arabic/Persian", () => {
    expect(planAuthSubmit("می\u200cرزا")).toEqual({
      action: "create",
      name: "می\u200cرزا",
    });
  });

  it("rejects a non-empty value that normalizes away", () => {
    expect(planAuthSubmit("\u200b\u200e")).toEqual({ action: "invalid-name" });
  });

  it("accepts exactly the limit and rejects one over it", () => {
    const atLimit = "ا".repeat(60);
    expect(planAuthSubmit(atLimit)).toEqual({ action: "create", name: atLimit });
    expect(planAuthSubmit("ا".repeat(61))).toEqual({ action: "invalid-name" });
  });
});
