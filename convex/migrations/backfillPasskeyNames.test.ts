import { describe, expect, it } from "vitest";
import { DEFAULT_PASSKEY_NAME } from "../lib/accountName";
import {
  planPasskeyNameBackfill,
  type PasskeyNameRow,
  type UserNameRow,
} from "./backfillPasskeyNames";

/**
 * The planner is the whole safety story of the migration: it decides which
 * passkey rows may inherit their owner's typed name. The wrapper action is a
 * thin dry-run gate around it, so these are the tests that matter.
 */

const passkey = (
  id: string,
  userId: string,
  name?: string | null,
): PasskeyNameRow => ({ id, userId, name });

const user = (id: string, name?: string | null): UserNameRow => ({ id, name });

describe("planPasskeyNameBackfill", () => {
  it("backfills a legacy/default passkey from its owner's typed name", () => {
    const plan = planPasskeyNameBackfill(
      [passkey("p1", "u1", DEFAULT_PASSKEY_NAME)],
      [user("u1", "عبد")],
    );
    expect(plan.updates).toEqual([
      { passkeyId: "p1", userId: "u1", from: DEFAULT_PASSKEY_NAME, to: "عبد" },
    ]);
    expect(plan.skippedNamed).toBe(0);
    expect(plan.skippedNoUser).toBe(0);
    expect(plan.skippedDefaultUser).toBe(0);
  });

  it("backfills a passkey with no name and records `from: null`", () => {
    const plan = planPasskeyNameBackfill(
      [passkey("p1", "u1", null), passkey("p2", "u2", "")],
      [user("u1", "سارة"), user("u2", "عمر")],
    );
    expect(plan.updates).toEqual([
      { passkeyId: "p1", userId: "u1", from: null, to: "سارة" },
      { passkeyId: "p2", userId: "u2", from: "", to: "عمر" },
    ]);
  });

  it("normalizes the copied name", () => {
    const plan = planPasskeyNameBackfill(
      [passkey("p1", "u1", DEFAULT_PASSKEY_NAME)],
      [user("u1", "  سارة\u200F   الله  ")],
    );
    expect(plan.updates[0]?.to).toBe("سارة الله");
  });

  it("skips a passkey that already has a chosen name", () => {
    const plan = planPasskeyNameBackfill(
      [passkey("p1", "u1", "اسم مخصص")],
      [user("u1", "عبد")],
    );
    expect(plan.updates).toEqual([]);
    expect(plan.skippedNamed).toBe(1);
  });

  it("does not rename when the owner also never got a name", () => {
    for (const ownerName of [null, "", DEFAULT_PASSKEY_NAME]) {
      const plan = planPasskeyNameBackfill(
        [passkey("p1", "u1", DEFAULT_PASSKEY_NAME)],
        [user("u1", ownerName)],
      );
      expect(plan.updates).toEqual([]);
      expect(plan.skippedDefaultUser).toBe(1);
    }
  });

  it("skips a passkey whose owner row is missing", () => {
    const plan = planPasskeyNameBackfill(
      [passkey("p1", "u-missing", DEFAULT_PASSKEY_NAME)],
      [],
    );
    expect(plan.updates).toEqual([]);
    expect(plan.skippedNoUser).toBe(1);
  });

  it("skips an owner name that does not normalize to something usable", () => {
    const plan = planPasskeyNameBackfill(
      [passkey("p1", "u1", DEFAULT_PASSKEY_NAME)],
      [user("u1", "\u200B\u200F")],
    );
    expect(plan.updates).toEqual([]);
    expect(plan.skippedUnusableUser).toBe(1);
  });

  it("is idempotent: applying the plan produces an empty plan", () => {
    const passkeys = [passkey("p1", "u1", DEFAULT_PASSKEY_NAME)];
    const users = [user("u1", "عبد")];
    const first = planPasskeyNameBackfill(passkeys, users);
    expect(first.updates).toHaveLength(1);

    const applied: PasskeyNameRow[] = passkeys.map((row) => ({
      ...row,
      name: first.updates.find((u) => u.passkeyId === row.id)?.to ?? row.name,
    }));
    const second = planPasskeyNameBackfill(applied, users);
    expect(second.updates).toEqual([]);
    expect(second.skippedNamed).toBe(1);
  });

  it("keeps a one-to-one passkey/user mapping across many rows", () => {
    const plan = planPasskeyNameBackfill(
      [
        passkey("p1", "u1", DEFAULT_PASSKEY_NAME),
        passkey("p2", "u2", "اسم موجود"),
        passkey("p3", "u3", ""),
        passkey("p4", "u-none", DEFAULT_PASSKEY_NAME),
      ],
      [user("u1", "عبد"), user("u2", "سارة"), user("u3", DEFAULT_PASSKEY_NAME)],
    );
    expect(plan.updates.map((u) => u.passkeyId)).toEqual(["p1"]);
    expect(plan.skippedNamed).toBe(1);
    expect(plan.skippedDefaultUser).toBe(1);
    expect(plan.skippedNoUser).toBe(1);
  });
});
