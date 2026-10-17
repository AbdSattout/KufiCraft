import { describe, expect, it } from "vitest";
import { tileKey } from "@/lib/canvas/model";
import type { CanvasItem } from "@/lib/canvas/model";
import {
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  pushHistory,
  redoHistory,
  undoHistory,
} from "./history";
import type { HistoryEntry } from "./history";

function entry(i: number): HistoryEntry {
  const items: CanvasItem[] = [
    { type: "tile", key: tileKey(i, 0, 0), column: i, row: 0, zone: 0 },
  ];
  return { items, selection: [], label: "رسم" };
}

describe("history stack", () => {
  it("starts empty", () => {
    expect(canUndo(EMPTY_HISTORY)).toBe(false);
    expect(canRedo(EMPTY_HISTORY)).toBe(false);
  });

  it("undoes and redoes in order", () => {
    const state = pushHistory(pushHistory(EMPTY_HISTORY, entry(0)), entry(1));
    const undo = undoHistory(state, entry(2));
    expect(undo?.entry.items).toEqual(entry(1).items);
    expect(canUndo(undo!.state)).toBe(true);
    expect(canRedo(undo!.state)).toBe(true);

    const redo = redoHistory(undo!.state, entry(1));
    expect(redo?.entry.items).toEqual(entry(2).items);
    expect(canRedo(redo!.state)).toBe(false);
  });

  it("stops at the ends of the stack", () => {
    expect(undoHistory(EMPTY_HISTORY, entry(0))).toBeNull();
    expect(redoHistory(EMPTY_HISTORY, entry(0))).toBeNull();
  });

  it("drops the redo branch when a new action is recorded", () => {
    const undone = undoHistory(pushHistory(EMPTY_HISTORY, entry(0)), entry(1));
    const recorded = pushHistory(undone!.state, entry(5));
    expect(canRedo(recorded)).toBe(false);
    expect(undoHistory(recorded, entry(6))?.entry.items).toEqual(entry(5).items);
  });

  it("keeps at most HISTORY_LIMIT entries (oldest dropped)", () => {
    let state = EMPTY_HISTORY;
    for (let index = 0; index < HISTORY_LIMIT + 10; index++) {
      state = pushHistory(state, entry(index));
    }
    expect(state.past).toHaveLength(HISTORY_LIMIT);
    expect(state.past[0].items).toEqual(entry(10).items);
    expect(state.past[HISTORY_LIMIT - 1].items).toEqual(
      entry(HISTORY_LIMIT + 9).items,
    );
  });
});
