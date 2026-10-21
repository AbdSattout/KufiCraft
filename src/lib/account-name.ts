/**
 * Client-facing alias for the canonical account-name contract.
 *
 * The canonical file lives at `convex/lib/accountName.ts` because Convex's
 * module bundler only includes shared code from inside the `convex/` directory
 * (and forbids hyphens in module paths). Both paths resolve to the same module.
 */
export * from "../../convex/lib/accountName";
