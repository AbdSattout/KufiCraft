/**
 * KufiCraft — editor undo/redo history (pure, no React).
 *
 * Every completed gesture pushes the *previous* document state, so `undo`
 * restores it and moves the current state onto the redo stack. Entries are
 * plain item snapshots: the caller replays them as a `replace` op, which is
 * exactly what the backend's `applyOps` expects.
 */

import type { CanvasItem } from "@/lib/canvas/model";

/** Hard cap of the local stack (docs/UI.md §Editor). */
export const HISTORY_LIMIT = 50;

export interface HistoryEntry {
  items: readonly CanvasItem[];
  selection: readonly string[];
  /** Arabic label of the action that created the entry. */
  label: string;
}

export interface HistoryState {
  past: readonly HistoryEntry[];
  future: readonly HistoryEntry[];
}

export const EMPTY_HISTORY: HistoryState = { past: [], future: [] };

/** Records `entry` as the state to come back to; drops the redo branch. */
export function pushHistory(
  state: HistoryState,
  entry: HistoryEntry,
): HistoryState {
  const past = [...state.past, entry];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    future: [],
  };
}

export interface HistoryMove {
  state: HistoryState;
  entry: HistoryEntry;
}

/** Pops the previous state, keeping `current` for redo. */
export function undoHistory(
  state: HistoryState,
  current: HistoryEntry,
): HistoryMove | null {
  const entry = state.past[state.past.length - 1];
  if (!entry) return null;
  return {
    state: {
      past: state.past.slice(0, -1),
      future: [...state.future, current],
    },
    entry,
  };
}

/** Re-applies the state an `undo` parked, keeping `current` for undo. */
export function redoHistory(
  state: HistoryState,
  current: HistoryEntry,
): HistoryMove | null {
  const entry = state.future[state.future.length - 1];
  if (!entry) return null;
  return {
    state: {
      past: [...state.past, current],
      future: state.future.slice(0, -1),
    },
    entry,
  };
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0;
}
