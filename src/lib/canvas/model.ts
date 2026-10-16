/**
 * Client-facing alias for the canonical canvas model.
 *
 * The canonical file lives at `convex/lib/model.ts` because Convex's
 * module bundler only includes shared code from inside the `convex/`
 * directory. Client code imports this path for ergonomics; both paths
 * resolve to the exact same module.
 */
export * from "../../../convex/lib/model";
