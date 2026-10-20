import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";
import {
  DEFAULT_PROJECT_CONFIG,
  MAX_CIRCULAR_SECTORS,
  MAX_COLOR_LENGTH,
  MAX_ITEMS,
  MAX_KEY_LENGTH,
  MAX_NAME_LENGTH,
  MAX_THUMBNAIL_LENGTH,
  MIN_CIRCULAR_SECTORS,
  canvasItemValidator,
  circularSectors,
  maxGridIndex,
  projectConfigValidator,
  sanitizeBorder,
  sanitizeRounding,
  snapRatio,
  arcKey,
  arcPoint,
  fragmentPoint,
  lineKey,
  linePoint,
  normalizeAnchor,
  normalizeArcAnchor,
  normalizeArcSize,
  repairArcSize,
  strokeKey,
  tileKey,
} from "./lib/model";
import type {
  ArcDirection,
  ArcItem,
  CanvasItem,
  FragmentPoint,
  LineItem,
  LinePoint,
  ProjectConfig,
  StrokeItem,
  TileItem,
} from "./lib/model";
import { ARC_DIRECTIONS } from "./lib/model";
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
 * grid for `config.base`, the colour capped to `MAX_COLOR_LENGTH`, and the
 * **key re-derived from the geometry** — keys are identity (`docs/FORMAT.md`),
 * so a document with a drifting key is repaired rather than trusted. Optional
 * fields that were absent stay absent (Convex documents never carry
 * `undefined`), and the style fields are re-clamped through the model's own
 * sanitisers, so a rounded tile or an outside border survives a write exactly
 * as the format defines it. Runs on **every** write.
 */
function sanitizeItem(item: CanvasItem, config: ProjectConfig): CanvasItem | null {
  const maxColumn = maxGridIndex(config.base);
  const maxRow =
    config.gridType === "circular" ? circularSectors(config) - 1 : maxColumn;
  const column = (value: number) => sanitizeIndex(value, maxColumn);
  const row = (value: number) => sanitizeIndex(value, maxRow);
  // A fragment end keeps its zone (validated to 0…3); the ink zone is
  // canonical storage of nothing and is dropped.
  const fragment = (value: FragmentPoint): FragmentPoint =>
    fragmentPoint(column(value.column), row(value.row), value.zone);
  const color = capColor(item.color);
  const key = (value: string) => requireKey(value);
  // A border is the one style every item type can carry; `undefined` stays
  // `undefined` (the absent state), and a zero mask normalises away.
  const border =
    item.border === undefined ? undefined : sanitizeBorder(item.border);

  switch (item.type) {
    case "tile": {
      const next: TileItem = {
        type: "tile",
        key: key(tileKey(column(item.column), row(item.row), item.zone)),
        column: column(item.column),
        row: row(item.row),
        zone: item.zone,
      };
      if (item.shape !== undefined && item.shape !== "square") {
        next.shape = item.shape;
      }
      if (item.rotation !== undefined && item.rotation !== 0) {
        next.rotation = item.rotation;
      }
      // A radius of zero is the absent state.
      const rounding =
        item.rounding === undefined ? undefined : sanitizeRounding(item.rounding);
      if (rounding !== undefined) next.rounding = rounding;
      if (border !== undefined) next.border = border;
      if (color !== undefined) next.color = color;
      return next;
    }
    case "line": {
      const from = fragment(item.from);
      const to = fragment(item.to);
      const next: LineItem = {
        type: "line",
        key: key(lineKey(from, to)),
        from,
        to,
      };
      if (item.rounding !== undefined) {
        const rounding = sanitizeRounding(item.rounding);
        if (rounding !== undefined) next.rounding = rounding;
      }
      if (border !== undefined) next.border = border;
      if (color !== undefined) next.color = color;
      return next;
    }
    case "stroke": {
      const points: LinePoint[] = item.points.map((point) =>
        linePoint(
          column(point.column),
          row(point.row),
          // The fragment the point addresses (the validator bounds the zone);
          // a damaged anchor is repaired into the fragment's centre — never
          // rejected; see `normalizeAnchor`.
          point.zone,
          normalizeAnchor(point.anchor),
        ),
      );
      if (points.length < 2) return null;
      const closed = item.closed === true;
      const next: StrokeItem = {
        type: "stroke",
        key: key(strokeKey(points, closed)),
        points,
      };
      if (closed) next.closed = true;
      if (item.rounding !== undefined) {
        const rounding = sanitizeRounding(item.rounding);
        if (rounding !== undefined) next.rounding = rounding;
      }
      if (border !== undefined) next.border = border;
      if (color !== undefined) next.color = color;
      return next;
    }
    case "arc": {
      const from = arcPoint(
        column(item.from.column),
        row(item.from.row),
        // The fragment the endpoint addresses (the validator bounds the zone).
        item.from.zone,
        // A damaged anchor is repaired into the fragment — or dropped, which
        // an arc endpoint reads as its legacy spring point. The centre is a
        // value like any other here; see `normalizeArcAnchor`.
        normalizeArcAnchor(item.from.anchor),
      );
      const to = arcPoint(
        column(item.to.column),
        row(item.to.row),
        item.to.zone,
        normalizeArcAnchor(item.to.anchor),
      );
      // A degenerate arc has no geometry; dropping it beats storing a no-op.
      if (from.column === to.column && from.row === to.row) return null;
      const direction: ArcDirection = ARC_DIRECTIONS.includes(item.direction)
        ? item.direction
        : "clockwise";
      // A legacy anchor-less diagonal `half` becomes the `quarter` that draws
      // exactly the same arc (`repairArcSize`, `docs/CANVAS.md` §5).
      const size = repairArcSize(from, to, normalizeArcSize(item.size));
      const next: ArcItem = {
        type: "arc",
        key: key(arcKey(from, to, direction, size)),
        from,
        to,
        direction,
        size,
      };
      if (border !== undefined) next.border = border;
      if (color !== undefined) next.color = color;
      return next;
    }
    default:
      // Unreachable for a typed `CanvasItem`; a stored document written by an
      // older model can still arrive here, and dropping it beats crashing.
      return null;
  }
}

function sanitizeItems(
  items: readonly CanvasItem[],
  config: ProjectConfig,
): CanvasItem[] {
  const clean: CanvasItem[] = [];
  for (const item of items) {
    const next = sanitizeItem(item, config);
    if (next !== null) clean.push(next);
  }
  return clean;
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

/**
 * Stored config: the live fields, with the ones that may be missing on an
 * older document optional so the sanitiser can default them.
 */
type StoredConfig = Omit<
  ProjectConfig,
  "straightLinesAsSquares" | "circularSectors"
> & {
  straightLinesAsSquares?: boolean;
  /** Absent on documents written before the per-board sector count existed. */
  circularSectors?: number;
  /** Legacy flag (≤ model v2): merged a straight pen stroke into a `line`. */
  mergeLines?: boolean;
};

function sanitizeConfig(config: StoredConfig): ProjectConfig {
  return {
    gridType: config.gridType,
    ratio: snapRatio(config.ratio),
    base: clamp(config.base, 4, 100),
    // A sector count is a whole number of divisions: a fraction rounds to the
    // nearest sector, and anything outside the range clamps into it.
    circularSectors: Math.round(
      clamp(
        config.circularSectors ?? DEFAULT_PROJECT_CONFIG.circularSectors,
        MIN_CIRCULAR_SECTORS,
        MAX_CIRCULAR_SECTORS,
      ),
    ),
    ink: config.ink.slice(0, MAX_COLOR_LENGTH),
    background: config.background.slice(0, MAX_COLOR_LENGTH),
    showGrid: config.showGrid,
    straightLinesAsSquares:
      config.straightLinesAsSquares ??
      DEFAULT_PROJECT_CONFIG.straightLinesAsSquares,
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
  circularSectors: v.optional(v.number()),
  ink: v.optional(v.string()),
  background: v.optional(v.string()),
  showGrid: v.optional(v.boolean()),
  straightLinesAsSquares: v.optional(v.boolean()),
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
    // A document written before a config field existed is repaired on read, so
    // the editor never sees a half-filled `ProjectConfig` (docs/BACKEND.md).
    return { ...project, config: sanitizeConfig(project.config) };
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
    const config = sanitizeConfig(project.config);

    const map = new Map<string, CanvasItem>();
    for (const stored of project.items) {
      const clean = sanitizeItem(stored, config);
      if (clean !== null) map.set(clean.key, clean);
    }
    for (const op of ops) {
      switch (op.type) {
        case "add":
          for (const raw of op.items) {
            const item = sanitizeItem(raw, config);
            if (item !== null && !map.has(item.key)) map.set(item.key, item);
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
            if (item !== null) map.set(item.key, item);
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
