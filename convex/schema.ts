import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  canvasItemValidator,
  projectConfigValidator,
} from "./lib/model";

export default defineSchema({
  /**
   * A kufic artwork document. Auth tables live inside the `betterAuth`
   * component, not here — `userId` is the Better Auth user id string.
   */
  projects: defineTable({
    userId: v.string(),
    name: v.string(),
    config: projectConfigValidator,
    /** All drawn items, ordered (last item renders on top). Deduped by `k`. */
    items: v.array(canvasItemValidator),
    itemCount: v.number(),
    /** Compact self-contained SVG string used as the dashboard preview. */
    thumbnail: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_updated", ["userId", "updatedAt"]),
});
