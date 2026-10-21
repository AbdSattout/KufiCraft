import { describe, expect, it } from "vitest";
import {
  DEFAULT_PASSKEY_NAME,
  MAX_ACCOUNT_NAME_LENGTH,
  isDefaultAccountName,
  normalizeAccountName,
} from "./account-name";

describe("normalizeAccountName", () => {
  it("normalizes to Unicode NFC", () => {
    expect(normalizeAccountName("A\u030A")).toBe("Å");
  });

  it("strips control characters and bidi/zero-width marks", () => {
    expect(normalizeAccountName("ع\u200Fبد")).toBe("عبد");
    expect(normalizeAccountName("a\u0000b\u0007c")).toBe("abc");
    expect(normalizeAccountName("a\u00ADb")).toBe("ab");
    expect(normalizeAccountName("a\u2066b\u2069c")).toBe("abc");
    expect(normalizeAccountName("\uFEFFعبد\u200B")).toBe("عبد");
  });

  it("preserves ZWNJ and ZWJ", () => {
    expect(normalizeAccountName("می\u200Cخواهم")).toBe("می\u200Cخواهم");
    expect(normalizeAccountName("👨\u200D👩")).toBe("👨\u200D👩");
  });

  it("collapses whitespace and trims", () => {
    expect(normalizeAccountName("  عبد \t\n  الله  ")).toBe("عبد الله");
  });

  it("rejects empty and whitespace-only names", () => {
    expect(normalizeAccountName("")).toBeNull();
    expect(normalizeAccountName("   \t\n")).toBeNull();
    expect(normalizeAccountName("\u200B\u200F")).toBeNull();
  });

  it("accepts exactly the maximum length and rejects one unit more", () => {
    expect(normalizeAccountName("a".repeat(MAX_ACCOUNT_NAME_LENGTH))).toHaveLength(
      MAX_ACCOUNT_NAME_LENGTH,
    );
    expect(
      normalizeAccountName("a".repeat(MAX_ACCOUNT_NAME_LENGTH + 1)),
    ).toBeNull();
  });

  it("counts normalized length, not raw length", () => {
    const padded = `  ${"a".repeat(MAX_ACCOUNT_NAME_LENGTH)}  `;
    expect(normalizeAccountName(padded)).toBe("a".repeat(MAX_ACCOUNT_NAME_LENGTH));
  });

  it("keeps Arabic, English and emoji names", () => {
    expect(normalizeAccountName("عبد")).toBe("عبد");
    expect(normalizeAccountName("Abd")).toBe("Abd");
    expect(normalizeAccountName("🕌")).toBe("🕌");
  });
});

describe("isDefaultAccountName", () => {
  it("treats missing, empty and the legacy label as default", () => {
    expect(isDefaultAccountName(null)).toBe(true);
    expect(isDefaultAccountName(undefined)).toBe(true);
    expect(isDefaultAccountName("")).toBe(true);
    expect(isDefaultAccountName("  ")).toBe(true);
    expect(isDefaultAccountName(DEFAULT_PASSKEY_NAME)).toBe(true);
    expect(isDefaultAccountName(` ${DEFAULT_PASSKEY_NAME} `)).toBe(true);
  });

  it("treats a chosen name as non-default", () => {
    expect(isDefaultAccountName("عبد")).toBe(false);
  });
});
