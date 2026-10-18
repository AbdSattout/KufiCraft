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

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { MAX_ITEMS } from "@/lib/canvas/model";
import type {
  Anchor,
  ArcDirection,
  ArcSize,
  CanvasItem,
  ItemBorder,
  ItemRounding,
  LinePoint,
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
import { arrangeItems } from "@/lib/canvas/ops";
import type { ArrangeAction } from "@/lib/canvas/ops";
import {
  WHEEL_IDLE,
  centreScroll,
  clientToViewBox,
  clampToCanvas,
  deleteItems,
  duplicateItems,
  isProjectId,
  itemsEqual,
  nextRotation,
  nextZoom,
  panScrollOffset,
  pruneSelection,
  recolourItems,
  reshapeItems,
  wheelSteps,
  zoomScrollOffset,
} from "./interaction";
import type {
  ArcStyle,
  DrawStyle,
  ScrollOffset,
  ToolContext,
  ToolId,
  WheelGesture,
} from "./interaction";
import {
  NO_STATE,
  beginTool,
  endTool,
  fallbackTool,
  isToolAvailable,
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
import type { SaveState } from "@/lib/save-state";
import type { Point, Rect } from "@/lib/canvas/geometry";

export { MAX_ZOOM, MIN_ZOOM } from "@/lib/editor-prefs";

/** Quiet period before the last committed config is remembered for new boards. */
export const LAST_CONFIG_DELAY_MS = 400;

export type EditorStatus = "invalid" | "loading" | "missing" | "ready";

export interface EditorController {
  status: EditorStatus;
  projectId: Id<"projects"> | null;
  name: string;
  rename: (name: string) => void;
  /**
   * What the canvas renders: the document's config with the user's `showGrid`
   * guide applied (that one field is a preference, not artwork).
   */
  config: ProjectConfig;
  patchConfig: (patch: Partial<ProjectConfig>) => void;
  /** Live, mutation-free config preview (slider dragging). */
  previewConfig: (patch: Partial<ProjectConfig>) => void;
  items: readonly CanvasItem[];
  /** The top bar's single save/connection indicator. */
  save: SaveState;

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
  /** Corner rounding: sets the draw style and re-rounds the selected tiles. */
  setRounding: (rounding: ItemRounding) => void;
  /** Corner rounding while a slider is dragged — style only, no write. */
  previewRounding: (radius: number) => void;
  /** Outside border: sets the draw style and re-borders the selection. */
  setBorder: (border: ItemBorder) => void;
  /** Border width while a slider is dragged — style only, no write. */
  previewBorderWidth: (width: number) => void;
  /** The ink colour is the pen's colour *and* the project's ink. */
  setInkColor: (color: string) => void;

  selection: readonly string[];
  setSelection: (keys: readonly string[]) => void;
  clearSelection: () => void;
  recolourSelection: (color: string) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  /** Moves the selection in the render order — one undo step per action. */
  arrange: (action: ArrangeAction) => void;
  /** Whether `arrange` would change anything (menu disabled state). */
  canArrange: (action: ArrangeAction) => boolean;

  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  clearAll: () => void;

  zoom: number;
  /**
   * Zoom to `next`, clamped to the prefs' range. `focus` is a client-space
   * point the board keeps fixed: the wheel passes the pointer, the ± buttons
   * omit it so the middle of the pane stays put.
   */
  setZoom: (zoom: number, focus?: Point) => void;

  /** The construction grid guide — a user preference, saved in the prefs. */
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;

  surfaceRef: React.RefObject<HTMLDivElement | null>;
  /** The scrollable canvas viewport (what the hand tool pans). */
  viewportRef: React.RefObject<HTMLDivElement | null>;
  /** Puts the middle of the canvas in the middle of the viewport. */
  centreView: () => void;
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
  /** The line tool's snap dot: the point the next click would store. */
  previewDot: LinePoint | null;
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
  const { config: documentConfig, items, commitItems, patchConfig } = document;

  // Prefs are read synchronously on mount so the editor opens the way the
  // designer left it; the rest of the project `config` stays authoritative.
  const [initialPrefs] = useState(() => loadEditorPrefs());
  const [toolPref, setToolState] = useState<ToolId>(initialPrefs.tool);
  const [style, setStyle] = useState<DrawStyle>({
    shape: initialPrefs.shape,
    rotation: initialPrefs.rotation,
    rounding: initialPrefs.rounding,
    border: initialPrefs.border,
  });
  const [arc, setArc] = useState<ArcStyle>(initialPrefs.arc);
  const [inkSwatches, setInkSwatches] = useState<readonly string[]>(
    initialPrefs.inkSwatches,
  );
  const [selectionState, setSelectionState] = useState<readonly string[]>([]);
  const [state, setState] = useState<ToolState>(NO_STATE);
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const [zoom, setZoomState] = useState(initialPrefs.zoom);
  /**
   * The live zoom, for the hand-attached wheel listener: React's `onWheel` is
   * passive, so the listener cannot live in JSX, and it must walk the ladder
   * from the latest value rather than a render-time closure.
   */
  const zoomRef = useRef(initialPrefs.zoom);
  const [showGrid, setShowGridState] = useState(initialPrefs.showGrid);
  const labelRef = useRef("رسم");
  /** The line tool's run survives re-renders without a pointer being down. */
  const stateRef = useRef<ToolState>(NO_STATE);

  /**
   * What the canvas renders. The construction grid is a *view* guide — the same
   * for the user on every board — while the rest of the config belongs to the
   * document, so only `showGrid` is taken from the prefs here. Keeping the
   * document's own object when the two agree leaves the memoised canvas layers
   * untouched.
   */
  const config = useMemo(
    () =>
      documentConfig.showGrid === showGrid
        ? documentConfig
        : { ...documentConfig, showGrid },
    [documentConfig, showGrid],
  );

  /**
   * The active tool is the user's preference **filtered by the board's grid**
   * (`docs/CANVAS.md` §3): a circular board has no line and no arc tool, so a
   * preference for one falls back to the first tool the board carries. Nothing
   * synchronises — there is no state to keep in step, and switching back to a
   * square board restores the preference on its own.
   */
  const tool: ToolId = isToolAvailable(config.gridType, toolPref)
    ? toolPref
    : fallbackTool(config.gridType);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  /**
   * The live pan gesture: where the pointer started and the scroll offset it
   * started from. Kept in a ref — a pan must not re-render on every pointer
   * move, and in `dir="rtl"` the offset simply runs negative (the scroller
   * counts from the inline-start edge, see `panScrollOffset`).
   */
  const panRef = useRef<{
    from: Point;
    scroll: ScrollOffset;
  } | null>(null);
  /**
   * Whether a primary pointer is down on the canvas. A wheel notch mid-drag
   * must not zoom: the zoom remaps client → viewBox, so the next interpolated
   * pen position would jump and paint a spurious run. `stateRef` alone cannot
   * answer this — it also holds click sequences that survive pointer-up.
   */
  const pointerDownRef = useRef(false);
  /**
   * The board point (0…1 of the viewBox) that sat under the zoom's focus
   * point — the pane centre for the ± buttons, the pointer for a wheel notch —
   * when the zoom was requested; the scroll is adjusted to keep it there once
   * the surface has its new size (`zoomScrollOffset`).
   */
  const zoomAnchorRef = useRef<{ point: Point; focus: Point | null } | null>(
    null,
  );

  const setToolStateAndReset = useCallback((next: ToolId) => {
    setToolState(next);
    stateRef.current = NO_STATE;
    setState(NO_STATE);
    panRef.current = null;
  }, []);

  /**
   * Live selection: entries whose item disappeared (erased here, changed in
   * another tab) or that the grid hides (a circular board and its line/arc
   * items — `docs/CANVAS.md` §3) are dropped during render, and the identity
   * of the array is kept when nothing was pruned so the memoised layers stay
   * put. Delete, move, colour and arrange read only this list, so they can
   * never act on an item the user cannot see.
   */
  const selection = useMemo(() => {
    const kept = pruneSelection(config, items, selectionState);
    return kept.length === selectionState.length ? selectionState : kept;
  }, [config, items, selectionState]);

  /**
   * A grid switch drops any armed gesture: it was aimed at the old geometry,
   * and the tool it belongs to may not exist on the new board
   * (`docs/CANVAS.md` §3). The tool itself needs no repair — it is derived
   * above — and `previewConfig` only ever carries slider values, so this is
   * the one place a grid change goes through.
   */
  const patchEditorConfig = useCallback(
    (patch: Partial<ProjectConfig>) => {
      if (patch.gridType !== undefined && patch.gridType !== config.gridType) {
        stateRef.current = NO_STATE;
        setState(NO_STATE);
        panRef.current = null;
      }
      patchConfig(patch);
    },
    [config.gridType, patchConfig],
  );

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
      pointerDownRef.current = true;
      const active = toolOf(tool);
      const view = viewportRef.current;
      if (active.pans && view) {
        // A view tool: the pointer drags the viewport, no tool state is made.
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        panRef.current = {
          from: { x: event.clientX, y: event.clientY },
          scroll: { left: view.scrollLeft, top: view.scrollTop },
        };
        surfaceRef.current?.focus({ preventScroll: true });
        return;
      }
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
      const pan = panRef.current;
      if (pan) {
        const view = viewportRef.current;
        if (view) {
          const next = panScrollOffset(pan.scroll, pan.from, {
            x: event.clientX,
            y: event.clientY,
          });
          view.scrollLeft = next.left;
          view.scrollTop = next.top;
        }
        return;
      }
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
      pointerDownRef.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (panRef.current) {
        panRef.current = null;
        return;
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
    pointerDownRef.current = false;
    panRef.current = null;
    stateRef.current = NO_STATE;
    setState(NO_STATE);
  }, []);

  const centreView = useCallback(() => {
    const view = viewportRef.current;
    if (view) centreScroll(view);
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

  /**
   * Rounding and the border are style fields *and* item patches: the next
   * stroke is drawn with them, and a live selection is re-styled in the same
   * click (`reshapeItems`), exactly like the shape palette. The `preview*`
   * variants only move the style while a slider is dragged — one backend write
   * when the thumb is released (`SliderField` in `editor-controls.tsx`).
   */
  const setRounding = useCallback(
    (rounding: ItemRounding) => {
      setStyle((previous) => ({ ...previous, rounding }));
      if (selection.length > 0) {
        applyCommit(
          reshapeItems(items, selection, { rounding }),
          "استدارة",
          selection,
        );
      }
    },
    [applyCommit, items, selection],
  );

  const previewRounding = useCallback((radius: number) => {
    setStyle((previous) => ({ ...previous, rounding: { ...previous.rounding, radius } }));
  }, []);

  const setBorder = useCallback(
    (border: ItemBorder) => {
      setStyle((previous) => ({ ...previous, border }));
      if (selection.length > 0) {
        applyCommit(
          reshapeItems(items, selection, { border }),
          "حدود",
          selection,
        );
      }
    },
    [applyCommit, items, selection],
  );

  const previewBorderWidth = useCallback((width: number) => {
    setStyle((previous) => ({ ...previous, border: { ...previous.border, width } }));
  }, []);

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

  /** The grid guide lives in the prefs, not in the document (docs/UI.md §Editor). */
  const setShowGrid = useCallback((show: boolean) => {
    setShowGridState(show);
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

  /** The selection's z-order, one commit (and one undo entry) per command. */
  const arrange = useCallback(
    (action: ArrangeAction) => {
      if (selection.length === 0) return;
      applyCommit(arrangeItems(items, selection, action), "ترتيب", selection);
    },
    [applyCommit, items, selection],
  );

  /** No-op detection: `arrangeItems` returns its input when nothing moves. */
  const canArrange = useCallback(
    (action: ArrangeAction) => arrangeItems(items, selection, action) !== items,
    [items, selection],
  );

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
      const shortcut = shortcutFor(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          // `shortcutFor` stays DOM-free: hand it only the two fields it reads.
          target: target instanceof HTMLElement ? target : null,
        },
        config.gridType,
      );
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
        case "arrange":
          arrange(shortcut.action);
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
    arrange,
    config.gridType,
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

  const setZoom = useCallback(
    (next: number, focus?: Point) => {
      const value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      if (value === zoomRef.current) return;
      const surface = surfaceRef.current;
      const view = viewportRef.current;
      if (surface && view) {
        // Remember the board point under `focus` (the wheel's pointer) or the
        // middle of the pane before the surface takes its new size; the layout
        // effect below puts it back.
        const surfaceRect = surface.getBoundingClientRect();
        const paneRect = view.getBoundingClientRect();
        if (surfaceRect.width > 0 && surfaceRect.height > 0) {
          const target = focus ?? {
            x: paneRect.left + paneRect.width / 2,
            y: paneRect.top + paneRect.height / 2,
          };
          zoomAnchorRef.current = {
            point: {
              x: (target.x - surfaceRect.left) / surfaceRect.width,
              y: (target.y - surfaceRect.top) / surfaceRect.height,
            },
            focus: focus ?? null,
          };
        }
      }
      zoomRef.current = value;
      setZoomState(value);
    },
    [],
  );

  // A zoom keeps its focus point fixed — the pane centre for the ± buttons,
  // the pointer for a wheel notch: the board point under it is measured before
  // the resize and the scroll is corrected here, in the same frame as the new
  // layout, so nothing jumps.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    const surface = surfaceRef.current;
    const view = viewportRef.current;
    if (!anchor || !surface || !view) return;
    const next = zoomScrollOffset(
      { left: view.scrollLeft, top: view.scrollTop },
      surface.getBoundingClientRect(),
      view.getBoundingClientRect(),
      anchor.point,
      anchor.focus ?? undefined,
    );
    view.scrollLeft = next.left;
    view.scrollTop = next.top;
  }, [zoom]);

  // Plain-wheel zoom over the canvas, anchored at the pointer, stepped by
  // gestures (docs/CANVAS.md §6). React attaches `wheel` passively, so a
  // `preventDefault()` in `onWheel` would be a no-op (with a warning); the
  // listener is attached by hand instead. It lives on the viewport element
  // only, so the sidebar and panels keep their own wheel behaviour, and the
  // viewport no longer wheel-scrolls — the hand tool and the scrollbars still
  // pan.
  useEffect(() => {
    if (!enabled || document.status !== "ready") return;
    const view = viewportRef.current;
    if (!view) return;
    // The gesture's carry-over (banked pixels, direction, stops walked, the
    // clock). It lives with the listener, so a fresh attach starts a fresh
    // gesture.
    let gesture: WheelGesture = WHEEL_IDLE;
    const onWheel = (event: WheelEvent) => {
      // Ctrl/Cmd+wheel is the browser's own zoom — trackpad pinch and page
      // zoom are accessibility features this pane must not swallow.
      if (event.ctrlKey || event.metaKey) return;
      if (pointerDownRef.current) {
        if (event.buttons & 1) {
          // A live gesture owns the mapping: zooming now would remap the
          // pointer mid-drag, and the next interpolated position would jump.
          event.preventDefault();
          return;
        }
        // Self-heal: a pointerup that never arrived (a release outside the
        // capture, alt-tab, a context menu) must not mute the wheel for the
        // rest of the session — the event's own buttons say no drag is live.
        pointerDownRef.current = false;
      }
      if (event.deltaY === 0) return; // horizontal-only wheel: not ours
      event.preventDefault();
      const step = wheelSteps(
        gesture,
        event.deltaY,
        event.deltaMode,
        performance.now(),
      );
      gesture = step;
      if (step.steps === 0) return;
      // Scrolling up zooms in, like every map: `steps` is signed by `deltaY`.
      const direction: 1 | -1 = step.steps > 0 ? -1 : 1;
      let next = zoomRef.current;
      for (let index = 0; index < Math.abs(step.steps); index++) {
        next = nextZoom(next, direction, MIN_ZOOM, MAX_ZOOM);
      }
      setZoom(next, { x: event.clientX, y: event.clientY });
    };
    view.addEventListener("wheel", onWheel, { passive: false });
    return () => view.removeEventListener("wheel", onWheel);
  }, [document.status, enabled, setZoom]);

  /* ---------------------------------------------------------------- */
  /* Preferences (localStorage, best-effort)                           */
  /* ---------------------------------------------------------------- */

  // One write per discrete change — never from a pointer-move handler. Nothing
  // here comes from the document, so a change is stored the moment it happens,
  // even while a board is still loading: only the config write below has to
  // wait for the document to be ready (a loading project would otherwise
  // clobber the remembered config with model defaults).
  useEffect(() => {
    saveEditorPrefs({
      // The **preference**, never the derived active tool: a circular board
      // substitutes `fallbackTool` at render time, and storing that would
      // erase a square-board preference (line/arc) the moment a circular
      // board opens (docs/CANVAS.md §3).
      tool: toolPref,
      shape: style.shape,
      rotation: style.rotation,
      arc,
      zoom,
      showGrid,
      inkSwatches: [...inkSwatches],
      rounding: style.rounding,
      border: style.border,
    });
  }, [
    arc,
    inkSwatches,
    showGrid,
    style.border,
    style.rotation,
    style.rounding,
    style.shape,
    toolPref,
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
    patchConfig: patchEditorConfig,
    previewConfig: document.previewConfig,
    items,
    save: document.save,
    tool,
    setTool: setToolStateAndReset,
    style,
    arc,
    setArcDirection,
    setArcSize,
    inkSwatches,
    selectShape,
    rotateShape,
    setRounding,
    previewRounding,
    setBorder,
    previewBorderWidth,
    setInkColor,
    selection,
    setSelection,
    clearSelection,
    recolourSelection,
    deleteSelection,
    duplicateSelection,
    arrange,
    canArrange,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    undo,
    redo,
    clearAll,
    zoom,
    setZoom,
    showGrid,
    setShowGrid,
    surfaceRef,
    viewportRef,
    centreView,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    state,
    previewItems: preview.items,
    previewKeys: preview.keys,
    marquee: preview.marquee,
    previewMarker: preview.marker,
    previewDot: preview.dot,
    previewMode: preview.mode,
    exportSvg,
    exportPng,
    exportFile,
  };
}
