import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalAction, type ActionCtx } from "../_generated/server";
import { isDefaultAccountName, normalizeAccountName } from "../lib/accountName";

/**
 * Backfill the old typed-name accounts.
 *
 * When accounts were created before the sign-up card asked for a name, the
 * chosen name was stored on `user.name` but the passkey row kept the legacy
 * `DEFAULT_PASSKEY_NAME`, because the passkey row is what the header and
 * `/account` read. Those accounts still display «مفتاح المرور» even though
 * their owner typed a real name.
 *
 * `planPasskeyNameBackfill` is pure and unit-tested. `backfillPasskeyNames`
 * wraps it in an internal action over the auth component; it defaults to
 * `dryRun: true`, so running it can never write unless the operator says so
 * explicitly. It is **not** executed by this change.
 *
 * Run (after deploying this module), with the Convex CLI:
 *
 *   bunx convex run migrations/backfillPasskeyNames:backfillPasskeyNames \
 *     '{"dryRun": true}'
 *
 * Review the returned `updates`, then repeat with `'{"dryRun": false}'`.
 * No production deployment is performed here.
 */

export type PasskeyNameRow = {
  /** Convex document id (`_id`) of the passkey row. */
  id: string;
  name?: string | null;
  userId: string;
};

export type UserNameRow = {
  /** Convex document id (`_id`) of the user row. */
  id: string;
  name?: string | null;
};

export type PasskeyNameUpdate = {
  passkeyId: string;
  userId: string;
  /** The passkey's current (default/empty) name. */
  from: string | null;
  /** The normalized name from the user row. */
  to: string;
};

export type PasskeyNameBackfillPlan = {
  updates: PasskeyNameUpdate[];
  /** Passkeys that already carry a chosen name. */
  skippedNamed: number;
  /** Passkeys whose owner row is gone (never happens in practice). */
  skippedNoUser: number;
  /** Owners that never got a chosen name either — nothing to copy. */
  skippedDefaultUser: number;
  /** Owners whose stored name no longer normalizes to something usable. */
  skippedUnusableUser: number;
};

/**
 * Decides which passkey rows should inherit their owner's name.
 *
 * A row is a candidate when its own name is missing or still the legacy
 * default **and** its owner carries a real, normalized name. The result is
 * safe to apply repeatedly: once applied, every updated passkey is "named"
 * and drops out of the next plan.
 */
export function planPasskeyNameBackfill(
  passkeys: PasskeyNameRow[],
  users: UserNameRow[],
): PasskeyNameBackfillPlan {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const plan: PasskeyNameBackfillPlan = {
    updates: [],
    skippedNamed: 0,
    skippedNoUser: 0,
    skippedDefaultUser: 0,
    skippedUnusableUser: 0,
  };

  for (const passkey of passkeys) {
    if (!isDefaultAccountName(passkey.name)) {
      plan.skippedNamed += 1;
      continue;
    }
    const user = usersById.get(passkey.userId);
    if (!user) {
      plan.skippedNoUser += 1;
      continue;
    }
    if (isDefaultAccountName(user.name)) {
      plan.skippedDefaultUser += 1;
      continue;
    }
    const normalized = normalizeAccountName(user.name ?? "");
    if (normalized === null) {
      plan.skippedUnusableUser += 1;
      continue;
    }
    plan.updates.push({
      passkeyId: passkey.id,
      userId: passkey.userId,
      from: passkey.name ?? null,
      to: normalized,
    });
  }

  return plan;
}

/** Shape of the raw component documents this migration reads. */
type RawAuthDoc = {
  _id: string;
  name?: string | null;
  userId?: string | null;
};

/**
 * Reads every document of a component model, page by page.
 *
 * The component's `findMany` requires `paginationOpts`; following
 * `continueCursor` to `isDone` is the supported way to scan a whole (tiny)
 * auth table once.
 */
async function readAll(
  ctx: ActionCtx,
  model: "passkey" | "user",
): Promise<RawAuthDoc[]> {
  const docs: RawAuthDoc[] = [];
  let cursor: string | null = null;
  for (;;) {
    const result: {
      page: unknown[];
      isDone: boolean;
      continueCursor: string;
    } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model,
      where: [],
      paginationOpts: { cursor, numItems: 200 },
    });
    docs.push(...(result.page as RawAuthDoc[]));
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  return docs;
}

export const backfillPasskeyNames = internalAction({
  args: {
    /** Defaults to `true`: a bare run only reports what it would change. */
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    dryRun: v.boolean(),
    updates: v.array(
      v.object({
        passkeyId: v.string(),
        userId: v.string(),
        from: v.union(v.string(), v.null()),
        to: v.string(),
      }),
    ),
    skippedNamed: v.number(),
    skippedNoUser: v.number(),
    skippedDefaultUser: v.number(),
    skippedUnusableUser: v.number(),
    applied: v.number(),
  }),
  handler: async (ctx, { dryRun = true }) => {
    const passkeyDocs = await readAll(ctx, "passkey");
    const userDocs = await readAll(ctx, "user");

    const plan = planPasskeyNameBackfill(
      passkeyDocs.map((doc) => ({
        id: doc._id,
        name: doc.name,
        userId: doc.userId ?? "",
      })),
      userDocs.map((doc) => ({ id: doc._id, name: doc.name })),
    );

    if (dryRun) {
      return { dryRun: true, ...plan, applied: 0 };
    }

    let applied = 0;
    for (const update of plan.updates) {
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: "passkey",
          update: { name: update.to },
          where: [{ field: "_id", value: update.passkeyId }],
        },
      });
      applied += 1;
    }
    return { dryRun: false, ...plan, applied };
  },
});
