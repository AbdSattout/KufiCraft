import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_CONFIG, arcKey, cellSize, tileKey } from "@/lib/canvas/model";
import type { Anchor, CanvasItem, ProjectConfig } from "@/lib/canvas/model";
import { anchorPath } from "@/lib/canvas/grid";
import { inkUnit } from "@/lib/canvas/geometry";
import { makeArc, makeLine, makeTile } from "@/lib/canvas/items";
import {
  DEFAULT_ARC_STYLE,
  DEFAULT_STYLE,
  moveItems,
} from "./interaction";
import type { ToolContext } from "./interaction";
import {
  NO_STATE,
  TOOLS,
  TOOL_ORDER,
  beginTool,
  endTool,
  fallbackTool,
  isToolAvailable,
  moveTool,
  previewTool,
  toolForShortcut,
  toolOf,
  toolsFor,
} from "./tools";
import type { ToolState } from "./tools";
import { shortcutFor } from "./shortcuts";

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

/**
 * A viewBox point at the **ink centre** of cell `(column, row)` — the anchor
 * the line tool stores for a centre click — shifted by `offset` on both axes.
 */
function pointOf(
  column: number,
  row: number,
  offset = 0,
): { x: number; y: number } {
  const cell = cellSize(CONFIG);
  const ink = inkUnit(CONFIG);
  return {
    x: column * cell + ink / 2 + offset,
    y: row * cell + ink / 2 + offset,
  };
}

/**
 * A pointer that snaps to anchor `(x, y)` of cell `(column, row)`: the ink
 * origin plus the anchor fraction of the ink extent. A half-multiple maps back
 * to itself, so the click stores exactly this anchor.
 */
function anchorPointOf(
  column: number,
  row: number,
  x: number,
  y: number,
): { x: number; y: number } {
  const cell = cellSize(CONFIG);
  const ink = inkUnit(CONFIG);
  return {
    x: column * cell + x * ink,
    y: row * cell + y * ink,
  };
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
function expectErase(state: ToolState): Extract<ToolState, { kind: "erase" }> {
  if (state.kind !== "erase") throw new Error(`expected erase, got ${state.kind}`);
  return state;
}

/* ------------------------------------------------------------------ */
/* Pen                                                                 */
/* ------------------------------------------------------------------ */

describe("PenTool", () => {
  it("connects the cells a fast drag flew over", () => {
    const ctx = context();
    const start = beginTool("pen", ctx, NO_STATE, input(pointOf(1, 1)));
    const moved = moveTool("pen", ctx, start.state, input(pointOf(5, 1)));
    // One pointer event jumped four cells; the stroke is the whole run
    // (docs/CANVAS.md §Pen), not just the two reported positions.
    expect(expectPen(moved.state).anchors).toEqual([
      { column: 1, row: 1, zone: 0 },
      { column: 2, row: 1, zone: 0 },
      { column: 3, row: 1, zone: 0 },
      { column: 4, row: 1, zone: 0 },
      { column: 5, row: 1, zone: 0 },
    ]);
  });

  it("fills each segment of its own sweep, in order and without repeats", () => {
    const ctx = context();
    let state = beginTool("pen", ctx, NO_STATE, input(pointOf(1, 1))).state;
    state = moveTool("pen", ctx, state, input(pointOf(5, 1))).state;
    state = moveTool("pen", ctx, state, input(pointOf(5, 5))).state;

    expect(
      expectPen(state).anchors.map((anchor) => `${anchor.column}:${anchor.row}`),
    ).toEqual([
      "1:1",
      "2:1",
      "3:1",
      "4:1",
      "5:1",
      "5:2",
      "5:3",
      "5:4",
      "5:5",
    ]);

    // Only the segment the pointer just swept is filled: the pen never draws
    // from the stroke's first anchor to the cursor, so a cell off both runs
    // stays blank.
    const keys = new Set(
      expectPen(state).anchors.map((anchor) =>
        tileKey(anchor.column, anchor.row, anchor.zone),
      ),
    );
    expect(keys.has(tileKey(2, 2, 0))).toBe(false);
    expect(keys.has(tileKey(4, 3, 0))).toBe(false);
  });

  it("paints the stem from the live pointer, not the bar's tail (the T)", () => {
    const ctx = context();
    let state = beginTool("pen", ctx, NO_STATE, input(pointOf(1, 4))).state;
    state = moveTool("pen", ctx, state, input(pointOf(5, 4))).state;
    // Without lifting, the pointer walks back along the bar to the junction…
    state = moveTool("pen", ctx, state, input(pointOf(4, 4))).state;
    state = moveTool("pen", ctx, state, input(pointOf(3, 4))).state;
    // … and up: the fill starts where the pointer is, so the stem is the stem
    // and never a chord from the bar's far end.
    state = moveTool("pen", ctx, state, input(pointOf(3, 3))).state;
    state = moveTool("pen", ctx, state, input(pointOf(3, 1))).state;

    expect(
      expectPen(state).anchors.map(
        (anchor) => `${anchor.column}:${anchor.row}`,
      ),
    ).toEqual(["1:4", "2:4", "3:4", "4:4", "5:4", "3:3", "3:2", "3:1"]);
  });

  it("stores nothing when the pointer retraces the stroke", () => {
    const ctx = context();
    let state = beginTool("pen", ctx, NO_STATE, input(pointOf(1, 5))).state;
    state = moveTool("pen", ctx, state, input(pointOf(5, 5))).state;
    const painted = expectPen(state).anchors;
    // Back along every painted cell, to the first one: dedup stores nothing…
    for (const column of [4, 3, 2, 1]) {
      state = moveTool("pen", ctx, state, input(pointOf(column, 5))).state;
    }
    expect(expectPen(state).anchors).toEqual(painted);
    // … and the next fresh cell is still painted from where the pointer is.
    state = moveTool("pen", ctx, state, input(pointOf(1, 4))).state;
    expect(
      expectPen(state).anchors.map(
        (anchor) => `${anchor.column}:${anchor.row}`,
      ),
    ).toEqual(["1:5", "2:5", "3:5", "4:5", "5:5", "1:4"]);
  });

  it("connects the clamped cell when the pointer leaves the board, not the tail", () => {
    const ctx = context();
    let state = beginTool("pen", ctx, NO_STATE, input(pointOf(2, 4))).state;
    state = moveTool("pen", ctx, state, input(pointOf(6, 4))).state;
    // Back to the bar's start, then out of the canvas: the reported position
    // is clamped to (0, 0), and the fill runs from the **live** cell to it —
    // never from the bar's far end across the board (which is what tempted a
    // chord out to the edge).
    for (const column of [5, 4, 3, 2]) {
      state = moveTool("pen", ctx, state, input(pointOf(column, 4))).state;
    }
    state = moveTool("pen", ctx, state, input({ x: -50, y: -50 })).state;
    state = moveTool("pen", ctx, state, input(pointOf(2, 0))).state;

    expect(
      expectPen(state).anchors.map(
        (anchor) => `${anchor.column}:${anchor.row}`,
      ),
    ).toEqual([
      "2:4",
      "3:4",
      "4:4",
      "5:4",
      "6:4",
      "2:3",
      "1:3",
      "1:2",
      "1:1",
      "0:1",
      "0:0",
      "1:0",
      "2:0",
    ]);
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
    // Three fragments — the run the pointer swept, never merged into a bar.
    expect(out.commit?.items).toHaveLength(3);
    expect(out.commit?.items.map((item) => item.type)).toEqual([
      "tile",
      "tile",
      "tile",
    ]);
  });

  it("commits a continuous run of tiles for a far drag", () => {
    const ctx = context();
    const start = beginTool("pen", ctx, NO_STATE, input(pointOf(2, 2)));
    const moved = moveTool("pen", ctx, start.state, input(pointOf(7, 2)));
    const out = endTool("pen", ctx, moved.state);

    expect(out.commit?.items.map((item) => item.key)).toEqual([
      tileKey(2, 2, 0),
      tileKey(3, 2, 0),
      tileKey(4, 2, 0),
      tileKey(5, 2, 0),
      tileKey(6, 2, 0),
      tileKey(7, 2, 0),
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

  it("stores the clicked anchor of the cell under the cursor", () => {
    const ctx = context();
    const first = beginTool("line", ctx, NO_STATE, input(anchorPointOf(1, 1, 1, 1)));
    expect(expectLine(first.state).points).toEqual([
      { column: 1, row: 1, anchor: { x: 1, y: 1 } },
    ]);

    const second = beginTool("line", ctx, first.state, input(anchorPointOf(3, 1, 0, 1)));
    expect(expectLine(second.state).points).toEqual([
      { column: 1, row: 1, anchor: { x: 1, y: 1 } },
      { column: 3, row: 1, anchor: { x: 0, y: 1 } },
    ]);

    // The run is straight, but a mixed-anchor run never merges into tiles: it
    // is stroked through the anchors the designer clicked.
    const out = beginTool("line", ctx, second.state, input(anchorPointOf(3, 1, 0, 1)));
    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.items).toHaveLength(1);
    expect(out.commit?.items[0]).toMatchObject({
      type: "stroke",
      points: [
        { column: 1, row: 1, anchor: { x: 1, y: 1 } },
        { column: 3, row: 1, anchor: { x: 0, y: 1 } },
      ],
    });
  });

  it("hovers an empty run, and its dot is exactly the next click's point", () => {
    const ctx = context();
    const hovered = moveTool("line", ctx, NO_STATE, input(anchorPointOf(2, 2, 1, 0)));
    const state = expectLine(hovered.state);
    expect(state.points).toEqual([]);

    const preview = previewTool("line", ctx, state);
    expect(preview.dot).toEqual({ column: 2, row: 2, anchor: { x: 1, y: 0 } });
    expect(preview.items).toEqual([]);
    expect(preview.marker).toBeNull();

    // The click stores exactly the dot the overlay showed …
    const clicked = beginTool("line", ctx, state, input(anchorPointOf(2, 2, 1, 0)));
    expect(expectLine(clicked.state).points).toEqual([preview.dot]);

    // … and the dot keeps tracking the anchor under the cursor mid-run.
    const moved = moveTool("line", ctx, clicked.state, input(anchorPointOf(5, 1, 0.5, 0)));
    const next = previewTool("line", ctx, moved.state);
    expect(next.dot).toEqual({ column: 5, row: 1, anchor: { x: 0.5, y: 0 } });
    expect(next.marker).toEqual({ column: 2, row: 2, zone: 0 });
  });

  it("previews exactly the run a click commits, anchors and all", () => {
    const ctx = context();
    let state = beginTool("line", ctx, NO_STATE, input(pointOf(1, 1))).state;
    state = beginTool("line", ctx, state, input(anchorPointOf(3, 3, 1, 0))).state;
    const hovered = moveTool("line", ctx, state, input(anchorPointOf(5, 1, 0, 1)));
    const preview = previewTool("line", ctx, hovered.state);
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]).toMatchObject({ type: "stroke" });

    // The pending hover, then clicking it again: the commit stores the very
    // endpoints the ghost drew.
    const extended = beginTool("line", ctx, hovered.state, input(anchorPointOf(5, 1, 0, 1)));
    const out = beginTool("line", ctx, extended.state, input(anchorPointOf(5, 1, 0, 1)));
    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.items).toEqual(preview.items);
  });

  it("accepts two points in one cell and closes on the first point", () => {
    const ctx = context();
    let state = beginTool("line", ctx, NO_STATE, input(anchorPointOf(2, 2, 0, 0))).state;
    // The same cell at a different anchor is a real second point.
    state = beginTool("line", ctx, state, input(anchorPointOf(2, 2, 1, 1))).state;
    expect(expectLine(state).points).toHaveLength(2);
    state = beginTool("line", ctx, state, input(anchorPointOf(2, 2, 1, 0))).state;
    expect(expectLine(state).points).toHaveLength(3);

    // Clicking the first point closes the run instead of extending it.
    const out = beginTool("line", ctx, state, input(anchorPointOf(2, 2, 0, 0)));
    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.items).toHaveLength(1);
    expect(out.commit?.items[0]).toMatchObject({ type: "stroke", closed: true });
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

  it("commits a wire-legal arc from anchor-shaped tool state (the repro)", () => {
    // The tool arms with `inkAnchorAt` results — an `Anchor` is a cell **plus**
    // a zone — and the second click two cells away commits. The stored JSON
    // must hold exactly a `Cell` per endpoint: the leaked `zone` was what the
    // server's `cellValidator` rejected (`applyOps` → ArgumentValidationError).
    const ctx = context();
    const armed = beginTool("arc", ctx, NO_STATE, input(pointOf(3, 33)));
    expect(expectArc(armed.state).from).toEqual({ column: 3, row: 33, zone: 0 });
    const moved = moveTool("arc", ctx, armed.state, input(pointOf(3, 35)));
    const out = beginTool("arc", ctx, moved.state, input(pointOf(3, 35)));

    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.items).toEqual([
      {
        type: "arc",
        key: arcKey({ column: 3, row: 33 }, { column: 3, row: 35 }, "clockwise", "half"),
        from: { column: 3, row: 33 },
        to: { column: 3, row: 35 },
        direction: "clockwise",
        size: "half",
        // The tool stamps the project's ink on what it draws.
        color: CONFIG.ink,
      },
    ]);
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

  it("sweeps the cells a fast drag flew over, not just its endpoints", () => {
    const items = [1, 3, 5].map((column) =>
      makeTile({ column, row: 2, zone: 0 }),
    );
    const ctx = context(items, { tool: "eraser" });

    const start = beginTool("eraser", ctx, NO_STATE, input(pointOf(1, 2)));
    const swept = moveTool("eraser", ctx, start.state, input(pointOf(5, 2)));
    const out = endTool("eraser", ctx, swept.state);

    // Without the sweep the middle tile (3, 2) survives — the pointer never
    // reported a position over it.
    expect(out.commit?.items).toEqual([]);
  });

  it("sweeps from the live pointer when the drag retraces itself", () => {
    const row = [1, 2, 3, 4, 5].map((column) =>
      makeTile({ column, row: 2, zone: 0 }),
    );
    const bystander = makeTile({ column: 3, row: 1, zone: 0 });
    const target = makeTile({ column: 2, row: 0, zone: 0 });
    const ctx = context([...row, bystander, target], { tool: "eraser" });

    let state = beginTool("eraser", ctx, NO_STATE, input(pointOf(1, 2))).state;
    state = moveTool("eraser", ctx, state, input(pointOf(5, 2))).state;
    // Back along the erased row, then up to the target. A sweep fuelled by the
    // stale far end would brush the bystander on its way back — the pointer
    // never crossed it.
    state = moveTool("eraser", ctx, state, input(pointOf(2, 2))).state;
    state = moveTool("eraser", ctx, state, input(pointOf(2, 0))).state;
    const out = endTool("eraser", ctx, state);

    expect(out.commit?.items).toEqual([bystander]);
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

  it("moves the clicked item and commits the whole board", () => {
    const tile = makeTile({ column: 0, row: 0, zone: 0 });
    const other = makeTile({ column: 5, row: 5, zone: 0 });
    const items = [tile, other];
    const ctx = context(items, { tool: "select" });

    const start = beginTool("select", ctx, NO_STATE, input(pointOf(0, 0)));
    expect(start.selection).toEqual([tile.key]);
    const dragged = moveTool("select", ctx, start.state, input(pointOf(2, 1)));
    const out = endTool("select", ctx, dragged.state);

    expect(out.commit?.label).toBe("تحريك");
    // The commit is the **whole board**, moved fragments on top: the document
    // diffs it against what it has (`toOps`), so a commit holding only the
    // fragments would read as "delete everything else".
    expect(out.commit?.items).toEqual(
      moveItems(CONFIG, items, [tile.key], 2, 1),
    );
    expect(out.commit?.items).toHaveLength(items.length);
    expect(out.commit?.items).toContainEqual(other);
    expect(out.commit?.items.map((item) => item.key)).toEqual([
      other.key,
      tileKey(2, 1, 0),
    ]);
    expect(out.commit?.selection).toEqual([tile.key]);
  });
});

/* ------------------------------------------------------------------ */
/* Commits carry the whole board                                       */
/* ------------------------------------------------------------------ */

describe("commits carry the whole board", () => {
  // A `ToolCommit` is diffed against the document (`toOps`), so a tool that
  // returns only its own fragments deletes every other item — the bug that
  // made a drag wipe the canvas. Whatever a gesture does, its commit must hold
  // the items it did not address.
  const untouched = () => makeTile({ column: 40, row: 40, zone: 0 });

  it("pen: keeps fragments it did not paint", () => {
    const board = untouched();
    const ctx = context([board], { tool: "pen" });
    const drawn = beginTool("pen", ctx, NO_STATE, input(pointOf(1, 1)));
    const out = endTool("pen", ctx, drawn.state);
    expect(out.commit?.items).toContainEqual(board);
  });

  it("line: keeps fragments it did not stroke", () => {
    const board = untouched();
    const ctx = context([board], { tool: "line" });
    const first = beginTool("line", ctx, NO_STATE, input(pointOf(1, 1)));
    const extended = beginTool("line", ctx, first.state, input(pointOf(3, 1)));
    // Clicking the last point again ends the run.
    const done = beginTool("line", ctx, extended.state, input(pointOf(3, 1)));
    expect(done.commit?.items).toContainEqual(board);
  });

  it("arc: keeps fragments it did not curve", () => {
    const board = untouched();
    const ctx = context([board], { tool: "arc" });
    const armed = beginTool("arc", ctx, NO_STATE, input(pointOf(1, 1)));
    const done = beginTool("arc", ctx, armed.state, input(pointOf(1, 3)));
    expect(done.commit?.items).toContainEqual(board);
  });

  it("eraser: removes only what it swept", () => {
    const board = untouched();
    const target = makeTile({ column: 1, row: 1, zone: 0 });
    const ctx = context([board, target], { tool: "eraser" });
    const started = beginTool("eraser", ctx, NO_STATE, input(pointOf(1, 1)));
    const out = endTool("eraser", ctx, started.state);
    expect(out.commit?.items).toContainEqual(board);
    expect(out.commit?.items.map((item) => item.key)).not.toContain(target.key);
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

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

describe("tool registry", () => {
  it("holds one class per tool, in rail order, with unique shortcuts", () => {
    expect([...TOOL_ORDER]).toEqual([
      "select",
      "pen",
      "line",
      "eraser",
      "arc",
      "hand",
    ]);
    expect(TOOLS.map((tool) => tool.id)).toEqual([...TOOL_ORDER]);
    expect(new Set(TOOLS.map((tool) => tool.shortcut)).size).toBe(TOOLS.length);
    for (const tool of TOOLS) {
      expect(tool.label).not.toBe("");
      expect(tool.icon.length).toBeGreaterThan(0);
      expect(toolForShortcut(tool.shortcut.toLowerCase())).toBe(tool.id);
      if (tool.hint !== null) expect(tool.hint).not.toBe("");
    }
  });

  it("offers the line and arc tools on a square grid only", () => {
    // The board's grid decides which tools exist (`docs/CANVAS.md` §3): the
    // rail lists `toolsFor`, and the controller falls back to `fallbackTool`.
    expect(toolsFor("square").map((tool) => tool.id)).toEqual([...TOOL_ORDER]);
    expect(toolsFor("circular").map((tool) => tool.id)).toEqual([
      "select",
      "pen",
      "eraser",
      "hand",
    ]);
    expect(isToolAvailable("circular", "line")).toBe(false);
    expect(isToolAvailable("circular", "arc")).toBe(false);
    for (const id of TOOL_ORDER) {
      expect(isToolAvailable("square", id)).toBe(true);
    }
    for (const id of ["select", "pen", "eraser", "hand"] as const) {
      expect(isToolAvailable("circular", id)).toBe(true);
    }
    // The first tool of the rail is always available, on every grid.
    expect(fallbackTool("square")).toBe("select");
    expect(fallbackTool("circular")).toBe("select");
  });

  it("makes their shortcuts inert on a circular grid", () => {
    expect(toolForShortcut("l", "square")).toBe("line");
    expect(toolForShortcut("a", "square")).toBe("arc");
    expect(toolForShortcut("l", "circular")).toBeNull();
    expect(toolForShortcut("L", "circular")).toBeNull();
    expect(toolForShortcut("a", "circular")).toBeNull();
    expect(toolForShortcut("p", "circular")).toBe("pen");
    // Without a grid there is no per-grid filtering (tests, and callers that
    // do not know the board).
    expect(toolForShortcut("l")).toBe("line");

    expect(shortcutFor({ key: "l" }, "square")).toEqual({
      kind: "tool",
      tool: "line",
    });
    expect(shortcutFor({ key: "l" }, "circular")).toBeNull();
    expect(shortcutFor({ key: "a" }, "circular")).toBeNull();
    expect(shortcutFor({ key: "p" }, "circular")).toEqual({
      kind: "tool",
      tool: "pen",
    });
    // The grid does not touch anything else on the map.
    expect(shortcutFor({ key: "r" }, "circular")).toEqual({ kind: "rotate" });
    expect(shortcutFor({ key: "1" }, "circular")).toEqual({
      kind: "shape",
      shape: "square",
    });
  });
});

/* ------------------------------------------------------------------ */
/* Hand                                                                */
/* ------------------------------------------------------------------ */

describe("HandTool", () => {
  it("is the only view tool, and it never touches the document", () => {
    const hand = toolOf("hand");
    expect(hand.pans).toBe(true);
    expect(TOOLS.filter((tool) => tool.pans)).toEqual([hand]);
    expect(hand.label).toBe("يد");
    expect(hand.shortcut).toBe("H");
    expect(hand.cursor).toContain("cursor-grab");
    expect(hand.hint).not.toBeNull();

    const ctx = context();
    for (const outcome of [
      beginTool("hand", ctx, NO_STATE, input(pointOf(1, 1))),
      moveTool("hand", ctx, NO_STATE, input(pointOf(3, 2))),
      endTool("hand", ctx, NO_STATE),
    ]) {
      expect(outcome.state).toEqual(NO_STATE);
      expect(outcome.commit).toBeUndefined();
    }
    const preview = previewTool("hand", ctx, NO_STATE);
    expect(preview.items).toEqual([]);
    expect(preview.marker).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Per-grid item rules                                                 */
/* ------------------------------------------------------------------ */

describe("per-grid rules", () => {
  const CIRCULAR: ProjectConfig = { ...CONFIG, gridType: "circular" };

  it("never erases an item the grid hides", () => {
    // The line lies across row 1, and the pointer sits inside its bar on the
    // square board — the eraser's hit test finds it there. A circular board
    // hides lines, so the same sweep sees nothing (docs/CANVAS.md §3).
    const hidden = makeLine({ column: 1, row: 1 }, { column: 4, row: 1 });

    const square = context([hidden], { tool: "eraser" });
    const hit = beginTool("eraser", square, NO_STATE, input(pointOf(1, 1)));
    expect(expectErase(hit.state).keys).toEqual([hidden.key]);

    const circular = context([hidden], { tool: "eraser", config: CIRCULAR });
    const start = beginTool("eraser", circular, NO_STATE, input(pointOf(1, 1)));
    expect(expectErase(start.state).keys).toEqual([]);
    const out = endTool("eraser", circular, start.state);
    expect(out.commit).toBeUndefined();
    // Hidden, not deleted: the item is still on the board, untouched.
    expect(circular.items).toContain(hidden);
  });
});
