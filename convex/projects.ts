import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";
import {
  CIRCULAR_SECTORS,
  canvasItemValidator,
  maxGridIndex,
  projectConfigValidator,
  snapRatio,
  MAX_COLOR_LENGTH,
  MAX_ITEMS,
  MAX_KEY_LENGTH,
  MAX_NAME_LENGTH,
  MAX_THUMBNAIL_LENGTH,
} from "./lib/model";
import type {
  ArchItem,
  CanvasItem,
  LineItem,
  ProjectConfig,
  TileItem,
} from "./lib/model";
import { requireUserId } from "./lib/auth";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const opValidator = v.union(
  v.object({ type: v.literal("add"), items: v.array(canvasItemValidator) }),
  v.object({ type: v.literal("remove"), keys: v.array(v.string()) }),
  v.object({ type: v.literal("replace"), items: v.array(canvasItemValidator) }),
);

const ITEMS_LIMIT_MESSAGE = "تجاوزت اللوحة الحد الأقصى للعناصر";

/**
 * NaN-safe clamp: `NaN` falls back to `min` (the safe end) while `±Infinity`
 * still clamps to the matching bound. Plain `Math.min/max` propagate `NaN`,
 * which would store a non-value in the document.
 */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** A finite, integer, in-range grid index; `NaN` → 0, `+Infinity` → `max`. */
function sanitizeIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) return value > 0 ? max : 0;
  return Math.min(max, Math.max(0, Math.trunc(value)));
}

function capColor(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.slice(0, MAX_COLOR_LENGTH);
}

/** Rejects (never truncates) an item key longer than `MAX_KEY_LENGTH`. */
function requireKey(key: string): string {
  if (key.length > MAX_KEY_LENGTH) {
    throw new ConvexError("مفتاح العنصر أطول من الحد المسموح");
  }
  return key;
}

/**
 * Normalises one stored/received item: integer coordinates inside the legal
 * grid for `config.base`, the colour capped to `MAX_COLOR_LENGTH`, the key
 * length enforced. Runs on **every** write, so a document stored before this
 * contract is repaired the next time it is written. Optional fields that were
 * absent stay absent — Convex documents never carry `undefined`.
 */
function sanitizeItem(item: CanvasItem, config: ProjectConfig): CanvasItem {
  const maxI = maxGridIndex(config.base);
  const maxJ = config.gridType === "circular" ? CIRCULAR_SECTORS - 1 : maxI;
  const i = (value: number) => sanitizeIndex(value, maxI);
  const j = (value: number) => sanitizeIndex(value, maxJ);
  const k = requireKey(item.k);
  const color = capColor(item.c);
  switch (item.t) {
    case "tile": {
      const next: TileItem = {
        t: "tile",
        k,
        i: i(item.i),
        j: j(item.j),
        q: item.q,
      };
      if (item.s !== undefined) next.s = item.s;
      if (color !== undefined) next.c = color;
      if (item.r !== undefined) next.r = item.r;
      return next;
    }
    case "line": {
      const next: LineItem = {
        t: "line",
        k,
        i1: i(item.i1),
        j1: j(item.j1),
        i2: i(item.i2),
        j2: j(item.j2),
      };
      if (color !== undefined) next.c = color;
      return next;
    }
    case "arch": {
      const next: ArchItem = {
        t: "arch",
        k,
        i1: i(item.i1),
        j1: j(item.j1),
        i2: i(item.i2),
        j2: j(item.j2),
        d: item.d,
      };
      if (color !== undefined) next.c = color;
      return next;
    }
  }
}

function sanitizeItems(
  items: readonly CanvasItem[],
  config: ProjectConfig,
): CanvasItem[] {
  return items.map((item) => sanitizeItem(item, config));
}

/** The Arabic limit error, thrown by every write path that can add items. */
function enforceItemLimit(count: number): void {
  if (count > MAX_ITEMS) {
    throw new ConvexError(ITEMS_LIMIT_MESSAGE);
  }
}

function sanitizeName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return name.length > 0 ? name : "لوحة بلا عنوان";
}

function sanitizeConfig(config: ProjectConfig): ProjectConfig {
  return {
    ...config,
    ratio: snapRatio(config.ratio),
    base: clamp(config.base, 4, 100),
    ink: config.ink.slice(0, MAX_COLOR_LENGTH),
    background: config.background.slice(0, MAX_COLOR_LENGTH),
  };
}

const DUPLICATE_SUFFIX = " (نسخة)";

/**
 * Duplicate names keep their suffix even when the original name sits at the
 * `MAX_NAME_LENGTH` cap (the suffix is reserved before truncating the base).
 */
function duplicateName(raw: string): string {
  const room = MAX_NAME_LENGTH - DUPLICATE_SUFFIX.length;
  const base = raw.replace(/\s+/g, " ").trim().slice(0, room).trim();
  return `${base.length > 0 ? base : "لوحة بلا عنوان"}${DUPLICATE_SUFFIX}`;
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

/**
 * Read-cost ceiling for `list`.
 *
 * Deliberately a fixed constant rather than a function argument: the dashboard
 * calls `useQuery(api.projects.list)` with no args, and the generated Convex
 * client types require an args object the moment a function declares one, so an
 * optional `limit` arg would need a change in the frozen dashboard. A fixed
 * `.take()` still bounds the scan; see docs/BACKEND.md § Limits & conventions.
 */
const LIST_LIMIT = 100;

/**
 * Dashboard list — summaries only, newest first.
 *
 * Bounded scan: `.take(LIST_LIMIT)` caps how many documents are read, and
 * therefore the read cost — `items` live in the same document as the summary,
 * so every read pays for them. docs/BACKEND.md records the read-cost ceiling
 * and the structural fix (items in their own table) that this stop-gap does
 * not attempt.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_user_and_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .take(LIST_LIMIT);
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
    // Fresh boards start empty, so `MAX_ITEMS` is satisfied by construction;
    // every path that can grow a document afterwards goes through
    // `enforceItemLimit` (duplicate + applyOps).
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
    const config = sanitizeConfig(project.config);
    const items = sanitizeItems(project.items, config);
    enforceItemLimit(items.length);
    return await ctx.db.insert("projects", {
      userId,
      name: duplicateName(project.name),
      config,
      items,
      itemCount: items.length,
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
 *
 * Every item that enters the map is normalised (`sanitizeItem`), including
 * ones already stored: an old document is repaired on its next write. The
 * `MAX_ITEMS` cap is enforced on both branches that can add items (`add` and
 * `replace`); a rejection is a thrown `ConvexError`, so the transaction rolls
 * back and the document is left untouched. A stored document can never exceed
 * the cap (it equals Convex's own per-array limit), so no separate check is
 * needed for the `remove`-only / empty batch.
 */
export const applyOps = mutation({
  args: {
    projectId: v.id("projects"),
    ops: v.array(opValidator),
  },
  handler: async (ctx, { projectId, ops }) => {
    const userId = await requireUserId(ctx);
    const project = await requireOwnedProject(ctx, projectId, userId);
    const config = project.config;

    const map = new Map<string, CanvasItem>(
      project.items.map((item) => {
        const clean = sanitizeItem(item, config);
        return [clean.k, clean];
      }),
    );
    for (const op of ops) {
      switch (op.type) {
        case "add":
          for (const raw of op.items) {
            const item = sanitizeItem(raw, config);
            if (!map.has(item.k)) map.set(item.k, item);
          }
          enforceItemLimit(map.size);
          break;
        case "remove":
          for (const key of op.keys) map.delete(key);
          break;
        case "replace":
          map.clear();
          for (const raw of op.items) {
            const item = sanitizeItem(raw, config);
            map.set(item.k, item);
          }
          enforceItemLimit(map.size);
          break;
      }
    }

    const items = [...map.values()];

    const updatedAt = Date.now();
    await ctx.db.patch("projects", projectId, {
      items,
      itemCount: items.length,
      updatedAt,
    });
    return { itemCount: items.length, updatedAt };
  },
});
