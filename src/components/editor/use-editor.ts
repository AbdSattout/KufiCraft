"use client";

/**
 * KufiCraft — editor controller.
 *
 * Composes the project document (Convex) with the editor's local concerns:
 * the active tool + draw style, the selection, the in-flight tool state, the
 * local undo/redo stack and the keyboard shortcuts. All geometry and gesture
 * logic lives in `interaction.ts` (helpers), `tools.ts` (the tool classes and
 * their registry), `history.ts` and `shortcuts.ts`, so this hook only wires
 * React state to those pure functions.
 *
 * Every completed gesture produces exactly one `applyOps` batch and one
 * history entry; undo/redo replay a snapshot as a `replace` op.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { MAX_ITEMS } from "@/lib/canvas/model";
import type {
  Anchor,
  ArcDirection,
  ArcSize,
  CanvasItem,
  ProjectConfig,
  ShapeId,
} from "@/lib/canvas/model";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  loadEditorPrefs,
  rememberInkSwatch,
  saveEditorPrefs,
  saveLastConfig,
} from "@/lib/editor-prefs";
import { downloadProjectFile } from "@/lib/kuficraft-file";
import {
  DEFAULT_STYLE,
  clientToViewBox,
  clampToCanvas,
  deleteItems,
  duplicateItems,
  isProjectId,
  itemsEqual,
  nextRotation,
  recolourItems,
  reshapeItems,
} from "./interaction";
import type {
  ArcStyle,
  DrawStyle,
  ToolContext,
  ToolId,
} from "./interaction";
import {
  NO_STATE,
  beginTool,
  endTool,
  moveTool,
  previewTool,
  toolOf,
} from "./tools";
import type { ToolOutcome, ToolState } from "./tools";
import {
  EMPTY_HISTORY,
  canRedo,
  canUndo,
  pushHistory,
  redoHistory,
  undoHistory,
} from "./history";
import type { HistoryEntry, HistoryState } from "./history";
import { shortcutFor } from "./shortcuts";
import { useEditorDocument } from "./use-editor-document";
import { downloadPng, downloadSvg } from "./export";
import { MESSAGES, errorMessage } from "./messages";
import type { Rect } from "@/lib/canvas/geometry";

export { MAX_ZOOM, MIN_ZOOM } from "@/lib/editor-prefs";
export const ZOOM_STEP = 0.25;

/** Quiet period before the last committed config is remembered for new boards. */
export const LAST_CONFIG_DELAY_MS = 400;

export type EditorStatus = "invalid" | "loading" | "missing" | "ready";

export interface EditorController {
  status: EditorStatus;
  projectId: Id<"projects"> | null;
  name: string;
  rename: (name: string) => void;
  config: ProjectConfig;
  patchConfig: (patch: Partial<ProjectConfig>) => void;
  /** Live, mutation-free config preview (slider dragging). */
  previewConfig: (patch: Partial<ProjectConfig>) => void;
  items: readonly CanvasItem[];
  saving: boolean;

  tool: ToolId;
  setTool: (tool: ToolId) => void;
  style: DrawStyle;
  arc: ArcStyle;
  setArcDirection: (direction: ArcDirection) => void;
  setArcSize: (size: ArcSize) => void;
  /** Recent ink colours, most-recent-first (from the persisted prefs). */
  inkSwatches: readonly string[];
  selectShape: (shape: ShapeId) => void;
  rotateShape: () => void;
  /** Back to the plain square, upright (the palette's escape hatch). */
  resetShape: () => void;
  /** The ink colour is the pen's colour *and* the project's ink. */
  setInkColor: (color: string) => void;

  selection: readonly string[];
  setSelection: (keys: readonly string[]) => void;
  clearSelection: () => void;
  recolourSelection: (color: string) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;

  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  clearAll: () => void;

  zoom: number;
  setZoom: (zoom: number) => void;

  surfaceRef: React.RefObject<HTMLDivElement | null>;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;

  /** Live overlay data while a tool state is in flight. */
  state: ToolState;
  previewItems: readonly CanvasItem[];
  previewKeys: readonly string[];
  marquee: Rect | null;
  /** The armed start anchor of a click sequence (line / arc), or null. */
  previewMarker: Anchor | null;
  previewMode: "solid" | "ghost";

  exportSvg: () => void;
  exportPng: () => void;
  /** Downloads the full document as a `.kuficraft` file (docs/FORMAT.md). */
  exportFile: () => void;
}

export function useEditor(
  projectIdParam: string | null,
  enabled: boolean,
): EditorController {
  const valid = projectIdParam !== null && isProjectId(projectIdParam);
  const projectId = useMemo(
    () => (valid && projectIdParam ? (projectIdParam as Id<"projects">) : null),
    [projectIdParam, valid],
  );

  const document = useEditorDocument(projectId, enabled);
  const { config, items, commitItems, patchConfig } = document;

  // Prefs are read synchronously on mount so the editor opens the way the
  // designer left it; the project `config` stays authoritative for rendering.
  const [initialPrefs] = useState(() => loadEditorPrefs());
  const [tool, setToolState] = useState<ToolId>(initialPrefs.tool);
  const [style, setStyle] = useState<DrawStyle>({
    shape: initialPrefs.shape,
    rotation: initialPrefs.rotation,
  });
  const [arc, setArc] = useState<ArcStyle>(initialPrefs.arc);
  const [inkSwatches, setInkSwatches] = useState<readonly string[]>(
    initialPrefs.inkSwatches,
  );
  const [selectionState, setSelectionState] = useState<readonly string[]>([]);
  const [state, setState] = useState<ToolState>(NO_STATE);
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const [zoom, setZoomState] = useState(initialPrefs.zoom);
  const labelRef = useRef("رسم");
  /** The line tool's run survives re-renders without a pointer being down. */
  const stateRef = useRef<ToolState>(NO_STATE);

  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const setToolStateAndReset = useCallback((next: ToolId) => {
    setToolState(next);
    stateRef.current = NO_STATE;
    setState(NO_STATE);
  }, []);

  /**
   * Live selection: entries whose item disappeared (erased here, changed in
   * another tab) are dropped during render, and the identity of the array is
   * kept when nothing was pruned so the memoised layers stay put.
   */
  const liveKeys = useMemo(() => new Set(items.map((item) => item.key)), [items]);
  const selection = useMemo(() => {
    const kept = selectionState.filter((key) => liveKeys.has(key));
    return kept.length === selectionState.length ? selectionState : kept;
  }, [liveKeys, selectionState]);

  /* ---------------------------------------------------------------- */
  /* State helpers                                                     */
  /* ---------------------------------------------------------------- */

  const setSelection = useCallback((keys: readonly string[]) => {
    setSelectionState(keys);
  }, []);

  const clearSelection = useCallback(() => setSelectionState([]), []);

  /** Commits a new item list with one history entry (no-op when identical). */
  const applyCommit = useCallback(
    (next: readonly CanvasItem[], label: string, nextSelection?: readonly string[]) => {
      if (next.length > MAX_ITEMS) {
        // Stop before the server rejects the write mid-gesture (docs/BACKEND.md).
        toast.error(MESSAGES.itemsLimit);
        return;
      }
      if (itemsEqual(next, items)) {
        if (nextSelection !== undefined) setSelectionState(nextSelection);
        return;
      }
      const entry: HistoryEntry = { items, selection, label };
      setHistory((previous) => pushHistory(previous, entry));
      labelRef.current = label;
      commitItems(next);
      if (nextSelection !== undefined) setSelectionState(nextSelection);
    },
    [commitItems, items, selection],
  );

  /** Applies the outcome of one tool step to React state. */
  const applyOutcome = useCallback(
    (outcome: ToolOutcome) => {
      if (outcome.selection !== undefined) {
        setSelectionState(outcome.selection);
      }
      if (outcome.commit) {
        applyCommit(
          outcome.commit.items,
          outcome.commit.label,
          outcome.commit.selection,
        );
      }
    },
    [applyCommit],
  );

  /* ---------------------------------------------------------------- */
  /* Tool context + pointer handlers                                   */
  /* ---------------------------------------------------------------- */

  const context = useMemo<ToolContext>(
    () => ({ config, items, selection, tool, style, arc }),
    [arc, config, items, selection, style, tool],
  );

  const pointOf = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const element = surfaceRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return clampToCanvas(clientToViewBox(rect, event.clientX, event.clientY));
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const point = pointOf(event);
      if (!point) return;
      event.preventDefault();
      const outcome = beginTool(tool, context, stateRef.current, {
        point,
        shift: event.shiftKey,
      });
      applyOutcome(outcome);
      stateRef.current = outcome.state;
      setState(outcome.state);
      event.currentTarget.setPointerCapture(event.pointerId);
      surfaceRef.current?.focus({ preventScroll: true });
    },
    [applyOutcome, context, pointOf, tool],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Tools with a click sequence (the line tool) track the hover position
      // even while no button is down; drag tools only move with the button.
      if (stateRef.current.kind === "none" && !toolOf(tool).persistent) return;
      const point = pointOf(event);
      if (!point) return;
      const outcome = moveTool(tool, context, stateRef.current, {
        point,
        shift: event.shiftKey,
      });
      if (outcome.state === stateRef.current) return;
      applyOutcome(outcome);
      stateRef.current = outcome.state;
      setState(outcome.state);
    },
    [applyOutcome, context, pointOf, tool],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const settled = stateRef.current;
      const outcome = endTool(tool, context, settled);
      applyOutcome(outcome);
      const next = outcome.keep ? outcome.state : NO_STATE;
      stateRef.current = next;
      setState(next);
    },
    [applyOutcome, context, tool],
  );

  const onPointerCancel = useCallback(() => {
    stateRef.current = NO_STATE;
    setState(NO_STATE);
  }, []);

  /* ---------------------------------------------------------------- */
  /* Selection + style operations                                      */
  /* ---------------------------------------------------------------- */

  const selectShape = useCallback(
    (shape: ShapeId) => {
      setStyle((previous) => ({ ...previous, shape }));
      if (selection.length > 0) {
        applyCommit(reshapeItems(items, selection, { shape }), "شكل", selection);
      }
    },
    [applyCommit, items, selection],
  );

  const rotateShape = useCallback(() => {
    const rotation = nextRotation(style.rotation);
    setStyle((previous) => ({ ...previous, rotation }));
    if (selection.length > 0) {
      applyCommit(reshapeItems(items, selection, { rotation }), "تدوير", selection);
    }
  }, [applyCommit, items, selection, style.rotation]);

  const resetShape = useCallback(() => {
    const patch = { shape: DEFAULT_STYLE.shape, rotation: DEFAULT_STYLE.rotation };
    setStyle((previous) => ({ ...previous, ...patch }));
    if (selection.length > 0) {
      applyCommit(reshapeItems(items, selection, patch), "شكل", selection);
    }
  }, [applyCommit, items, selection]);

  /**
   * The ink colour is a project field, so the panel writes it through the
   * document; the swatch history rides along because it is a UI preference.
   * Items keep the colour they were drawn with (docs/CANVAS.md §Editing).
   */
  const setInkColor = useCallback(
    (color: string) => {
      setInkSwatches((previous) => rememberInkSwatch(previous, color));
      patchConfig({ ink: color });
    },
    [patchConfig],
  );

  const setArcDirection = useCallback((direction: ArcDirection) => {
    setArc((previous) => ({ ...previous, direction }));
  }, []);

  const setArcSize = useCallback((size: ArcSize) => {
    setArc((previous) => ({ ...previous, size }));
  }, []);

  const recolourSelection = useCallback(
    (color: string) => {
      setInkSwatches((previous) => rememberInkSwatch(previous, color));
      applyCommit(recolourItems(config, items, selection, color), "تلوين", selection);
    },
    [applyCommit, config, items, selection],
  );

  const deleteSelection = useCallback(() => {
    if (selection.length === 0) return;
    applyCommit(deleteItems(items, selection), "حذف", []);
  }, [applyCommit, items, selection]);

  const duplicateSelection = useCallback(() => {
    if (selection.length === 0) return;
    const { items: next, keys } = duplicateItems(config, items, selection);
    if (keys.length === 0) return;
    applyCommit(next, "تكرار", keys);
  }, [applyCommit, config, items, selection]);

  const clearAll = useCallback(() => {
    applyCommit([], "مسح الكل", []);
  }, [applyCommit]);

  /* ---------------------------------------------------------------- */
  /* History                                                           */
  /* ---------------------------------------------------------------- */

  const undo = useCallback(() => {
    const move = undoHistory(history, { items, selection, label: labelRef.current });
    if (!move) return;
    setHistory(move.state);
    labelRef.current = move.entry.label;
    setSelectionState(move.entry.selection);
    commitItems(move.entry.items);
  }, [commitItems, history, items, selection]);

  const redo = useCallback(() => {
    const move = redoHistory(history, { items, selection, label: labelRef.current });
    if (!move) return;
    setHistory(move.state);
    labelRef.current = move.entry.label;
    setSelectionState(move.entry.selection);
    commitItems(move.entry.items);
  }, [commitItems, history, items, selection]);

  /* ---------------------------------------------------------------- */
  /* Keyboard                                                          */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[role="dialog"], [role="alertdialog"], [data-slot="sheet-content"]')
      ) {
        return;
      }
      const shortcut = shortcutFor({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        // `shortcutFor` stays DOM-free: hand it only the two fields it reads.
        target: target instanceof HTMLElement ? target : null,
      });
      if (!shortcut) return;
      event.preventDefault();
      switch (shortcut.kind) {
        case "tool":
          setToolStateAndReset(shortcut.tool);
          break;
        case "shape":
          selectShape(shortcut.shape);
          break;
        case "rotate":
          rotateShape();
          break;
        case "delete":
          deleteSelection();
          break;
        case "duplicate":
          duplicateSelection();
          break;
        case "undo":
          undo();
          break;
        case "redo":
          redo();
          break;
        case "cancel":
          stateRef.current = NO_STATE;
          setState(NO_STATE);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    deleteSelection,
    duplicateSelection,
    enabled,
    redo,
    rotateShape,
    selectShape,
    setToolStateAndReset,
    undo,
  ]);

  /* ---------------------------------------------------------------- */
  /* Overlay previews                                                  */
  /* ---------------------------------------------------------------- */

  const preview = useMemo(
    () => previewTool(tool, context, state),
    [context, state, tool],
  );

  /* ---------------------------------------------------------------- */
  /* Exports                                                           */
  /* ---------------------------------------------------------------- */

  const exportSvg = useCallback(() => {
    downloadSvg(config, items, document.name);
  }, [config, document.name, items]);

  const exportPng = useCallback(() => {
    downloadPng(config, items, document.name).catch((error: unknown) => {
      toast.error(errorMessage(error));
    });
  }, [config, document.name, items]);

  const exportFile = useCallback(() => {
    downloadProjectFile({ name: document.name, config, items });
  }, [config, document.name, items]);

  const setZoom = useCallback((next: number) => {
    setZoomState(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
  }, []);

  /* ---------------------------------------------------------------- */
  /* Preferences (localStorage, best-effort)                           */
  /* ---------------------------------------------------------------- */

  // One write per discrete change — never from a pointer-move handler. Gated
  // on a loaded document so a loading / missing project cannot clobber the
  // remembered config fields with model defaults.
  useEffect(() => {
    if (!enabled || document.status !== "ready") return;
    saveEditorPrefs({
      tool,
      shape: style.shape,
      rotation: style.rotation,
      arc,
      zoom,
      inkSwatches: [...inkSwatches],
    });
  }, [
    arc,
    document.status,
    enabled,
    inkSwatches,
    style.rotation,
    style.shape,
    tool,
    zoom,
  ]);

  // The last committed config becomes the dashboard's «لوحة جديدة» default;
  // debounced so dragging the cell-size slider settles before it is stored.
  useEffect(() => {
    if (!enabled || document.status !== "ready") return;
    const timer = window.setTimeout(
      () => saveLastConfig(config),
      LAST_CONFIG_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [config, document.status, enabled]);

  const status: EditorStatus = !valid
    ? "invalid"
    : !enabled
      ? "loading"
      : document.status;

  return {
    status,
    projectId,
    name: document.name,
    rename: document.rename,
    config,
    patchConfig,
    previewConfig: document.previewConfig,
    items,
    saving: document.saving,
    tool,
    setTool: setToolStateAndReset,
    style,
    arc,
    setArcDirection,
    setArcSize,
    inkSwatches,
    selectShape,
    rotateShape,
    resetShape,
    setInkColor,
    selection,
    setSelection,
    clearSelection,
    recolourSelection,
    deleteSelection,
    duplicateSelection,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    undo,
    redo,
    clearAll,
    zoom,
    setZoom,
    surfaceRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    state,
    previewItems: preview.items,
    previewKeys: preview.keys,
    marquee: preview.marquee,
    previewMarker: preview.marker,
    previewMode: preview.mode,
    exportSvg,
    exportPng,
    exportFile,
  };
}
