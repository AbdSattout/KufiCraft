"use client";

/**
 * KufiCraft — editor controller.
 *
 * Composes the project document (Convex) with the editor's local concerns:
 * the tool + draw style, the selection, the in-flight gesture, the local
 * undo/redo stack and the keyboard shortcuts. All geometry/reducer logic
 * lives in `interaction.ts`, `history.ts` and `shortcuts.ts` so this hook
 * only wires React state to those pure functions.
 *
 * Every completed gesture produces exactly one `applyOps` batch and one
 * history entry; undo/redo replay a snapshot as a `replace` op.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { MAX_ITEMS } from "@/lib/canvas/model";
import type { CanvasItem, ProjectConfig, TileShape } from "@/lib/canvas/model";
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
  IDLE_GESTURE,
  clientToViewBox,
  clampToCanvas,
  deleteItems,
  duplicateItems,
  finishGesture,
  isProjectId,
  itemsEqual,
  nextRotation,
  previewItems,
  previewKeys,
  previewMarquee,
  recolourItems,
  reshapeItems,
  startGesture,
  updateGesture,
} from "./interaction";
import type {
  DrawStyle,
  Gesture,
  GestureContext,
  Tool,
} from "./interaction";
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

export type EditorStatus =
  | "invalid"
  | "loading"
  | "missing"
  | "ready";

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

  tool: Tool;
  setTool: (tool: Tool) => void;
  style: DrawStyle;
  /** Recent ink colours, most-recent-first (from the persisted prefs). */
  inkSwatches: readonly string[];
  selectShape: (shape: TileShape) => void;
  rotateShape: () => void;
  setDrawColor: (color: string) => void;
  resetDrawColor: () => void;
  bulge: 0 | 1;
  setBulge: (bulge: 0 | 1) => void;

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

  /** Live overlay data while a gesture is in flight. */
  gesture: Gesture;
  previewItems: readonly CanvasItem[];
  previewKeys: readonly string[];
  marquee: Rect | null;
  ghost: boolean;

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
  const { config, items, commitItems } = document;

  // Prefs are read synchronously on mount so the editor opens the way the
  // designer left it; the project `config` stays authoritative for rendering.
  const [initialPrefs] = useState(() => loadEditorPrefs());
  const [tool, setToolState] = useState<Tool>(initialPrefs.tool);
  const [style, setStyle] = useState<DrawStyle>({
    shape: initialPrefs.shape,
    rotation: initialPrefs.rotation,
    color: undefined,
  });
  const [bulge, setBulge] = useState<0 | 1>(initialPrefs.bulge);
  const [inkSwatches, setInkSwatches] = useState<readonly string[]>(
    initialPrefs.inkSwatches,
  );
  const [selectionState, setSelectionState] = useState<readonly string[]>([]);
  const [gesture, setGesture] = useState<Gesture>(IDLE_GESTURE);
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const [zoom, setZoomState] = useState(initialPrefs.zoom);
  const labelRef = useRef("رسم");

  const surfaceRef = useRef<HTMLDivElement | null>(null);

  /**
   * Live selection: entries whose item disappeared (erased here, changed in
   * another tab) are dropped during render, and the identity of the array is
   * kept when nothing was pruned so the memoised layers stay put.
   */
  const liveKeys = useMemo(() => new Set(items.map((item) => item.k)), [items]);
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

  /* ---------------------------------------------------------------- */
  /* Gesture context + pointer handlers                                */
  /* ---------------------------------------------------------------- */

  const context = useMemo<GestureContext>(
    () => ({ config, items, selection, tool, style, bulge }),
    [bulge, config, items, selection, style, tool],
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
      const start = startGesture(context, point, { shift: event.shiftKey });
      if (start.selection !== undefined) setSelectionState(start.selection);
      setGesture(start.gesture);
      event.currentTarget.setPointerCapture(event.pointerId);
      surfaceRef.current?.focus({ preventScroll: true });
    },
    [context, pointOf],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (gesture.kind === "none") return;
      const point = pointOf(event);
      if (!point) return;
      const next = updateGesture(context, gesture, point);
      if (next !== gesture) setGesture(next);
    },
    [context, gesture, pointOf],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (gesture.kind === "none") return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const point = pointOf(event);
      const settled = point ? updateGesture(context, gesture, point) : gesture;
      const { commit, selection: nextSelection } = finishGesture(context, settled);
      if (commit) {
        applyCommit(commit.items, commit.label, commit.selection);
      } else if (nextSelection !== undefined) {
        setSelectionState(nextSelection);
      }
      setGesture(IDLE_GESTURE);
    },
    [applyCommit, context, gesture, pointOf],
  );

  const onPointerCancel = useCallback(() => setGesture(IDLE_GESTURE), []);

  /* ---------------------------------------------------------------- */
  /* Selection + style operations                                      */
  /* ---------------------------------------------------------------- */

  const selectShape = useCallback(
    (shape: TileShape) => {
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

  const setDrawColor = useCallback((color: string) => {
    setStyle((previous) => ({ ...previous, color }));
    setInkSwatches((previous) => rememberInkSwatch(previous, color));
  }, []);

  const resetDrawColor = useCallback(() => {
    setStyle((previous) => ({ ...previous, color: undefined }));
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

  const setTool = useCallback((next: Tool) => {
    setToolState(next);
    setGesture(IDLE_GESTURE);
  }, []);

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
          setTool(shortcut.tool);
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
          setGesture(IDLE_GESTURE);
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
    setTool,
    undo,
  ]);

  /* ---------------------------------------------------------------- */
  /* Overlay previews                                                  */
  /* ---------------------------------------------------------------- */

  const overlayItems = useMemo(
    () => previewItems(context, gesture),
    [context, gesture],
  );
  const overlayKeys = useMemo(() => previewKeys(gesture), [gesture]);
  const marquee = useMemo(() => previewMarquee(gesture), [gesture]);

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
      bulge,
      zoom,
      inkSwatches: [...inkSwatches],
    });
  }, [
    bulge,
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
    patchConfig: document.patchConfig,
    previewConfig: document.previewConfig,
    items,
    saving: document.saving,
    tool,
    setTool,
    style,
    inkSwatches,
    selectShape,
    rotateShape,
    setDrawColor,
    resetDrawColor,
    bulge,
    setBulge,
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
    gesture,
    previewItems: overlayItems,
    previewKeys: overlayKeys,
    marquee,
    ghost: gesture.kind === "move",
    exportSvg,
    exportPng,
    exportFile,
  };
}
