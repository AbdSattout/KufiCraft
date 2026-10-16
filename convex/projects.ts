import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";
import {
  canvasItemValidator,
  projectConfigValidator,
  MAX_ITEMS,
  MAX_NAME_LENGTH,
  MAX_THUMBNAIL_LENGTH,
  MAX_RATIO,
  MIN_RATIO,
} from "./lib/model";
import type { CanvasItem, ProjectConfig } from "./lib/model";
import { requireUserId } from "./lib/auth";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const opValidator = v.union(
  v.object({ type: v.literal("add"), items: v.array(canvasItemValidator) }),
  v.object({ type: v.literal("remove"), keys: v.array(v.string()) }),
  v.object({ type: v.literal("replace"), items: v.array(canvasItemValidator) }),
);

function sanitizeName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return name.length > 0 ? name : "لوحة بلا عنوان";
}

function sanitizeConfig(config: ProjectConfig): ProjectConfig {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  return {
    ...config,
    ratio: clamp(config.ratio, MIN_RATIO, MAX_RATIO),
    base: clamp(config.base, 4, 100),
    ink: config.ink.slice(0, 32),
    background: config.background.slice(0, 32),
  };
}

async function requireOwnedProject(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  userId: string,
) {
  const project = await ctx.db.get("projects", projectId);
  if (!project || project.userId !== userId) {
    throw new ConvexError("المشروع غير موجود");
  }
  return project;
}

const configPatchValidator = v.object({
  gridType: v.optional(v.union(v.literal("square"), v.literal("circular"))),
  ratio: v.optional(v.number()),
  base: v.optional(v.number()),
  ink: v.optional(v.string()),
  background: v.optional(v.string()),
  showGrid: v.optional(v.boolean()),
  mergeLines: v.optional(v.boolean()),
});

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/** Dashboard list — summaries only, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_user_and_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    return projects.map((p) => ({
      _id: p._id,
      name: p.name,
      config: p.config,
      thumbnail: p.thumbnail,
      itemCount: p.itemCount,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  },
});

/** Full document for the editor. */
export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    const project = await ctx.db.get("projects", projectId);
    if (!project || project.userId !== userId) return null;
    return project;
  },
});

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

/**
 * Convenience function signature for the "quick create" button: the
 * client always passes an explicit, complete config (defaults live in
 * `DEFAULT_PROJECT_CONFIG`).
 */
export const create = mutation({
  args: { name: v.string(), config: projectConfigValidator },
  handler: async (ctx, { name, config }) => {
    const userId = await requireUserId(ctx);
    const now = Date.now();
    return await ctx.db.insert("projects", {
      userId,
      name: sanitizeName(name),
      config: sanitizeConfig(config),
      items: [],
      itemCount: 0,
      thumbnail: null,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const rename = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, { projectId, name }) => {
    const userId = await requireUserId(ctx);
    await requireOwnedProject(ctx, projectId, userId);
    await ctx.db.patch("projects", projectId, {
      name: sanitizeName(name),
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    await requireOwnedProject(ctx, projectId, userId);
    await ctx.db.delete("projects", projectId);
  },
});

export const duplicate = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    const project = await requireOwnedProject(ctx, projectId, userId);
    const now = Date.now();
    return await ctx.db.insert("projects", {
      userId,
      name: sanitizeName(`${project.name} (نسخة)`),
      config: project.config,
      items: project.items,
      itemCount: project.itemCount,
      thumbnail: project.thumbnail,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateConfig = mutation({
  args: { projectId: v.id("projects"), patch: configPatchValidator },
  handler: async (ctx, { projectId, patch }) => {
    const userId = await requireUserId(ctx);
    const project = await requireOwnedProject(ctx, projectId, userId);
    const merged = sanitizeConfig({ ...project.config, ...patch });
    await ctx.db.patch("projects", projectId, {
      config: merged,
      updatedAt: Date.now(),
    });
  },
});

export const updateThumbnail = mutation({
  args: {
    projectId: v.id("projects"),
    thumbnail: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { projectId, thumbnail }) => {
    const userId = await requireUserId(ctx);
    await requireOwnedProject(ctx, projectId, userId);
    await ctx.db.patch("projects", projectId, {
      thumbnail:
        thumbnail !== null && thumbnail.length <= MAX_THUMBNAIL_LENGTH
          ? thumbnail
          : null,
    });
  },
});

/**
 * Atomic batch of canvas operations — the editor sends one call per
 * completed stroke/gesture. Items are deduped by key `k`.
 */
export const applyOps = mutation({
  args: {
    projectId: v.id("projects"),
    ops: v.array(opValidator),
  },
  handler: async (ctx, { projectId, ops }) => {
    const userId = await requireUserId(ctx);
    const project = await requireOwnedProject(ctx, projectId, userId);

    let map = new Map<string, CanvasItem>(
      project.items.map((item) => [item.k, item]),
    );
    for (const op of ops) {
      switch (op.type) {
        case "add":
          for (const item of op.items) {
            if (!map.has(item.k)) map.set(item.k, item);
          }
          break;
        case "remove":
          for (const key of op.keys) map.delete(key);
          break;
        case "replace":
          map = new Map(op.items.map((item) => [item.k, item]));
          break;
      }
    }

    const items = [...map.values()];
    if (items.length > MAX_ITEMS) {
      throw new ConvexError("تجاوزت اللوحة الحد الأقصى للعناصر");
    }

    const updatedAt = Date.now();
    await ctx.db.patch("projects", projectId, {
      items,
      itemCount: items.length,
      updatedAt,
    });
    return { itemCount: items.length, updatedAt };
  },
});
