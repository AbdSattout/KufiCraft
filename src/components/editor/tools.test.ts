import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_CONFIG, tileKey } from "@/lib/canvas/model";
import type { Anchor, CanvasItem, ProjectConfig } from "@/lib/canvas/model";
import { anchorPath } from "@/lib/canvas/grid";
import { makeArc, makeLine, makeTile } from "@/lib/canvas/items";
import {
  DEFAULT_ARC_STYLE,
  DEFAULT_STYLE,
  shiftSelection,
} from "./interaction";
import type { ToolContext } from "./interaction";
import {
  NO_STATE,
  beginTool,
  endTool,
  moveTool,
  previewTool,
} from "./tools";
import type { ToolState } from "./tools";

const CONFIG: ProjectConfig = { ...DEFAULT_PROJECT_CONFIG };

function context(
  items: readonly CanvasItem[] = [],
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    config: CONFIG,
    items,
    selection: [],
    tool: "pen",
    style: DEFAULT_STYLE,
    arc: DEFAULT_ARC_STYLE,
    ...overrides,
  };
}

/** A viewBox point inside the ink zone (zone 0) of cell `(column, row)`. */
function pointOf(
  column: number,
  row: number,
  offset = 1,
): { x: number; y: number } {
  return { x: column * CONFIG.base + offset, y: row * CONFIG.base + offset };
}

function input(point: { x: number; y: number }, shift = false) {
  return { point, shift };
}

function expectPen(state: ToolState): Extract<ToolState, { kind: "pen" }> {
  if (state.kind !== "pen") throw new Error(`expected pen, got ${state.kind}`);
  return state;
}
function expectLine(state: ToolState): Extract<ToolState, { kind: "line" }> {
  if (state.kind !== "line") throw new Error(`expected line, got ${state.kind}`);
  return state;
}
function expectArc(state: ToolState): Extract<ToolState, { kind: "arc" }> {
  if (state.kind !== "arc") throw new Error(`expected arc, got ${state.kind}`);
  return state;
}

/* ------------------------------------------------------------------ */
/* Pen                                                                 */
/* ------------------------------------------------------------------ */

describe("PenTool", () => {
  it("paints the cell under the pointer and nothing in between", () => {
    const ctx = context();
    const start = beginTool("pen", ctx, NO_STATE, input(pointOf(1, 1)));
    const moved = moveTool("pen", ctx, start.state, input(pointOf(5, 1)));
    // Only the positions the pointer reported — never the cells a Bresenham
    // walk would have crossed on the way (docs/CANVAS.md §Pen).
    expect(expectPen(moved.state).anchors).toEqual([
      { column: 1, row: 1, zone: 0 },
      { column: 5, row: 1, zone: 0 },
    ]);
  });

  it("keeps only the cells the pointer was actually over", () => {
    const ctx = context();
    let state = beginTool("pen", ctx, NO_STATE, input(pointOf(1, 1))).state;
    state = moveTool("pen", ctx, state, input(pointOf(5, 1))).state;
    state = moveTool("pen", ctx, state, input(pointOf(5, 5))).state;

    expect(expectPen(state).anchors).toEqual([
      { column: 1, row: 1, zone: 0 },
      { column: 5, row: 1, zone: 0 },
      { column: 5, row: 5, zone: 0 },
    ]);

    // A cell the pointer jumped over stays blank.
    state = moveTool("pen", ctx, state, input(pointOf(6, 5))).state;
    const keys = new Set(
      expectPen(state).anchors.map((anchor) =>
        tileKey(anchor.column, anchor.row, anchor.zone),
      ),
    );
    expect(keys.has(tileKey(4, 1, 0))).toBe(false);
    expect(keys.has(tileKey(5, 3, 0))).toBe(false);
  });

  it("is unchanged when the pointer stays inside the same cell", () => {
    const ctx = context();
    const start = beginTool("pen", ctx, NO_STATE, input(pointOf(1, 1)));
    const moved = moveTool("pen", ctx, start.state, input(pointOf(2, 1)));
    const again = moveTool("pen", ctx, moved.state, input(pointOf(2, 1, 2)));
    expect(again.state).toBe(moved.state);
  });

  it("commits one paintItems batch labelled رسم and resets", () => {
    const ctx = context();
    let state = beginTool("pen", ctx, NO_STATE, input(pointOf(1, 1))).state;
    state = moveTool("pen", ctx, state, input(pointOf(3, 1))).state;
    const out = endTool("pen", ctx, state);

    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.label).toBe("رسم");
    // Two fragments — the pen never merges a straight run into a bar.
    expect(out.commit?.items).toHaveLength(2);
    expect(out.commit?.items.map((item) => item.type)).toEqual([
      "tile",
      "tile",
    ]);
  });

  it("replaces a same-key item in place (recolour) and keeps one item", () => {
    const existing = makeTile({
      column: 1,
      row: 1,
      zone: 0,
      color: "#ff0000",
    });
    const ctx = context([existing]);
    const state = beginTool("pen", ctx, NO_STATE, input(pointOf(1, 1))).state;
    const out = endTool("pen", ctx, state);

    expect(out.commit?.items).toHaveLength(1);
    expect(out.commit?.items[0]).toMatchObject({
      type: "tile",
      key: tileKey(1, 1, 0),
      color: CONFIG.ink,
    });
  });

  it("has no preview before the pointer touches the canvas, then a solid one", () => {
    const ctx = context();
    expect(previewTool("pen", ctx, NO_STATE).items).toHaveLength(0);
    expect(previewTool("pen", ctx, NO_STATE).marker).toBeNull();

    const live = beginTool("pen", ctx, NO_STATE, input(pointOf(1, 1))).state;
    const preview = previewTool("pen", ctx, live);
    expect(preview.mode).toBe("solid");
    expect(preview.items).toHaveLength(1);
    expect(preview.marker).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Line                                                                */
/* ------------------------------------------------------------------ */

describe("LineTool", () => {
  it("extends with clicks and survives pointer-up", () => {
    const ctx = context();
    const first = beginTool("line", ctx, NO_STATE, input(pointOf(1, 1)));
    expect(expectLine(first.state).points).toEqual([{ column: 1, row: 1 }]);

    const second = beginTool("line", ctx, first.state, input(pointOf(3, 1)));
    expect(expectLine(second.state).points).toEqual([
      { column: 1, row: 1 },
      { column: 3, row: 1 },
    ]);

    const up = endTool("line", ctx, second.state);
    expect(up.keep).toBe(true);
    expect(up.state).toBe(second.state);

    const third = beginTool("line", ctx, up.state, input(pointOf(5, 1)));
    expect(expectLine(third.state).points).toHaveLength(3);
  });

  it("draws an axis-aligned run as one square per cell", () => {
    const ctx = context();
    const first = beginTool("line", ctx, NO_STATE, input(pointOf(1, 1)));
    const second = beginTool("line", ctx, first.state, input(pointOf(3, 1)));
    const out = beginTool("line", ctx, second.state, input(pointOf(3, 1)));

    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.label).toBe("خط");
    expect(out.commit?.items).toEqual([
      makeTile({ column: 1, row: 1, zone: 0, color: CONFIG.ink }),
      makeTile({ column: 2, row: 1, zone: 0, color: CONFIG.ink }),
      makeTile({ column: 3, row: 1, zone: 0, color: CONFIG.ink }),
    ]);
  });

  it("draws one solid bar when the squares option is off", () => {
    const ctx = context([], {
      config: { ...CONFIG, straightLinesAsSquares: false },
    });
    const first = beginTool("line", ctx, NO_STATE, input(pointOf(1, 1)));
    const second = beginTool("line", ctx, first.state, input(pointOf(3, 1)));
    const out = beginTool("line", ctx, second.state, input(pointOf(3, 1)));

    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.items).toHaveLength(1);
    expect(out.commit?.items[0]).toMatchObject({
      type: "line",
      from: { column: 1, row: 1 },
      to: { column: 3, row: 1 },
    });
  });

  it("outlines a closed rectangle with squares", () => {
    const ctx = context();
    let state = beginTool("line", ctx, NO_STATE, input(pointOf(1, 1))).state;
    state = beginTool("line", ctx, state, input(pointOf(4, 1))).state;
    state = beginTool("line", ctx, state, input(pointOf(4, 4))).state;
    state = beginTool("line", ctx, state, input(pointOf(1, 4))).state;
    const out = beginTool("line", ctx, state, input(pointOf(1, 1)));

    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.items).toHaveLength(12);
    expect(out.commit?.items.every((item) => item.type === "tile")).toBe(true);
  });

  it("commits a closed run with a diagonal part as a stroke", () => {
    const ctx = context();
    let state = beginTool("line", ctx, NO_STATE, input(pointOf(1, 1))).state;
    state = beginTool("line", ctx, state, input(pointOf(3, 1))).state;
    state = beginTool("line", ctx, state, input(pointOf(3, 3))).state;
    // The closing segment (3,3) → (1,1) is diagonal, so the run is stroked.
    const out = beginTool("line", ctx, state, input(pointOf(1, 1)));

    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.items).toHaveLength(1);
    expect(out.commit?.items[0]).toMatchObject({ type: "stroke", closed: true });
  });

  it("previews the pending segment as a ghost plus the first-point marker", () => {
    const ctx = context();
    const first = beginTool("line", ctx, NO_STATE, input(pointOf(1, 1)));
    const hovered = moveTool("line", ctx, first.state, input(pointOf(3, 1)));
    const preview = previewTool("line", ctx, hovered.state);

    expect(preview.mode).toBe("ghost");
    // The previewed run is the same squares the commit will paint.
    expect(preview.items).toHaveLength(3);
    expect(preview.items.every((item) => item.type === "tile")).toBe(true);
    expect(preview.marker).toEqual({ column: 1, row: 1, zone: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* Arc                                                                 */
/* ------------------------------------------------------------------ */

describe("ArcTool", () => {
  it("arms on the first click, survives pointer-up and cancels on the origin", () => {
    const ctx = context();
    const armed = beginTool("arc", ctx, NO_STATE, input(pointOf(1, 1)));
    expect(expectArc(armed.state).from).toEqual({ column: 1, row: 1, zone: 0 });
    expect(expectArc(armed.state).to).toEqual({ column: 1, row: 1, zone: 0 });

    const up = endTool("arc", ctx, armed.state);
    expect(up.keep).toBe(true);
    expect(up.state).toBe(armed.state);

    const cancelled = beginTool("arc", ctx, armed.state, input(pointOf(1, 1)));
    expect(cancelled.state).toBe(NO_STATE);
    expect(cancelled.commit).toBeUndefined();
  });

  it("tracks the end cell on hover and previews the arc plus the marker", () => {
    const ctx = context();
    const armed = beginTool("arc", ctx, NO_STATE, input(pointOf(1, 1))).state;
    const moved = moveTool("arc", ctx, armed, input(pointOf(4, 1)));
    expect(expectArc(moved.state).to).toEqual({ column: 4, row: 1, zone: 0 });

    const preview = previewTool("arc", ctx, moved.state);
    expect(preview.mode).toBe("ghost");
    expect(preview.marker).toEqual({ column: 1, row: 1, zone: 0 });
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0].type).toBe("arc");
  });

  it("commits on the second click with label قوس", () => {
    const ctx = context();
    const armed = beginTool("arc", ctx, NO_STATE, input(pointOf(1, 1))).state;
    const moved = moveTool("arc", ctx, armed, input(pointOf(4, 1))).state;
    const out = beginTool("arc", ctx, moved, input(pointOf(4, 1)));

    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.label).toBe("قوس");
    expect(out.commit?.items).toHaveLength(1);
    expect(out.commit?.items[0]).toMatchObject({
      type: "arc",
      from: { column: 1, row: 1 },
      to: { column: 4, row: 1 },
    });
  });

  it("commits a same-cell drag that actually moved (drag gesture)", () => {
    const ctx = context();
    const armed = beginTool("arc", ctx, NO_STATE, input(pointOf(1, 1))).state;
    const moved = moveTool("arc", ctx, armed, input(pointOf(4, 1))).state;
    const out = endTool("arc", ctx, moved);

    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.label).toBe("قوس");
  });

  it("commits nothing for a same-cell drag that never moved", () => {
    const ctx = context();
    const armed = beginTool("arc", ctx, NO_STATE, input(pointOf(2, 2)));
    const up = endTool("arc", ctx, armed.state);
    expect(up.keep).toBe(true);
    expect(up.commit).toBeUndefined();
    expect(up.state).toBe(armed.state);
  });

  it("commits nothing for a pair the Arc class rejects", () => {
    const ctx = context();
    const armed = beginTool("arc", ctx, NO_STATE, input(pointOf(1, 1))).state;
    const skewed = moveTool("arc", ctx, armed, input(pointOf(4, 3))).state;
    const out = beginTool("arc", ctx, skewed, input(pointOf(4, 3)));
    expect(out.state).toBe(NO_STATE);
    expect(out.commit).toBeUndefined();
  });

  it("does not commit an arc whose key is already on the board", () => {
    const existing = makeArc({
      from: { column: 1, row: 1 },
      to: { column: 4, row: 1 },
      direction: "clockwise",
      size: "half",
    });
    const ctx = context([existing]);
    const armed = beginTool("arc", ctx, NO_STATE, input(pointOf(1, 1))).state;
    const moved = moveTool("arc", ctx, armed, input(pointOf(4, 1))).state;
    const out = beginTool("arc", ctx, moved, input(pointOf(4, 1)));
    expect(out.state).toBe(NO_STATE);
    expect(out.commit).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Eraser + select                                                     */
/* ------------------------------------------------------------------ */

describe("EraserTool", () => {
  it("sweeps unique keys and drops the erased keys from the selection", () => {
    const tile = makeTile({ column: 0, row: 0, zone: 0 });
    const line = makeLine({ column: 1, row: 0 }, { column: 4, row: 0 });
    const ctx = context([tile, line], {
      tool: "eraser",
      selection: [tile.key, line.key],
    });

    const start = beginTool("eraser", ctx, NO_STATE, input(pointOf(0, 0)));
    const swept = moveTool("eraser", ctx, start.state, input(pointOf(1, 0)));
    const again = moveTool("eraser", ctx, swept.state, input(pointOf(1, 0, 3)));
    expect(again.state).toBe(swept.state);

    const out = endTool("eraser", ctx, again.state);
    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.label).toBe("مسح");
    expect(out.commit?.items).toEqual([]);
    expect(out.commit?.selection).toEqual([]);
  });
});

describe("SelectTool", () => {
  it("sets the selection from the keys a marquee touches", () => {
    const tile = makeTile({ column: 0, row: 0, zone: 0 });
    const far = makeTile({ column: 50, row: 50, zone: 0 });
    const ctx = context([tile, far], { tool: "select" });

    const start = beginTool("select", ctx, NO_STATE, input({ x: 200, y: 200 }));
    expect(start.state.kind).toBe("marquee");
    const dragged = moveTool("select", ctx, start.state, input({ x: -5, y: -5 }));
    const out = endTool("select", ctx, dragged.state);

    expect(out.commit).toBeUndefined();
    expect(out.selection).toEqual([tile.key]);
  });

  it("starts a move on an item click and commits shiftSelection", () => {
    const tile = makeTile({ column: 0, row: 0, zone: 0 });
    const other = makeTile({ column: 5, row: 5, zone: 0 });
    const items = [tile, other];
    const ctx = context(items, { tool: "select" });

    const start = beginTool("select", ctx, NO_STATE, input(pointOf(0, 0)));
    expect(start.selection).toEqual([tile.key]);
    const dragged = moveTool("select", ctx, start.state, input(pointOf(2, 1)));
    const out = endTool("select", ctx, dragged.state);

    expect(out.commit?.label).toBe("تحريك");
    expect(out.commit?.items).toEqual(
      shiftSelection(CONFIG, items, [tile.key], 2, 1),
    );
    expect(out.commit?.items.map((item) => item.key)).toEqual([
      tileKey(2, 1, 0),
    ]);
    expect(out.commit?.selection).toEqual([tile.key]);
  });
});

/* ------------------------------------------------------------------ */
/* anchorPath                                                          */
/* ------------------------------------------------------------------ */

describe("anchorPath", () => {
  it("returns a fragment path for zone 0 and zone 3 on the square grid", () => {
    expect(
      anchorPath(CONFIG, { column: 2, row: 3, zone: 0 }).length,
    ).toBeGreaterThan(0);
    expect(
      anchorPath(CONFIG, { column: 2, row: 3, zone: 3 }).length,
    ).toBeGreaterThan(0);
    expect(anchorPath(CONFIG, { column: 2, row: 3, zone: 3 })).not.toBe(
      anchorPath(CONFIG, { column: 2, row: 3, zone: 0 }),
    );
  });

  it("returns a slice path on the circular grid", () => {
    const circular: ProjectConfig = { ...CONFIG, gridType: "circular" };
    const anchor: Anchor = { column: 5, row: 2, zone: 0 };
    expect(anchorPath(circular, anchor).length).toBeGreaterThan(0);
    expect(
      anchorPath(circular, { column: 5, row: 2, zone: 3 }).length,
    ).toBeGreaterThan(0);
  });
});
