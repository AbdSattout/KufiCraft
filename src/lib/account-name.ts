/**
 * Client-facing alias for the canonical account-name contract.
 *
 * The canonical file lives at `convex/lib/account-name.ts` because Convex's
 * module bundler only includes shared code from inside the `convex/` directory.
 * Both paths resolve to the same module.
 */
export * from "../../convex/lib/account-name";
