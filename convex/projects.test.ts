// `vite/client` is a script-style declaration file (it only augments global
// types), so a type import fails with TS2306; the reference below is the
// supported way to load it. It types `import.meta.glob` for Vitest.
/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  BORDER_LEFT,
  BORDER_TOP,
  CIRCULAR_SECTORS,
  CORNER_ALL,
  DEFAULT_PROJECT_CONFIG,
  DEFAULT_RATIO,
  MAX_BORDER_WIDTH,
  MAX_COLOR_LENGTH,
  MAX_ITEMS,
  MAX_KEY_LENGTH,
  MAX_NAME_LENGTH,
  MAX_RATIO,
  MAX_THUMBNAIL_LENGTH,
  MIN_RATIO,
  RATIO_PRESETS,
  arcKey,
  lineKey,
  strokeKey,
  tileKey,
} from "./lib/model";
import type {
  CanvasItem,
  ProjectConfig,
  TileItem,
  Zone,
} from "./lib/model";

/**
 * Backend contract tests for `convex/projects.ts` (docs/BACKEND.md).
 *
 * Everything runs in-memory through `convex-test` — no deployment is ever
 * touched. The modules map below is deliberately scoped:
 *
 * - `./projects.ts`   — the functions under test.
 * - `./lib/**\/*.ts`  — shared validators (`model.ts`) and the auth seam
 *                       (`auth.ts`) imported by `projects.ts`.
 * - `./_generated/*.js` — required by `convex-test` to locate the modules
 *                       root; those loaders are never called through the map.
 *
 * Excluded on purpose: everything else (`auth.ts`, `http.ts`,
 * `convex.config.ts`, the locally installed `betterAuth/**` component).
 * `convexTest` only imports a module when a called function lives in it, so
 * nothing here loads them — but scoping the map keeps this suite independent
 * from the auth module graph, which changes in parallel waves.
 */
const modules = import.meta.glob([
  "./projects.ts",
  "./lib/**/*.ts",
  "./_generated/*.js",
]);

const USER_A = { subject: "user-a" };
const USER_B = { subject: "user-b" };

/** Arabic user-facing messages specified by docs/BACKEND.md. */
const AUTH_REQUIRED = "يجب تسجيل الدخول أولًا";
const NOT_FOUND = "المشروع غير موجود";
const ITEMS_LIMIT = "تجاوزت اللوحة الحد الأقصى للعناصر";
const UNTITLED = "لوحة بلا عنوان";

const newTest = () => convexTest(schema, modules);
type Test = ReturnType<typeof newTest>;
type Accessor = ReturnType<Test["withIdentity"]>;

function config(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return { ...DEFAULT_PROJECT_CONFIG, ...overrides };
}

function tile(
  column = 0,
  row = 0,
  zone: Zone = 0,
  extra: Partial<TileItem> = {},
): TileItem {
  return {
    type: "tile",
    key: tileKey(column, row, zone),
    column,
    row,
    zone,
    ...extra,
  };
}

/**
 * A batch of `MAX_ITEMS` items needs that many distinct keys, and keys are
 * derived from geometry: with the default `base` of 10 the grid has 101 × 101
 * cells, so `index → (index % 101, ⌊index / 101⌋)` is injective for every
 * index below `MAX_ITEMS`.
 */
function tileAt(index: number): TileItem {
  return tile(index % 101, Math.floor(index / 101));
}

async function createProject(
  t: Accessor,
  identity: { subject: string } = USER_A,
  name = "لوحة",
  overrides: Partial<ProjectConfig> = {},
): Promise<Id<"projects">> {
  return await t
    .withIdentity(identity)
    .mutation(api.projects.create, { name, config: config(overrides) });
}

/** Narrows away `null`/`undefined` in a typed way for the happy path. */
function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

/** Asserts the call rejects with a `ConvexError` carrying Arabic `data`. */
async function expectConvexError(
  promise: Promise<unknown>,
  message: string,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    expect((error as ConvexError<string>).data).toBe(message);
    expect((error as Error).message).toContain(message);
    return;
  }
  expect.unreachable(`expected a ConvexError with data "${message}"`);
}

/* ------------------------------------------------------------------ */
/* Auth seam                                                           */
/* ------------------------------------------------------------------ */

describe("auth seam", () => {
  type Case = {
    name: string;
    call: (t: Test, projectId: Id<"projects">) => Promise<unknown>;
  };

  const cases: Case[] = [
    { name: "list", call: (t) => t.query(api.projects.list) },
    {
      name: "get",
      call: (t, projectId) => t.query(api.projects.get, { projectId }),
    },
    {
      name: "create",
      call: (t) => t.mutation(api.projects.create, { name: "x", config: config() }),
    },
    {
      name: "rename",
      call: (t, projectId) =>
        t.mutation(api.projects.rename, { projectId, name: "x" }),
    },
    {
      name: "remove",
      call: (t, projectId) => t.mutation(api.projects.remove, { projectId }),
    },
    {
      name: "duplicate",
      call: (t, projectId) => t.mutation(api.projects.duplicate, { projectId }),
    },
    {
      name: "updateConfig",
      call: (t, projectId) =>
        t.mutation(api.projects.updateConfig, { projectId, patch: { ratio: 2 / 3 } }),
    },
    {
      name: "updateThumbnail",
      call: (t, projectId) =>
        t.mutation(api.projects.updateThumbnail, {
          projectId,
          thumbnail: "<svg></svg>",
        }),
    },
    {
      name: "applyOps",
      call: (t, projectId) =>
        t.mutation(api.projects.applyOps, { projectId, ops: [] }),
    },
  ];

  it.each(cases)(
    "$name rejects unauthenticated callers with the Arabic error",
    async ({ call }) => {
      const t = newTest();
      const projectId = await createProject(t, USER_A);
      await expectConvexError(call(t, projectId), AUTH_REQUIRED);
    },
  );
});

/* ------------------------------------------------------------------ */
/* create                                                              */
/* ------------------------------------------------------------------ */

describe("create", () => {
  it("trims and collapses whitespace in the name", async () => {
    const t = newTest();
    const projectId = await createProject(
      t,
      USER_A,
      "  لوحة   الكوفي\nالمربع\t المربعة  ",
    );
    const doc = required(
      await t.withIdentity(USER_A).query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.name).toBe("لوحة الكوفي المربع المربعة");
  });

  it("falls back to the Arabic default title for an empty name", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    for (const name of ["", "   ", " \n\t "]) {
      const projectId = await createProject(t, USER_A, name);
      const doc = required(
        await asA.query(api.projects.get, { projectId }),
        "project should exist",
      );
      expect(doc.name).toBe(UNTITLED);
    }
  });

  it("caps names at MAX_NAME_LENGTH characters", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const exact = "ا".repeat(MAX_NAME_LENGTH);
    const exactId = await createProject(t, USER_A, exact);
    const cappedId = await createProject(t, USER_A, "ب".repeat(MAX_NAME_LENGTH + 30));

    const exactDoc = required(
      await asA.query(api.projects.get, { projectId: exactId }),
      "project should exist",
    );
    const cappedDoc = required(
      await asA.query(api.projects.get, { projectId: cappedId }),
      "project should exist",
    );
    expect(exactDoc.name).toBe(exact);
    expect(cappedDoc.name).toHaveLength(MAX_NAME_LENGTH);
    expect(cappedDoc.name).toBe("ب".repeat(MAX_NAME_LENGTH));
  });

  it("clamps the config ratio into [MIN_RATIO, MAX_RATIO]", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const low = await createProject(t, USER_A, "منخفض", { ratio: 0.01 });
    const high = await createProject(t, USER_A, "مرتفع", { ratio: 9 });
    const lowDoc = required(
      await asA.query(api.projects.get, { projectId: low }),
      "project should exist",
    );
    const highDoc = required(
      await asA.query(api.projects.get, { projectId: high }),
      "project should exist",
    );
    expect(lowDoc.config.ratio).toBe(MIN_RATIO);
    expect(highDoc.config.ratio).toBe(MAX_RATIO);
  });

  it("clamps the config base into [4, 100] and keeps valid values as-is", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const low = await createProject(t, USER_A, "صغير", { base: 1 });
    const high = await createProject(t, USER_A, "كبير", { base: 500 });
    const valid = await createProject(t, USER_A, "صالح", {
      ratio: 2 / 3,
      base: 7,
      gridType: "circular",
    });
    const lowDoc = required(
      await asA.query(api.projects.get, { projectId: low }),
      "project should exist",
    );
    const highDoc = required(
      await asA.query(api.projects.get, { projectId: high }),
      "project should exist",
    );
    const validDoc = required(
      await asA.query(api.projects.get, { projectId: valid }),
      "project should exist",
    );
    expect(lowDoc.config.base).toBe(4);
    expect(highDoc.config.base).toBe(100);
    expect(validDoc.config).toEqual(config({ ratio: 2 / 3, base: 7, gridType: "circular" }));
  });

  it("truncates ink and background to MAX_COLOR_LENGTH characters", async () => {
    const t = newTest();
    const long = `oklch(0.5 0.1 200)${"x".repeat(64)}`;
    expect(long.length).toBeGreaterThan(MAX_COLOR_LENGTH);
    const projectId = await createProject(t, USER_A, "ألوان", {
      ink: long,
      background: long,
    });
    const doc = required(
      await t.withIdentity(USER_A).query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.config.ink).toBe(long.slice(0, MAX_COLOR_LENGTH));
    expect(doc.config.background).toBe(long.slice(0, MAX_COLOR_LENGTH));
  });

  it("initialises an empty, unthumbnailed document owned by the caller", async () => {
    const t = newTest();
    const before = Date.now();
    const projectId = await createProject(t, USER_A, "لوحة جديدة");
    const after = Date.now();
    const doc = required(
      await t.withIdentity(USER_A).query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.name).toBe("لوحة جديدة");
    expect(doc.items).toEqual([]);
    expect(doc.itemCount).toBe(0);
    expect(doc.thumbnail).toBeNull();
    expect(doc.createdAt).toBe(doc.updatedAt);
    expect(doc.createdAt).toBeGreaterThanOrEqual(before);
    expect(doc.createdAt).toBeLessThanOrEqual(after);
  });
});

/* ------------------------------------------------------------------ */
/* list                                                                */
/* ------------------------------------------------------------------ */

describe("list", () => {
  it("returns only the caller's projects", async () => {
    const t = newTest();
    await createProject(t, USER_A, "لوحة أ");
    await createProject(t, USER_A, "لوحة أ الثانية");
    await createProject(t, USER_B, "لوحة ب");

    const listA = await t.withIdentity(USER_A).query(api.projects.list);
    const listB = await t.withIdentity(USER_B).query(api.projects.list);
    expect(listA.map((p) => p.name).sort()).toEqual(["لوحة أ", "لوحة أ الثانية"].sort());
    expect(listB.map((p) => p.name)).toEqual(["لوحة ب"]);
  });

  it("orders projects by updatedAt, newest first", async () => {
    const t = newTest();
    const first = await createProject(t, USER_A, "الأولى");
    const second = await createProject(t, USER_A, "الثانية");
    const third = await createProject(t, USER_A, "الثالثة");
    await t.run(async (ctx) => {
      await ctx.db.patch("projects", first, { updatedAt: 300 });
      await ctx.db.patch("projects", second, { updatedAt: 200 });
      await ctx.db.patch("projects", third, { updatedAt: 100 });
    });

    const list = await t.withIdentity(USER_A).query(api.projects.list);
    expect(list.map((p) => p._id)).toEqual([first, second, third]);
  });

  it("returns summaries without items", async () => {
    const t = newTest();
    const projectId = await createProject(t, USER_A, "ملخصة");
    await t.withIdentity(USER_A).mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [tile(0, 0, 0), tile(1, 0, 0)] }],
    });

    const list = await t.withIdentity(USER_A).query(api.projects.list);
    expect(list).toHaveLength(1);
    const summary = required(list[0], "list should contain the project");
    expect(summary).not.toHaveProperty("items");
    expect(Object.keys(summary).sort()).toEqual(
      ["createdAt", "config", "itemCount", "name", "thumbnail", "updatedAt", "_id"].sort(),
    );
    expect(summary.itemCount).toBe(2);
    expect(summary._id).toBe(projectId);
  });
});

/* ------------------------------------------------------------------ */
/* get                                                                 */
/* ------------------------------------------------------------------ */

describe("get", () => {
  it("returns the full document including items for the owner", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "كاملة");
    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [tile(0, 0, 0), tile(2, 0, 1)] }],
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc._id).toBe(projectId);
    expect(doc.name).toBe("كاملة");
    expect(doc.items.map((item) => item.key)).toEqual([
      tileKey(0, 0, 0),
      tileKey(2, 0, 1),
    ]);
    expect(doc.itemCount).toBe(2);
  });

  it("returns null for another user's project", async () => {
    const t = newTest();
    const projectId = await createProject(t, USER_A);
    const doc = await t.withIdentity(USER_B).query(api.projects.get, { projectId });
    expect(doc).toBeNull();
  });

  it("returns null for a removed project id", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    await asA.mutation(api.projects.remove, { projectId });
    const doc = await asA.query(api.projects.get, { projectId });
    expect(doc).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* rename                                                              */
/* ------------------------------------------------------------------ */

describe("rename", () => {
  it("sanitises the new name and bumps updatedAt", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "قديمة");
    await t.run(async (ctx) => {
      await ctx.db.patch("projects", projectId, { updatedAt: 0 });
    });

    await asA.mutation(api.projects.rename, {
      projectId,
      name: "  اسم    جديد\nتمامًا ",
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.name).toBe("اسم جديد تمامًا");
    expect(doc.updatedAt).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* duplicate                                                           */
/* ------------------------------------------------------------------ */

describe("duplicate", () => {
  it("copies config, items and thumbnail and suffixes the name with (نسخة)", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "الأصل", {
      gridType: "circular",
      ratio: 2 / 3,
      base: 8,
    });
    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [tile(0, 0, 0), tile(3, 0, 2)] }],
    });
    await asA.mutation(api.projects.updateThumbnail, {
      projectId,
      thumbnail: "<svg><path d=\"M0 0\"/></svg>",
    });

    const copyId = await asA.mutation(api.projects.duplicate, { projectId });
    expect(copyId).not.toBe(projectId);

    const original = required(
      await asA.query(api.projects.get, { projectId }),
      "original should exist",
    );
    const copy = required(
      await asA.query(api.projects.get, { projectId: copyId }),
      "copy should exist",
    );
    expect(copy.name).toBe("الأصل (نسخة)");
    expect(copy.config).toEqual(original.config);
    expect(copy.items).toEqual(original.items);
    expect(copy.itemCount).toBe(original.itemCount);
    expect(copy.thumbnail).toBe(original.thumbnail);
  });

  it("keeps the (نسخة) suffix when the original name is at the length cap", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "ا".repeat(MAX_NAME_LENGTH));

    const copyId = await asA.mutation(api.projects.duplicate, { projectId });
    const copy = required(
      await asA.query(api.projects.get, { projectId: copyId }),
      "copy should exist",
    );
    expect(copy.name.endsWith(" (نسخة)")).toBe(true);
    expect(copy.name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(copy.name.slice(0, -" (نسخة)".length).trimEnd().length).toBeLessThanOrEqual(
      MAX_NAME_LENGTH - " (نسخة)".length,
    );
  });

  it("keeps the copy independent from the original", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "مستقلة");
    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [tile(0, 0, 0)] }],
    });

    const copyId = await asA.mutation(api.projects.duplicate, { projectId });
    await asA.mutation(api.projects.rename, { projectId: copyId, name: "النسخة" });
    await asA.mutation(api.projects.applyOps, {
      projectId: copyId,
      ops: [{ type: "add", items: [tile(9, 9, 3)] }],
    });

    const original = required(
      await asA.query(api.projects.get, { projectId }),
      "original should exist",
    );
    const copy = required(
      await asA.query(api.projects.get, { projectId: copyId }),
      "copy should exist",
    );
    expect(original.name).toBe("مستقلة");
    expect(original.items.map((item) => item.key)).toEqual([tileKey(0, 0, 0)]);
    expect(copy.name).toBe("النسخة");
    expect(copy.items.map((item) => item.key)).toEqual([
      tileKey(0, 0, 0),
      tileKey(9, 9, 3),
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* remove                                                              */
/* ------------------------------------------------------------------ */

describe("remove", () => {
  it("deletes the project and drops it from the list", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const keep = await createProject(t, USER_A, "تبقى");
    const doomed = await createProject(t, USER_A, "تحذف");

    await asA.mutation(api.projects.remove, { projectId: doomed });

    const list = await asA.query(api.projects.list);
    expect(list.map((p) => p._id)).toEqual([keep]);
  });

  it("throws the Arabic not-found error for an already removed project", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    await asA.mutation(api.projects.remove, { projectId });
    await expectConvexError(
      asA.mutation(api.projects.remove, { projectId }),
      NOT_FOUND,
    );
  });
});

/* ------------------------------------------------------------------ */
/* updateConfig                                                        */
/* ------------------------------------------------------------------ */

describe("updateConfig", () => {
  it("merges a partial patch and keeps the untouched fields", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "جزئية", {
      ratio: 2 / 3,
      base: 8,
    });

    await asA.mutation(api.projects.updateConfig, {
      projectId,
      patch: { base: 12, showGrid: true },
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.config).toEqual(
      config({ ratio: 2 / 3, base: 12, showGrid: true }),
    );
  });

  it("clamps the patched ratio and base into range", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);

    await asA.mutation(api.projects.updateConfig, {
      projectId,
      patch: { ratio: -3, base: 1000 },
    });
    const clampedLow = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(clampedLow.config.ratio).toBe(MIN_RATIO);
    expect(clampedLow.config.base).toBe(100);

    await asA.mutation(api.projects.updateConfig, {
      projectId,
      patch: { ratio: 3, base: 0 },
    });
    const clampedHigh = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(clampedHigh.config.ratio).toBe(MAX_RATIO);
    expect(clampedHigh.config.base).toBe(4);
  });

  it("can switch the grid type and the straight-lines-as-squares flag", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);

    await asA.mutation(api.projects.updateConfig, {
      projectId,
      patch: { gridType: "circular", straightLinesAsSquares: false },
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.config.gridType).toBe("circular");
    expect(doc.config.straightLinesAsSquares).toBe(false);
  });

  it("repairs a config written before the field existed", async () => {
    // A stored document from an older deployment: no `straightLinesAsSquares`
    // and the legacy `mergeLines` flag still present.
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    await t.run(async (ctx) => {
      const project = await ctx.db.get("projects", projectId);
      if (!project) throw new Error("missing project");
      const { config } = project;
      await ctx.db.patch("projects", projectId, {
        config: {
          gridType: config.gridType,
          ratio: config.ratio,
          base: config.base,
          ink: config.ink,
          background: config.background,
          showGrid: config.showGrid,
          mergeLines: false,
        },
      });
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.config.straightLinesAsSquares).toBe(
      DEFAULT_PROJECT_CONFIG.straightLinesAsSquares,
    );
    expect(doc.config).not.toHaveProperty("mergeLines");

    // …and the next write stores the repaired config.
    await asA.mutation(api.projects.updateConfig, {
      projectId,
      patch: { showGrid: true },
    });
    const stored = await t.run(async (ctx) => {
      const project = await ctx.db.get("projects", projectId);
      return project?.config ?? null;
    });
    expect(stored?.straightLinesAsSquares).toBe(true);
    expect(stored).not.toHaveProperty("mergeLines");
  });
});

/* ------------------------------------------------------------------ */
/* updateThumbnail                                                     */
/* ------------------------------------------------------------------ */

describe("updateThumbnail", () => {
  it("stores a compact SVG string", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);

    await asA.mutation(api.projects.updateThumbnail, {
      projectId,
      thumbnail: "<svg><rect width=\"10\" height=\"10\"/></svg>",
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.thumbnail).toBe("<svg><rect width=\"10\" height=\"10\"/></svg>");
  });

  it("stores null when the thumbnail exceeds MAX_THUMBNAIL_LENGTH", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);

    await asA.mutation(api.projects.updateThumbnail, {
      projectId,
      thumbnail: "x".repeat(MAX_THUMBNAIL_LENGTH + 1),
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.thumbnail).toBeNull();
  });

  it("keeps a thumbnail of exactly MAX_THUMBNAIL_LENGTH characters", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    const boundary = "y".repeat(MAX_THUMBNAIL_LENGTH);

    await asA.mutation(api.projects.updateThumbnail, {
      projectId,
      thumbnail: boundary,
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.thumbnail).toBe(boundary);
  });

  it("clears the thumbnail when null is passed", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    await asA.mutation(api.projects.updateThumbnail, {
      projectId,
      thumbnail: "<svg></svg>",
    });

    await asA.mutation(api.projects.updateThumbnail, {
      projectId,
      thumbnail: null,
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.thumbnail).toBeNull();
  });

  it("does not bump updatedAt", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    // Pin updatedAt to a known value so any bump is visible.
    await t.run(async (ctx) => {
      await ctx.db.patch("projects", projectId, { updatedAt: 1234 });
    });
    const before = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );

    await asA.mutation(api.projects.updateThumbnail, {
      projectId,
      thumbnail: "<svg><g/></svg>",
    });

    const after = required(
      await asA.query(api.projects.get, { projectId }),
      "project should still exist",
    );
    // docs/BACKEND.md: thumbnails are derived from edits whose applyOps batch
    // already bumped updatedAt; the thumbnail write itself must not.
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.updatedAt).toBe(1234);
    expect(after.thumbnail).toBe("<svg><g/></svg>");
  });
});

/* ------------------------------------------------------------------ */
/* applyOps                                                            */
/* ------------------------------------------------------------------ */

describe("applyOps", () => {
  it("adds new items, dedupes by key and keeps the existing version", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    const first = tile(0, 0, 0);

    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [first, tile(1, 0, 0)] }],
    });
    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [
        {
          // Same key as `first` (a key is derived from the geometry), so the
          // stored version wins and the colour of this copy is discarded.
          type: "add",
          items: [tile(0, 0, 0, { color: "#ff0000" }), tile(2, 0, 0)],
        },
      ],
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.items.map((item) => item.key)).toEqual([
      tileKey(0, 0, 0),
      tileKey(1, 0, 0),
      tileKey(2, 0, 0),
    ]);
    expect(doc.items[0]).toEqual(first);
  });

  it("removes items by key and ignores unknown keys", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    const a = tile(0, 0, 0);
    const b = tile(1, 0, 0);
    const c = tile(2, 0, 0);
    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [a, b, c] }],
    });

    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "remove", keys: [a.key, c.key, "ghost"] }],
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.items.map((item) => item.key)).toEqual([b.key]);
  });

  it("replaces the whole list with a replace op", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [tile(0, 0, 0), tile(1, 0, 0)] }],
    });

    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "replace", items: [tile(2, 0, 0)] }],
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.items.map((item) => item.key)).toEqual([tileKey(2, 0, 0)]);
  });

  it("applies a mixed batch in order", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    const a = tile(0, 0, 0);
    const b = tile(1, 0, 0);
    const c = tile(2, 0, 0);
    const d = tile(3, 0, 0);
    const e = tile(4, 0, 0);
    const f = tile(5, 0, 0);

    const result = await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [
        { type: "add", items: [a, b] },
        { type: "remove", keys: [a.key] },
        { type: "add", items: [c] },
        { type: "replace", items: [d, e] },
        { type: "add", items: [d, f] },
      ],
    });

    expect(result.itemCount).toBe(3);
    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.items.map((item) => item.key)).toEqual([d.key, e.key, f.key]);
  });

  it("re-appends removed keys in the batch's order (the arrange contract)", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    const a = tile(0, 0, 0);
    const b = tile(1, 0, 0);
    const c = tile(2, 0, 0);
    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [a, b, c] }],
    });

    // `toOps` diffs a reorder into a `remove` + `add` of the tail; the document
    // must come out exactly in the order the add lists, because that is what
    // the arrange commands (docs/CANVAS.md §3) rely on.
    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [
        { type: "remove", keys: [a.key, b.key, c.key] },
        { type: "add", items: [c, b, a] },
      ],
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.items.map((item) => item.key)).toEqual([c.key, b.key, a.key]);
  });

  it("returns itemCount/updatedAt and persists them", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);

    const result = await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [tile(0, 0, 0), tile(1, 0, 0)] }],
    });

    expect(result).toEqual({ itemCount: 2, updatedAt: expect.any(Number) });
    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.itemCount).toBe(2);
    expect(doc.items).toHaveLength(2);
    expect(doc.updatedAt).toBe(result.updatedAt);
  });

  it("accepts exactly MAX_ITEMS items", async () => {
    // NOTE: `convex-test` is an in-memory fake — it does not enforce Convex's
    // real per-value limits (a real deployment caps every array at 8192
    // elements), so these tests may hand a mutation more items than the
    // production runtime would accept. That is deliberate: it exercises the
    // handler's own guard.
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    const items: CanvasItem[] = Array.from({ length: MAX_ITEMS }, (_, index) =>
      tileAt(index),
    );

    const result = await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "replace", items }],
    });

    expect(result.itemCount).toBe(MAX_ITEMS);
    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.itemCount).toBe(MAX_ITEMS);
    expect(doc.items).toHaveLength(MAX_ITEMS);
  });

  it("throws the Arabic limit error above MAX_ITEMS and leaves the document untouched", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [tile(0, 0, 0)] }],
    });
    const before = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    const tooMany: CanvasItem[] = Array.from(
      { length: MAX_ITEMS + 1 },
      (_, index) => tileAt(index),
    );

    await expectConvexError(
      asA.mutation(api.projects.applyOps, {
        projectId,
        ops: [{ type: "replace", items: tooMany }],
      }),
      ITEMS_LIMIT,
    );

    const after = required(
      await asA.query(api.projects.get, { projectId }),
      "project should still exist",
    );
    expect(after).toEqual(before);
  });

  it("enforces the limit on the add path too", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    const full: CanvasItem[] = Array.from({ length: MAX_ITEMS }, (_, index) =>
      tileAt(index),
    );
    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "replace", items: full }],
    });
    const before = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );

    await expectConvexError(
      asA.mutation(api.projects.applyOps, {
        projectId,
        ops: [{ type: "add", items: [tile(100, 100)] }],
      }),
      ITEMS_LIMIT,
    );

    // A rejected `add` must roll back: the full document is byte-identical.
    const after = required(
      await asA.query(api.projects.get, { projectId }),
      "project should still exist",
    );
    expect(after).toEqual(before);
  });
});

/* ------------------------------------------------------------------ */
/* ownership isolation                                                 */
/* ------------------------------------------------------------------ */

describe("ownership isolation", () => {
  it("rejects every cross-user read or write and leaves the document untouched", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const asB = t.withIdentity(USER_B);
    const projectId = await createProject(t, USER_A, "لوحة أ", {
      ratio: 2 / 3,
      base: 8,
    });
    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [tile(0, 0, 0)] }],
    });
    await asA.mutation(api.projects.updateThumbnail, {
      projectId,
      thumbnail: "<svg></svg>",
    });

    expect(await asB.query(api.projects.get, { projectId })).toBeNull();
    expect(await asB.query(api.projects.list)).toEqual([]);

    await expectConvexError(
      asB.mutation(api.projects.rename, { projectId, name: "مسروقة" }),
      NOT_FOUND,
    );
    await expectConvexError(
      asB.mutation(api.projects.remove, { projectId }),
      NOT_FOUND,
    );
    await expectConvexError(
      asB.mutation(api.projects.duplicate, { projectId }),
      NOT_FOUND,
    );
    await expectConvexError(
      asB.mutation(api.projects.updateConfig, {
        projectId,
        patch: { ratio: 0.25 },
      }),
      NOT_FOUND,
    );
    await expectConvexError(
      asB.mutation(api.projects.updateThumbnail, {
        projectId,
        thumbnail: "سرقة",
      }),
      NOT_FOUND,
    );
    await expectConvexError(
      asB.mutation(api.projects.applyOps, {
        projectId,
        ops: [{ type: "replace", items: [] }],
      }),
      NOT_FOUND,
    );

    const untouched = required(
      await asA.query(api.projects.get, { projectId }),
      "project should still exist",
    );
    expect(untouched.name).toBe("لوحة أ");
    expect(untouched.config).toEqual(config({ ratio: 2 / 3, base: 8 }));
    expect(untouched.items.map((item) => item.key)).toEqual([tileKey(0, 0, 0)]);
    expect(untouched.thumbnail).toBe("<svg></svg>");
  });

  it("throws the not-found error for mutations on a nonexistent project id", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    await asA.mutation(api.projects.remove, { projectId });

    await expectConvexError(
      asA.mutation(api.projects.rename, { projectId, name: "لاحقًا" }),
      NOT_FOUND,
    );
  });
});

/* ------------------------------------------------------------------ */
/* config sanitisation (M1)                                            */
/* ------------------------------------------------------------------ */

describe("config sanitisation", () => {
  it("snaps the ratio to the nearest preset, including NaN and ties", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const rain = await createProject(t, USER_A, "نسبة", {
      ratio: Number.NaN,
    });
    const zero = await createProject(t, USER_A, "صفر", { ratio: 0 });
    const half = await createProject(t, USER_A, "نصف", { ratio: 0.6 });
    const tie =
      (RATIO_PRESETS[1].ratio + RATIO_PRESETS[2].ratio) / 2;
    const tied = await createProject(t, USER_A, "تعادل", { ratio: tie });

    const ratios = await Promise.all(
      [rain, zero, half, tied].map(async (projectId) =>
        required(
          await asA.query(api.projects.get, { projectId }),
          "project should exist",
        ).config.ratio,
      ),
    );
    expect(ratios[0]).toBe(DEFAULT_RATIO);
    expect(ratios[1]).toBe(MIN_RATIO);
    expect(ratios[2]).toBe(RATIO_PRESETS[1].ratio);
    // Exactly between two presets snaps down (strict `<` keeps the lower one).
    expect(ratios[3]).toBe(RATIO_PRESETS[1].ratio);
  });

  it("snaps the ratio on updateConfig as well", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A);
    await asA.mutation(api.projects.updateConfig, {
      projectId,
      patch: { ratio: Number.POSITIVE_INFINITY },
    });
    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.config.ratio).toBe(DEFAULT_RATIO);
  });

  it("clamps a NaN/Infinity base to the low/high bound", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const rain = await createProject(t, USER_A, "قاعدة", { base: Number.NaN });
    const huge = await createProject(t, USER_A, "ضخمة", {
      base: Number.POSITIVE_INFINITY,
    });
    const tiny = await createProject(t, USER_A, "ضئيلة", {
      base: Number.NEGATIVE_INFINITY,
    });

    const bases = await Promise.all(
      [rain, huge, tiny].map(async (projectId) =>
        required(
          await asA.query(api.projects.get, { projectId }),
          "project should exist",
        ).config.base,
      ),
    );
    expect(bases[0]).toBe(4);
    expect(bases[1]).toBe(100);
    expect(bases[2]).toBe(4);
  });
});

/* ------------------------------------------------------------------ */
/* item sanitisation (M1/M2)                                           */
/* ------------------------------------------------------------------ */

describe("item sanitisation", () => {
  it("stores finite, integer, in-range coordinates", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "إحداثيات");

    // Default base is 10 → the largest legal index is 1000 / 10 = 100.
    const items: CanvasItem[] = [
      tile(Number.NaN, Number.NaN),
      tile(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
      tile(2.9, 3.1),
      tile(9999, 9999),
      {
        type: "line",
        key: "client-line",
        from: { column: Number.NaN, row: 1.9 },
        to: { column: Number.POSITIVE_INFINITY, row: 1000 },
      },
      {
        type: "arc",
        key: "client-arc",
        from: { column: -5, row: 4.7 },
        to: { column: 3, row: 2 },
        direction: "counterclockwise",
        size: "half",
      },
    ];
    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items }],
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    // Client-sent keys are ignored: every key is re-derived from the geometry
    // *after* clamping, and the array keeps the order the op listed.
    expect(doc.items.map((item) => item.key)).toEqual([
      tileKey(0, 0, 0),
      tileKey(100, 0, 0),
      tileKey(2, 3, 0),
      tileKey(100, 100, 0),
      lineKey({ column: 0, row: 1 }, { column: 100, row: 100 }),
      arcKey(
        { column: 0, row: 4 },
        { column: 3, row: 2 },
        "counterclockwise",
        "half",
      ),
    ]);
    expect(doc.items[0]).toMatchObject({ column: 0, row: 0 });
    expect(doc.items[1]).toMatchObject({ column: 100, row: 0 });
    expect(doc.items[2]).toMatchObject({ column: 2, row: 3 });
    expect(doc.items[3]).toMatchObject({ column: 100, row: 100 });
    expect(doc.items[4]).toMatchObject({
      type: "line",
      from: { column: 0, row: 1 },
      to: { column: 100, row: 100 },
    });
    expect(doc.items[5]).toMatchObject({
      type: "arc",
      from: { column: 0, row: 4 },
      to: { column: 3, row: 2 },
      direction: "counterclockwise",
      size: "half",
    });
  });

  it("caps the sector index to the circular grid's sector count", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "دائري", {
      gridType: "circular",
    });
    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [tile(500, 99, 1)] }],
    });
    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    // On the circular grid the radial axis is capped by the base and the
    // angular axis by CIRCULAR_SECTORS (36 sectors, indices 0…35).
    expect(doc.items[0]).toMatchObject({
      column: 100,
      row: CIRCULAR_SECTORS - 1,
      zone: 1,
    });
    expect(doc.items[0]?.key).toBe(tileKey(100, CIRCULAR_SECTORS - 1, 1));
  });

  it("drops a stroke with fewer than two points and a degenerate arc", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "إسقاط");
    const points = [
      { column: 3, row: 0 },
      { column: 4, row: 0 },
    ];

    const result = await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [
        {
          type: "add",
          items: [
            tile(0, 0, 0),
            { type: "stroke", key: "empty", points: [] },
            { type: "stroke", key: "single", points: [{ column: 1, row: 1 }] },
            {
              type: "arc",
              key: "degenerate",
              from: { column: 2, row: 2 },
              to: { column: 2, row: 2 },
              direction: "clockwise",
              size: "half",
            },
            { type: "stroke", key: "seg", points, closed: true },
          ],
        },
      ],
    });

    expect(result.itemCount).toBe(2);
    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.items.map((item) => item.key)).toEqual([
      tileKey(0, 0, 0),
      strokeKey(points, true),
    ]);
    expect(doc.items[1]).toMatchObject({ type: "stroke", points, closed: true });
  });

  it("drops a default square shape and a zero rotation", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "أشكال");

    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [
        {
          type: "add",
          items: [
            tile(0, 0, 0, { shape: "square", rotation: 0 }),
            tile(1, 0, 0, { shape: "circle", rotation: 2 }),
          ],
        },
      ],
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.items[0]).not.toHaveProperty("shape");
    expect(doc.items[0]).not.toHaveProperty("rotation");
    expect(doc.items[1]).toMatchObject({ shape: "circle", rotation: 2 });
  });

  it("keeps rounding and borders, re-clamped and normalised", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "أنماط", { base: 10 });

    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [
        {
          type: "add",
          items: [
            tile(0, 0, 0, {
              rounding: { radius: 0.9, corners: CORNER_ALL | 16 },
              border: {
                sides: BORDER_TOP | 16,
                width: 99,
                color: "#ff0000",
              },
            }),
            tile(1, 0, 0, {
              rounding: { radius: 0, corners: CORNER_ALL },
              border: { sides: 0, width: 2 },
            }),
            {
              type: "line",
              key: lineKey({ column: 0, row: 1 }, { column: 4, row: 1 }),
              from: { column: 0, row: 1 },
              to: { column: 4, row: 1 },
              border: { sides: BORDER_LEFT, width: 2 },
            },
          ],
        },
      ],
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.items[0]).toMatchObject({
      rounding: { radius: 0.5, corners: CORNER_ALL },
      border: { sides: BORDER_TOP, width: MAX_BORDER_WIDTH, color: "#ff0000" },
    });
    expect(doc.items[1]).not.toHaveProperty("rounding");
    expect(doc.items[1]).not.toHaveProperty("border");
    expect(doc.items[2]).toMatchObject({
      border: { sides: BORDER_LEFT, width: 2 },
    });
  });

  it("uses the configured base to size the legal coordinate range", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "قاعدة كبيرة", {
      base: 100,
    });
    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [tile(500, 500)] }],
    });
    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    // base 100 → 1000 / 100 = 10.
    expect(doc.items[0]).toMatchObject({ column: 10, row: 10 });
  });

  it("caps an item colour to MAX_COLOR_LENGTH", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "ألوان العناصر");
    const long = `#${"a".repeat(MAX_COLOR_LENGTH + 20)}`;

    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [
        {
          type: "add",
          items: [tile(0, 0, 0, { color: long })],
        },
      ],
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.items[0]?.color).toBe(long.slice(0, MAX_COLOR_LENGTH));
  });

  it("ignores a client-sent key and re-derives it from the geometry", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "مفاتيح");
    const clientKey = "k".repeat(MAX_KEY_LENGTH + 1);

    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [tile(0, 0, 0, { key: clientKey })] }],
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    // Keys are identity but they are derived, never trusted: an oversized
    // client key can never reach the document, so it is dropped in favour of
    // the derived one instead of being rejected.
    expect(doc.items.map((item) => item.key)).toEqual([tileKey(0, 0, 0)]);
    const storedKey = doc.items[0]?.key ?? "";
    expect(storedKey).not.toBe(clientKey);
    expect(storedKey.length).toBeLessThanOrEqual(MAX_KEY_LENGTH);
  });

  it("repairs a document written before this contract on its next write", async () => {
    const t = newTest();
    const asA = t.withIdentity(USER_A);
    const projectId = await createProject(t, USER_A, "قديمة", { base: 10 });
    // A document stored before the sanitisation contract: NaN / fractional
    // coordinates, a drifting key and an oversized colour are all schema-valid
    // `v.number()` / `v.string()` values, so they can already be in the table.
    await t.run(async (ctx) => {
      await ctx.db.patch("projects", projectId, {
        items: [
          {
            type: "tile",
            key: "stale",
            column: Number.NaN,
            row: 4.5,
            zone: 0,
            color: "z".repeat(MAX_COLOR_LENGTH + 10),
          },
        ],
        itemCount: 1,
      });
    });

    await asA.mutation(api.projects.applyOps, {
      projectId,
      ops: [{ type: "add", items: [tile(1, 1)] }],
    });

    const doc = required(
      await asA.query(api.projects.get, { projectId }),
      "project should exist",
    );
    expect(doc.items.map((item) => item.key)).toEqual([
      tileKey(0, 4, 0),
      tileKey(1, 1, 0),
    ]);
    expect(doc.items[0]).toMatchObject({
      column: 0,
      row: 4,
      color: "z".repeat(MAX_COLOR_LENGTH),
    });
    expect(doc.itemCount).toBe(2);
  });
});
