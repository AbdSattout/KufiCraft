import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_CONFIG,
  RATIO_PRESETS,
  arcKey,
  cellSize,
  linePoint,
  tileKey,
} from "@/lib/canvas/model";
import type { CanvasItem, ProjectConfig, Zone } from "@/lib/canvas/model";
import { linePointPosition } from "@/lib/canvas/grid";
import { inkUnit } from "@/lib/canvas/geometry";
import { makeArc, makeLine, makeTile } from "@/lib/canvas/items";
import {
  DEFAULT_ARC_STYLE,
  DEFAULT_STYLE,
  moveItems,
} from "./interaction";
import type { MoveOffset, ToolContext } from "./interaction";
import {
  NO_STATE,
  TOOLS,
  TOOL_ORDER,
  beginTool,
  endTool,
  fallbackTool,
  isToolAvailable,
  leaveTool,
  moveTool,
  previewTool,
  toolForShortcut,
  toolOf,
  toolsFor,
} from "./tools";
import type { ToolState } from "./tools";
import { shortcutFor } from "./shortcuts";
import {
  EMPTY_HISTORY,
  pushHistory,
  redoHistory,
  undoHistory,
} from "./history";

const CONFIG: ProjectConfig = { ...DEFAULT_PROJECT_CONFIG, base: 10 };
/** The equal 1:1 cell, where the four fragments are congruent. */
const EQUAL: ProjectConfig = { ...CONFIG, ratio: RATIO_PRESETS[0].ratio };

/** A move offset: whole cells plus signed half-cell steps. */
function move(
  dColumn: number,
  dRow: number,
  dHalfColumn = 0,
  dHalfRow = 0,
): MoveOffset {
  return { dColumn, dRow, dHalfColumn, dHalfRow };
}

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
    smartPoints: false,
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
  // A real pointer never lands exactly on a fragment border, and the zone
  // convention is half-open: an edge anchor is nudged a hair inside the
  // fragment it belongs to, so the click still addresses the ink square.
  const along = (fraction: number, index: number) => {
    if (fraction === 1) return ink - 1e-6;
    if (fraction === 0 && index > 0) return 1e-6;
    return fraction * ink;
  };
  return {
    x: column * cell + along(x, column),
    y: row * cell + along(y, row),
  };
}

/** A pointer at the **centre** of fragment `zone` of cell `(column, row)`. */
function fragmentPointOf(
  column: number,
  row: number,
  zone: Zone,
  config: ProjectConfig = CONFIG,
): { x: number; y: number } {
  return linePointPosition(config, linePoint(column, row, zone));
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

/** The unique cells of a pen run, in paint order — zones filtered out. */
function paintedCells(
  anchors: ReadonlyArray<{ column: number; row: number }>,
): string[] {
  return [
    ...new Set(anchors.map((anchor) => `${anchor.column}:${anchor.row}`)),
  ];
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
    // (docs/CANVAS.md §Pen), not just the two reported positions. The pointer
    // also swept the x-space strip of each crossed cell, so both fragments are
    // painted — the same fragments a slow drag would have painted.
    expect(expectPen(moved.state).anchors).toEqual([
      { column: 1, row: 1, zone: 0 },
      { column: 1, row: 1, zone: 1 },
      { column: 2, row: 1, zone: 0 },
      { column: 2, row: 1, zone: 1 },
      { column: 3, row: 1, zone: 0 },
      { column: 3, row: 1, zone: 1 },
      { column: 4, row: 1, zone: 0 },
      { column: 4, row: 1, zone: 1 },
      { column: 5, row: 1, zone: 0 },
    ]);
  });

  it("fills each segment of its own sweep, in order and without repeats", () => {
    const ctx = context();
    let state = beginTool("pen", ctx, NO_STATE, input(pointOf(1, 1))).state;
    state = moveTool("pen", ctx, state, input(pointOf(5, 1))).state;
    state = moveTool("pen", ctx, state, input(pointOf(5, 5))).state;

    expect(paintedCells(expectPen(state).anchors)).toEqual([
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

    expect(paintedCells(expectPen(state).anchors)).toEqual([
      "1:4",
      "2:4",
      "3:4",
      "4:4",
      "5:4",
      "3:3",
      "3:2",
      "3:1",
    ]);
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
    expect(paintedCells(expectPen(state).anchors)).toEqual([
      "1:5",
      "2:5",
      "3:5",
      "4:5",
      "5:5",
      "1:4",
    ]);
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

    expect(paintedCells(expectPen(state).anchors)).toEqual([
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
    // Three swept cells become five fragments: the ink square and the x-space
    // strip of the first two, then the ink square of the last — never merged
    // into a bar.
    expect(out.commit?.items).toHaveLength(5);
    expect(out.commit?.items.map((item) => item.type)).toEqual([
      "tile",
      "tile",
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
      tileKey(2, 2, 1),
      tileKey(3, 2, 0),
      tileKey(3, 2, 1),
      tileKey(4, 2, 0),
      tileKey(4, 2, 1),
      tileKey(5, 2, 0),
      tileKey(5, 2, 1),
      tileKey(6, 2, 0),
      tileKey(6, 2, 1),
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

  it("draws on space fragments exactly as on ink ones", () => {
    const ctx = context();
    let state = beginTool("line", ctx, NO_STATE, input(fragmentPointOf(1, 1, 1))).state;
    state = beginTool("line", ctx, state, input(fragmentPointOf(3, 1, 1))).state;
    const out = beginTool("line", ctx, state, input(fragmentPointOf(3, 1, 1)));

    expect(out.state).toBe(NO_STATE);
    // The same squares the ink run draws — on the x-space stripe the designer
    // clicked, with the in-between cell taking the run's target zone.
    expect(out.commit?.items).toEqual([
      makeTile({ column: 1, row: 1, zone: 1, color: CONFIG.ink }),
      makeTile({ column: 2, row: 1, zone: 1, color: CONFIG.ink }),
      makeTile({ column: 3, row: 1, zone: 1, color: CONFIG.ink }),
    ]);
  });

  it("keeps each clicked fragment's zone in a mixed run", () => {
    const ctx = context();
    let state = beginTool("line", ctx, NO_STATE, input(pointOf(1, 1))).state;
    state = beginTool("line", ctx, state, input(fragmentPointOf(3, 1, 1))).state;
    const out = beginTool("line", ctx, state, input(fragmentPointOf(3, 1, 1)));
    expect(out.commit?.items.map((item) => item.key)).toEqual([
      tileKey(1, 1, 0),
      tileKey(2, 1, 1),
      tileKey(3, 1, 1),
    ]);
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
    // The marker is the actual first point, not its whole cell.
    expect(preview.marker).toEqual({ column: 1, row: 1 });
  });

  it("keeps the first point's fragment in the run marker", () => {
    const ctx = context();
    const first = beginTool(
      "line",
      ctx,
      NO_STATE,
      input(fragmentPointOf(2, 2, 3)),
    ).state;
    const hovered = moveTool("line", ctx, first, input(fragmentPointOf(4, 2, 3)));
    const preview = previewTool("line", ctx, hovered.state);
    expect(preview.marker).toEqual({ column: 2, row: 2, zone: 3 });
    expect(preview.dot).toEqual({ column: 4, row: 2, zone: 3 });
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

  it("uses the fragment centre in smart mode, on both the dot and the click", () => {
    const ctx = context([], { smartPoints: true });
    // Clicking the bottom-right corner usually stores that anchor; smart mode
    // keeps the fragment (ink cell 1,1) and stores its centre instead.
    const first = beginTool(
      "line",
      ctx,
      NO_STATE,
      input(anchorPointOf(1, 1, 1, 1)),
    );
    expect(expectLine(first.state).points).toEqual([
      { column: 1, row: 1 },
    ]);

    const hovered = moveTool(
      "line",
      ctx,
      first.state,
      input(anchorPointOf(4, 2, 0, 0)),
    );
    const preview = previewTool("line", ctx, hovered.state);
    expect(preview.marker).toEqual({ column: 1, row: 1 });
    expect(preview.dot).toEqual({ column: 4, row: 2 });

    const clicked = beginTool(
      "line",
      ctx,
      hovered.state,
      input(anchorPointOf(4, 2, 0, 0)),
    );
    expect(expectLine(clicked.state).points).toEqual([
      { column: 1, row: 1 },
      { column: 4, row: 2 },
    ]);
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
    // … while the marker stays on the anchored first point.
    expect(next.marker).toEqual({ column: 2, row: 2, anchor: { x: 1, y: 0 } });
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

  it("commits the clicked points when another tool is chosen", () => {
    const ctx = context();
    let state = beginTool("line", ctx, NO_STATE, input(pointOf(1, 1))).state;
    state = beginTool("line", ctx, state, input(pointOf(3, 3))).state;
    state = beginTool("line", ctx, state, input(pointOf(5, 3))).state;
    expect(expectLine(state).points).toHaveLength(3);

    const out = leaveTool("line", "pen", ctx, state);
    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.label).toBe("خط");
    expect(out.commit?.items).toHaveLength(1);
    expect(out.commit?.items[0]).toMatchObject({ type: "stroke" });
  });

  it("commits a two-point run too", () => {
    const ctx = context();
    const first = beginTool("line", ctx, NO_STATE, input(pointOf(1, 1)));
    const second = beginTool("line", ctx, first.state, input(pointOf(3, 1)));

    const out = leaveTool("line", "pen", ctx, second.state);
    expect(out.commit?.items).toEqual([
      makeTile({ column: 1, row: 1, zone: 0, color: CONFIG.ink }),
      makeTile({ column: 2, row: 1, zone: 0, color: CONFIG.ink }),
      makeTile({ column: 3, row: 1, zone: 0, color: CONFIG.ink }),
    ]);
  });

  it("discards a pending run when the line tool is chosen again", () => {
    const ctx = context();
    let state = beginTool("line", ctx, NO_STATE, input(pointOf(1, 1))).state;
    state = beginTool("line", ctx, state, input(pointOf(3, 1))).state;

    expect(leaveTool("line", "line", ctx, state)).toEqual({ state: NO_STATE });
  });

  it("drops a one-point run when another tool is chosen", () => {
    const ctx = context();
    const first = beginTool("line", ctx, NO_STATE, input(pointOf(1, 1)));

    expect(leaveTool("line", "pen", ctx, first.state)).toEqual({
      state: NO_STATE,
    });
  });
});

/* ------------------------------------------------------------------ */
/* Arc                                                                 */
/* ------------------------------------------------------------------ */

describe("ArcTool", () => {
  it("arms on the clicked point, survives pointer-up and cancels on the origin cell", () => {
    const ctx = context();
    const armed = beginTool("arc", ctx, NO_STATE, input(pointOf(1, 1)));
    // The centre is a real choice for an arc endpoint, so the click is stored
    // whole — cell *and* anchor.
    const from = {
      column: 1,
      row: 1,
      anchor: { x: 0.5, y: 0.5 },
    };
    expect(expectArc(armed.state).from).toEqual(from);
    expect(expectArc(armed.state).to).toEqual(from);

    const up = endTool("arc", ctx, armed.state);
    expect(up.keep).toBe(true);
    expect(up.state).toBe(armed.state);

    const cancelled = beginTool("arc", ctx, armed.state, input(pointOf(1, 1)));
    expect(cancelled.state).toBe(NO_STATE);
    expect(cancelled.commit).toBeUndefined();
  });

  it("cancels a second click on another anchor of the start cell", () => {
    const ctx = context();
    const armed = beginTool(
      "arc",
      ctx,
      NO_STATE,
      input(anchorPointOf(1, 1, 0, 0)),
    ).state;
    // A different anchor in the same cell is still a degenerate pair.
    const out = beginTool("arc", ctx, armed, input(anchorPointOf(1, 1, 1, 1)));
    expect(out.state).toBe(NO_STATE);
    expect(out.commit).toBeUndefined();
  });

  it("stores the clicked anchors on the committed arc", () => {
    const ctx = context();
    const armed = beginTool(
      "arc",
      ctx,
      NO_STATE,
      input(anchorPointOf(1, 1, 0, 1)),
    ).state;
    const moved = moveTool("arc", ctx, armed, input(anchorPointOf(4, 1, 1, 1))).state;
    const out = beginTool("arc", ctx, moved, input(anchorPointOf(4, 1, 1, 1)));

    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.label).toBe("قوس");
    expect(out.commit?.items[0]).toMatchObject({
      type: "arc",
      from: { column: 1, row: 1, anchor: { x: 0, y: 1 } },
      to: { column: 4, row: 1, anchor: { x: 1, y: 1 } },
    });
  });

  it("uses the pair rule in smart mode, on the dots and the stored arc", () => {
    const ctx = context([], {
      smartPoints: true,
      arc: { direction: "clockwise", size: "half" },
    });
    const armed = beginTool(
      "arc",
      ctx,
      NO_STATE,
      input(anchorPointOf(1, 1, 0, 0)),
    ).state;
    const moved = moveTool(
      "arc",
      ctx,
      armed,
      input(anchorPointOf(4, 1, 1, 1)),
    );
    const preview = previewTool("arc", ctx, moved.state);
    // A horizontal chord sits on the bottom middles for clockwise.
    expect(preview.marker).toEqual({
      column: 1,
      row: 1,
      anchor: { x: 0.5, y: 1 },
    });
    expect(preview.dot).toEqual({
      column: 4,
      row: 1,
      anchor: { x: 0.5, y: 1 },
    });
    expect(preview.items).toHaveLength(1);

    const out = beginTool(
      "arc",
      ctx,
      moved.state,
      input(anchorPointOf(4, 1, 1, 1)),
    );
    expect(out.commit?.items).toEqual(preview.items);
    expect(out.commit?.items[0]).toMatchObject({
      type: "arc",
      from: { column: 1, row: 1, anchor: { x: 0.5, y: 1 } },
      to: { column: 4, row: 1, anchor: { x: 0.5, y: 1 } },
    });
  });

  it("puts a smart vertical chord on the right for counterclockwise", () => {
    const ctx = context([], {
      smartPoints: true,
      arc: { direction: "counterclockwise", size: "half" },
    });
    const armed = beginTool(
      "arc",
      ctx,
      NO_STATE,
      input(anchorPointOf(2, 1, 0, 0)),
    ).state;
    const moved = moveTool(
      "arc",
      ctx,
      armed,
      input(anchorPointOf(2, 4, 1, 1)),
    ).state;
    const out = beginTool(
      "arc",
      ctx,
      moved,
      input(anchorPointOf(2, 4, 1, 1)),
    );

    expect(out.commit?.items[0]).toMatchObject({
      type: "arc",
      from: { column: 2, row: 1, anchor: { x: 1, y: 0.5 } },
      to: { column: 2, row: 4, anchor: { x: 1, y: 0.5 } },
      direction: "counterclockwise",
    });
  });

  it("uses both fragment centres for a smart diagonal", () => {
    const ctx = context([], { smartPoints: true });
    const armed = beginTool(
      "arc",
      ctx,
      NO_STATE,
      input(anchorPointOf(1, 1, 0, 0)),
    ).state;
    const moved = moveTool(
      "arc",
      ctx,
      armed,
      input(anchorPointOf(4, 4, 1, 1)),
    ).state;
    const out = beginTool(
      "arc",
      ctx,
      moved,
      input(anchorPointOf(4, 4, 1, 1)),
    );

    expect(out.commit?.items[0]).toMatchObject({
      type: "arc",
      from: { column: 1, row: 1, anchor: { x: 0.5, y: 0.5 } },
      to: { column: 4, row: 4, anchor: { x: 0.5, y: 0.5 } },
    });
  });

  it("shows the pending start as a dot before the first click", () => {
    const ctx = context();
    const hovered = moveTool("arc", ctx, NO_STATE, input(anchorPointOf(2, 2, 1, 0)));
    const state = expectArc(hovered.state);
    expect(state.from).toBeNull();
    expect(state.to).toEqual({ column: 2, row: 2, anchor: { x: 1, y: 0 } });

    const preview = previewTool("arc", ctx, state);
    expect(preview.items).toEqual([]);
    expect(preview.marker).toBeNull();
    expect(preview.dot).toEqual({ column: 2, row: 2, anchor: { x: 1, y: 0 } });

    // The click arms exactly the dot the overlay showed.
    const armed = beginTool("arc", ctx, state, input(anchorPointOf(2, 2, 1, 0)));
    expect(expectArc(armed.state).from).toEqual(preview.dot);
  });

  it("tracks the end point on hover and previews the arc plus the two dots", () => {
    const ctx = context();
    const armed = beginTool(
      "arc",
      ctx,
      NO_STATE,
      input(anchorPointOf(1, 1, 0, 0)),
    ).state;
    const moved = moveTool("arc", ctx, armed, input(anchorPointOf(4, 1, 1, 0)));
    expect(expectArc(moved.state).to).toEqual({
      column: 4,
      row: 1,
      anchor: { x: 1, y: 0 },
    });

    const preview = previewTool("arc", ctx, moved.state);
    expect(preview.mode).toBe("ghost");
    // The marker is the armed start point; the dot is the pending end.
    expect(preview.marker).toEqual({ column: 1, row: 1, anchor: { x: 0, y: 0 } });
    expect(preview.dot).toEqual({ column: 4, row: 1, anchor: { x: 1, y: 0 } });
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0].type).toBe("arc");
  });

  it("arms on the fragment clicked and tracks its quadrant", () => {
    const ctx = context();
    const centre = { x: 0.5, y: 0.5 };
    const armed = beginTool("arc", ctx, NO_STATE, input(fragmentPointOf(1, 1, 3)));
    expect(expectArc(armed.state).from).toEqual({
      column: 1,
      row: 1,
      zone: 3,
      anchor: centre,
    });
    // Moving within the same cell but to another quadrant moves the end: a
    // point on a space fragment is not a point on the ink one.
    const moved = moveTool("arc", ctx, armed.state, input(fragmentPointOf(1, 1, 1)));
    expect(expectArc(moved.state).to).toEqual({
      column: 1,
      row: 1,
      zone: 1,
      anchor: centre,
    });
  });

  it("commits an arc between space fragments, zones and all", () => {
    const centre = { x: 0.5, y: 0.5 };
    const ctx = context();
    const armed = beginTool("arc", ctx, NO_STATE, input(fragmentPointOf(1, 1, 1))).state;
    const moved = moveTool("arc", ctx, armed, input(fragmentPointOf(4, 1, 1))).state;
    const out = beginTool("arc", ctx, moved, input(fragmentPointOf(4, 1, 1)));

    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.items).toEqual([
      {
        type: "arc",
        key: arcKey(
          { column: 1, row: 1, zone: 1, anchor: centre },
          { column: 4, row: 1, zone: 1, anchor: centre },
          "clockwise",
          "half",
        ),
        from: { column: 1, row: 1, zone: 1, anchor: centre },
        to: { column: 4, row: 1, zone: 1, anchor: centre },
        direction: "clockwise",
        size: "half",
        color: CONFIG.ink,
      },
    ]);
  });

  it("previews exactly the arc a click commits, anchors and all", () => {
    const ctx = context();
    const armed = beginTool(
      "arc",
      ctx,
      NO_STATE,
      input(anchorPointOf(1, 1, 0, 1)),
    ).state;
    const moved = moveTool("arc", ctx, armed, input(anchorPointOf(4, 1, 1, 1))).state;
    const preview = previewTool("arc", ctx, moved);
    const out = beginTool("arc", ctx, moved, input(anchorPointOf(4, 1, 1, 1)));

    expect(out.commit?.items).toEqual(preview.items);
  });

  it("commits a drag from A to B on pointer-up", () => {
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
    const centre = { x: 0.5, y: 0.5 };
    const existing = makeArc({
      from: { column: 1, row: 1, anchor: centre },
      to: { column: 4, row: 1, anchor: centre },
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

  it("commits a wire-legal arc from point-shaped tool state (the repro)", () => {
    // The tool arms with the point `arcPointAt` resolved — cell, zone and
    // anchor — and the second click two cells away commits. The stored JSON
    // must hold exactly `{column, row, anchor}` per endpoint: the ink zone is
    // canonical absence, so no `zone` leaks, and the centre anchor is kept
    // because an absent anchor means the legacy spring point on an arc.
    const ctx = context();
    const armed = beginTool("arc", ctx, NO_STATE, input(pointOf(3, 33)));
    const centre = { x: 0.5, y: 0.5 };
    expect(expectArc(armed.state).from).toEqual({
      column: 3,
      row: 33,
      anchor: centre,
    });
    const moved = moveTool("arc", ctx, armed.state, input(pointOf(3, 35)));
    const out = beginTool("arc", ctx, moved.state, input(pointOf(3, 35)));

    expect(out.state).toBe(NO_STATE);
    expect(out.commit?.items).toEqual([
      {
        type: "arc",
        key: arcKey(
          { column: 3, row: 33, anchor: centre },
          { column: 3, row: 35, anchor: centre },
          "clockwise",
          "half",
        ),
        from: { column: 3, row: 33, anchor: centre },
        to: { column: 3, row: 35, anchor: centre },
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

  it("erases a space fragment clicked on its own square", () => {
    const space = makeTile({ column: 2, row: 2, zone: 3 });
    const ctx = context([space], { tool: "eraser", selection: [space.key] });
    const start = beginTool("eraser", ctx, NO_STATE, input(fragmentPointOf(2, 2, 3)));
    const out = endTool("eraser", ctx, start.state);
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

  it("sweeps a fast drag through the fragment its zone names", () => {
    // A fast drag between two space fragments; the middle cell is never
    // reported. The sweep must brush the space fragment (zone 3), not the ink
    // square that shares the cell.
    const start = makeTile({ column: 1, row: 2, zone: 3 });
    const middle = makeTile({ column: 3, row: 2, zone: 3 });
    const end = makeTile({ column: 5, row: 2, zone: 3 });
    const inkBystander = makeTile({ column: 3, row: 2, zone: 0 });
    const ctx = context([start, middle, end, inkBystander], { tool: "eraser" });

    const begun = beginTool(
      "eraser",
      ctx,
      NO_STATE,
      input(fragmentPointOf(1, 2, 3)),
    );
    const swept = moveTool(
      "eraser",
      ctx,
      begun.state,
      input(fragmentPointOf(5, 2, 3)),
    );
    const out = endTool("eraser", ctx, swept.state);

    // The dragged space run is gone; the ink square of the swept cell is not.
    expect(out.commit?.items).toEqual([inkBystander]);
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

  it("brushes the neighbouring tile without erasing the line above it", () => {
    // The line is topmost. Its exact bar starts at row 1; the tile sits in the
    // y-space strip of row 0, one unit above the bar. The old ink/2 padding
    // reached into that strip, so the eraser would have hit the line first and
    // deleted it instead of the tile the pointer was on.
    const line = makeLine({ column: 0, row: 1 }, { column: 4, row: 1 });
    const neighbour = makeTile({ column: 1, row: 0, zone: 2 });
    const ctx = context([neighbour, line], { tool: "eraser" });

    const start = beginTool("eraser", ctx, NO_STATE, input(fragmentPointOf(1, 0, 2)));
    const out = endTool("eraser", ctx, start.state);

    expect(out.commit?.items).toEqual([line]);
  });

  it("brushes the neighbouring tile without erasing the arc above it", () => {
    // The arc is topmost and its left spring point is on the ink edge of row
    // 6. The tile's centre is one row below that point, 6.27 units away: inside
    // the old full-ink tolerance (7.52) but well outside the painted ink/2
    // band (3.76).
    const rib = makeArc({
      from: { column: 0, row: 6 },
      to: { column: 4, row: 6 },
      direction: "clockwise",
      size: "half",
    });
    const neighbour = makeTile({ column: 0, row: 7, zone: 0 });
    const ctx = context([neighbour, rib], { tool: "eraser" });

    const start = beginTool("eraser", ctx, NO_STATE, input(pointOf(0, 7)));
    const out = endTool("eraser", ctx, start.state);

    expect(out.commit?.items).toEqual([rib]);
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
      moveItems(CONFIG, items, [tile.key], move(2, 1)),
    );
    expect(out.commit?.items).toHaveLength(items.length);
    expect(out.commit?.items).toContainEqual(other);
    expect(out.commit?.items.map((item) => item.key)).toEqual([
      other.key,
      tileKey(2, 1, 0),
    ]);
    // The key embeds the cell: the moved fragment's selection must follow it
    // to its new identity, or the next render drops the selection.
    expect(out.commit?.selection).toEqual([tileKey(2, 1, 0)]);
    expect(out.commit?.selection).not.toContain(tile.key);
    const selected = new Set(out.commit?.selection);
    expect(out.commit?.items.some((item) => selected.has(item.key))).toBe(true);
  });

  it("keeps a multi-selection on every moved item", () => {
    const first = makeTile({ column: 0, row: 0, zone: 0 });
    const second = makeTile({ column: 2, row: 0, zone: 0 });
    const untouched = makeTile({ column: 8, row: 8, zone: 0 });
    const items = [first, second, untouched];
    const ctx = context(items, {
      tool: "select",
      selection: [first.key, second.key],
    });

    const start = beginTool("select", ctx, NO_STATE, input(pointOf(0, 0)));
    expect(start.selection).toEqual([first.key, second.key]);
    const dragged = moveTool("select", ctx, start.state, input(pointOf(1, 2)));
    const out = endTool("select", ctx, dragged.state);

    expect(out.commit?.selection).toEqual([
      tileKey(1, 2, 0),
      tileKey(3, 2, 0),
    ]);
    const selected = new Set(out.commit?.selection);
    const boardKeys = new Set(out.commit?.items.map((item) => item.key));
    for (const key of selected) expect(boardKeys.has(key)).toBe(true);
    expect(selected.has(untouched.key)).toBe(false);
  });

  it("keeps undo on the old keys and redo on the new ones", () => {
    const tile = makeTile({ column: 0, row: 0, zone: 0 });
    const ctx = context([tile], { tool: "select", selection: [tile.key] });
    const start = beginTool("select", ctx, NO_STATE, input(pointOf(0, 0)));
    const dragged = moveTool("select", ctx, start.state, input(pointOf(2, 1)));
    const out = endTool("select", ctx, dragged.state);
    const movedKey = tileKey(2, 1, 0);

    // The controller records the pre-move state as the undo entry.
    const history = pushHistory(EMPTY_HISTORY, {
      items: ctx.items,
      selection: start.selection ?? [],
      label: "تحريك",
    });
    const afterMove = {
      items: out.commit?.items ?? [],
      selection: out.commit?.selection ?? [],
      label: "تحريك",
    };
    const undo = undoHistory(history, afterMove);
    expect(undo?.entry.selection).toEqual([tile.key]);
    expect(undo?.entry.items.map((item) => item.key)).toContain(tile.key);

    // Undo restores the old board and selection; redo gets the moved state,
    // whose selection already points at the new keys.
    const redo = redoHistory(undo!.state, undo!.entry);
    expect(redo?.entry.selection).toEqual([movedKey]);
    expect(redo?.entry.items.map((item) => item.key)).toContain(movedKey);
  });

  it("moves between zones within one cell at 1:1", () => {
    const tile = makeTile({ column: 2, row: 2, zone: 0 });
    const ctx = context([tile], { config: EQUAL, tool: "select" });
    const start = beginTool(
      "select",
      ctx,
      NO_STATE,
      input(fragmentPointOf(2, 2, 0, EQUAL)),
    );
    const dragged = moveTool(
      "select",
      ctx,
      start.state,
      input(fragmentPointOf(2, 2, 1, EQUAL)),
    );

    // The preview is the commit: both resolve the same signed half-cell step.
    expect(previewTool("select", ctx, dragged.state).items).toEqual([
      makeTile({ column: 2, row: 2, zone: 1 }),
    ]);
    const out = endTool("select", ctx, dragged.state);
    expect(out.commit?.items).toEqual([
      makeTile({ column: 2, row: 2, zone: 1 }),
    ]);
    expect(out.commit?.selection).toEqual([tileKey(2, 2, 1)]);
  });

  it("combines a zone change with a cell move at 1:1", () => {
    const tile = makeTile({ column: 2, row: 2, zone: 0 });
    const ctx = context([tile], { config: EQUAL, tool: "select" });
    const start = beginTool(
      "select",
      ctx,
      NO_STATE,
      input(fragmentPointOf(2, 2, 0, EQUAL)),
    );
    const dragged = moveTool(
      "select",
      ctx,
      start.state,
      input(fragmentPointOf(4, 3, 2, EQUAL)),
    );
    const out = endTool("select", ctx, dragged.state);

    expect(out.commit?.items).toEqual([
      makeTile({ column: 4, row: 3, zone: 2 }),
    ]);
    expect(out.commit?.selection).toEqual([tileKey(4, 3, 2)]);
  });

  it("applies the same half-cell translation to a multi-selection", () => {
    const first = makeTile({ column: 2, row: 2, zone: 0 });
    const second = makeTile({ column: 5, row: 2, zone: 1 });
    const ctx = context([first, second], {
      config: EQUAL,
      tool: "select",
      selection: [first.key, second.key],
    });
    const start = beginTool(
      "select",
      ctx,
      NO_STATE,
      input(fragmentPointOf(2, 2, 0, EQUAL)),
    );
    // The pointer moves 1½ cells (left half of cell 2 to right half of cell
    // 3), so every fragment moves 1½ cells: the right-hand zone 1 carries
    // into the ink half of cell 7, it does not flip back left.
    const dragged = moveTool(
      "select",
      ctx,
      start.state,
      input(fragmentPointOf(3, 2, 1, EQUAL)),
    );
    const out = endTool("select", ctx, dragged.state);

    expect(out.commit?.selection).toEqual([
      tileKey(3, 2, 1),
      tileKey(7, 2, 0),
    ]);
    expect(out.commit?.items.map((item) => item.key)).toEqual([
      tileKey(3, 2, 1),
      tileKey(7, 2, 0),
    ]);
  });

  it("keeps zones on denser grids", () => {
    const tile = makeTile({ column: 2, row: 2, zone: 0 });
    const ctx = context([tile], { tool: "select" });
    const start = beginTool(
      "select",
      ctx,
      NO_STATE,
      input(fragmentPointOf(2, 2, 0)),
    );
    const dragged = moveTool(
      "select",
      ctx,
      start.state,
      input(fragmentPointOf(3, 3, 1)),
    );
    const out = endTool("select", ctx, dragged.state);

    // The pointer changed zone, but at 1:2+ that would resize the fragment.
    expect(out.commit?.items).toEqual([
      makeTile({ column: 3, row: 3, zone: 0 }),
    ]);
    expect(out.commit?.selection).toEqual([tileKey(3, 3, 0)]);
  });

  it("clamps the pointer at the edge without inventing a half step", () => {
    // Last column, middle row: a pointer dragged off the right edge clamps
    // into the last cell's ink half, so there is no x half step at all; the
    // y half step still applies.
    const tile = makeTile({ column: 99, row: 50, zone: 0 });
    const ctx = context([tile], { config: EQUAL, tool: "select" });
    const start = beginTool(
      "select",
      ctx,
      NO_STATE,
      input(fragmentPointOf(99, 50, 0, EQUAL)),
    );
    const dragged = moveTool(
      "select",
      ctx,
      start.state,
      input({ x: 2_000, y: fragmentPointOf(99, 50, 2, EQUAL).y }),
    );
    const out = endTool("select", ctx, dragged.state);

    expect(out.commit?.items).toEqual([
      makeTile({ column: 99, row: 50, zone: 2 }),
    ]);
    expect(out.commit?.selection).toEqual([tileKey(99, 50, 2)]);
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
