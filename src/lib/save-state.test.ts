import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import {
  AUTH_REQUIRED_MESSAGE,
  isTransientSaveError,
  saveStateOf,
  SAVE_OUTAGE_MS,
  SAVE_STALL_MS,
  type SaveSnapshot,
} from "./save-state";

const NOW = 1_700_000_000_000;

function snapshot(patch: Partial<SaveSnapshot> = {}): SaveSnapshot {
  return {
    pending: 0,
    since: null,
    held: 0,
    online: true,
    now: NOW,
    ...patch,
  };
}

describe("saveStateOf", () => {
  it("is saved only with an empty queue", () => {
    expect(saveStateOf(snapshot())).toBe("saved");
  });

  it("is saving while a fresh write is in flight", () => {
    expect(
      saveStateOf(snapshot({ pending: 1, since: NOW - 400 })),
    ).toBe("saving");
  });

  it("calls silence retrying once a write has waited too long", () => {
    expect(
      saveStateOf(snapshot({ pending: 1, since: NOW - SAVE_STALL_MS })),
    ).toBe("retrying");
  });

  it("calls a transiently rejected write retrying right away", () => {
    // A rejected write is already known to be unsaved: no need to wait.
    expect(
      saveStateOf(snapshot({ pending: 1, since: NOW - 100, held: 1 })),
    ).toBe("retrying");
  });

  it("is offline when the browser says so, whatever is pending", () => {
    expect(
      saveStateOf(snapshot({ pending: 1, since: NOW - 100, online: false })),
    ).toBe("offline");
  });

  it("is offline once a held write has been unsaved for long enough", () => {
    expect(
      saveStateOf(
        snapshot({ pending: 2, since: NOW - SAVE_OUTAGE_MS, held: 2 }),
      ),
    ).toBe("offline");
  });

  it("never reports saved while anything is pending", () => {
    for (const pending of [1, 2, 9]) {
      for (const held of [0, 1, pending]) {
        const state = saveStateOf(
          snapshot({
            pending,
            held,
            since: NOW - 60_000,
            online: false,
          }),
        );
        expect(state).not.toBe("saved");
      }
    }
  });

  it("treats a missing `since` as no wait at all", () => {
    expect(saveStateOf(snapshot({ pending: 1, since: null }))).toBe("saving");
    expect(saveStateOf(snapshot({ pending: 1, since: null, held: 1 }))).toBe(
      "retrying",
    );
  });
});

describe("isTransientSaveError", () => {
  it("holds the server's “sign in first” rejection — the token comes back", () => {
    expect(isTransientSaveError(new ConvexError(AUTH_REQUIRED_MESSAGE))).toBe(
      true,
    );
  });

  it("surfaces every other Convex error as the server's verdict", () => {
    expect(
      isTransientSaveError(new ConvexError("تجاوزت اللوحة الحد الأقصى للعناصر")),
    ).toBe(false);
    expect(isTransientSaveError(new ConvexError({ code: "LIMIT" }))).toBe(false);
  });

  it("recognises the network shapes that never reached the server", () => {
    const undici = new TypeError("fetch failed");
    Object.assign(undici, { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
    expect(isTransientSaveError(undici)).toBe(true);
    expect(isTransientSaveError(new TypeError("fetch failed"))).toBe(true);
    expect(
      isTransientSaveError(
        Object.assign(new Error("The operation was aborted"), {
          name: "AbortError",
        }),
      ),
    ).toBe(true);
    expect(
      isTransientSaveError(
        Object.assign(new Error("timed out"), { name: "TimeoutError" }),
      ),
    ).toBe(true);
  });

  it("is not fooled by unrelated errors or values", () => {
    expect(isTransientSaveError(new Error("boom"))).toBe(false);
    expect(isTransientSaveError(null)).toBe(false);
    expect(isTransientSaveError("fetch failed")).toBe(false);
    expect(isTransientSaveError(new ConvexError(""))).toBe(false);
  });
});
