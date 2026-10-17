/**
 * KufiCraft — the editor tools, one class each, in a registry.
 *
 * Every tool is a subclass of `KufiTool` and declares **its own** identity —
 * `id`, Arabic `label`, keyboard `shortcut`, `cursor` and its toolbar `icon` —
 * next to the behaviour that makes it a tool: `begin` / `move` / `end` turn
 * pointer input into a `ToolOutcome` (a new in-flight state plus, when the
 * gesture completes, a commit), and `preview` says what the overlay should
 * draw while the gesture is live.
 *
 * The registry is the single list the rest of the editor reads: the rail maps
 * `TOOLS`, shortcuts and labels come from the classes, and the controller
 * dispatches through `beginTool` / `moveTool` / `endTool` / `previewTool`
 * instead of switching on a tool name. Adding a tool means adding a class and
 * one line in `REGISTRY` — nothing else in the editor changes.
 *
 * The items a tool produces are built by the item classes in
 * `@/lib/canvas/items`, so a tool never hand-writes geometry.
 */

import type { Anchor, ArcItem, CanvasItem, Cell } from "@/lib/canvas/model";
import type { Point, Rect } from "@/lib/canvas/geometry";
import { addItems, lineItems, paintItems, penItems, removeItems } from "@/lib/canvas/ops";
import { Arc } from "@/lib/canvas/items";
import {
  anchorKey,
  anchorAt,
  arcBetween,
  clampDelta,
  hitTest,
  inkAnchorAt,
  linePreview,
  marqueeSelection,
  moveItems,
  rectFromPoints,
  shiftSelection,
  type ArcStyle,
  type DrawStyle,
  type ToolContext,
  type ToolId,
} from "./interaction";

export type { ToolContext, ToolId };

/* ------------------------------------------------------------------ */
/* Shared vocabulary                                                   */
/* ------------------------------------------------------------------ */

/** Pointer input, already mapped to viewBox units and clipped to the canvas. */
export interface ToolInput {
  /** Canvas (viewBox) position. */
  point: Point;
  /** Shift held — additive selection. */
  shift: boolean;
}

/**
 * In-flight state of a gesture. The `kind` names the tool that owns it, except
 * `marquee` / `move`, which are the select tool's two modes.
 */
export type ToolState =
  | { kind: "none" }
  | { kind: "pen"; anchors: Anchor[] }
  | { kind: "erase"; keys: string[] }
  | { kind: "arc"; from: Anchor; to: Anchor }
  | { kind: "line"; points: Cell[]; hover: Cell | null }
  | { kind: "marquee"; from: Point; to: Point; base: readonly string[] }
  | { kind: "move"; from: Cell; to: Cell; keys: readonly string[] };

export const NO_STATE: ToolState = { kind: "none" };

/** A completed edit: the next document plus its undo label. */
export interface ToolCommit {
  items: readonly CanvasItem[];
  selection: readonly string[];
  /** Arabic label recorded in the undo stack. */
  label: string;
}

/** What one pointer event produced. */
export interface ToolOutcome {
  state: ToolState;
  /** Selection change caused by this event. */
  selection?: readonly string[];
  /** Set when the gesture finished an edit. */
  commit?: ToolCommit | null;
  /** Keep `state` after pointer-up (a click sequence rather than a drag). */
  keep?: boolean;
}

/** How the overlay should paint the preview. */
export type PreviewMode = "solid" | "ghost";

export interface ToolPreview {
  items: readonly CanvasItem[];
  mode: PreviewMode;
  /** Keys to ring (the eraser's sweep). */
  keys: readonly string[];
  /** The marquee box, when the tool draws one. */
  marquee: Rect | null;
  /** The armed start anchor of a click sequence (line / arc), to ring. */
  marker: Anchor | null;
}

const EMPTY_PREVIEW: ToolPreview = {
  items: [],
  mode: "ghost",
  keys: [],
  marquee: null,
  marker: null,
};

/** A piece of a toolbar icon, drawn in a `0 0 24 24` box. */
export interface ToolIconPart {
  d: string;
  /** `stroke` (default) or `fill`. */
  mode?: "stroke" | "fill";
}

/* ------------------------------------------------------------------ */
/* The parent class                                                    */
/* ------------------------------------------------------------------ */

export abstract class KufiTool {
  /** Stable id — stored in prefs and used by the controller. */
  abstract readonly id: ToolId;
  /** Arabic name shown under the icon. */
  abstract readonly label: string;
  /** Single-key shortcut, upper case. */
  abstract readonly shortcut: string;
  /** CSS cursor while the tool is active (a `cursor-*` Tailwind class). */
  abstract readonly cursor: string;
  /** Toolbar icon, drawn by the tool itself. */
  abstract readonly icon: readonly ToolIconPart[];
  /** True when the tool keeps its state across pointer-up. */
  readonly persistent: boolean = false;
  /**
   * True for tools that move the **view** instead of the document (the hand).
   * The controller reads it and never dispatches pointer input to a panning
   * tool: the pointer scrolls the viewport, and a double click recentres the
   * canvas. Such a tool owns no `ToolState`, so a pan can never reach the
   * document, the history or the server.
   */
  readonly pans: boolean = false;
  /** One line of guidance the status bar shows while the tool is active. */
  readonly hint: string | null = null;

  /** Pointer down; `state` is the live state (usually `none`). */
  abstract begin(
    ctx: ToolContext,
    state: ToolState,
    input: ToolInput,
  ): ToolOutcome;

  /** Pointer move with the button held (and hover, for persistent tools). */
  abstract move(
    ctx: ToolContext,
    state: ToolState,
    input: ToolInput,
  ): ToolOutcome;

  /** Pointer up: the last chance to commit. */
  abstract end(ctx: ToolContext, state: ToolState): ToolOutcome;

  /** What the overlay draws while `state` is live. */
  preview(ctx: ToolContext, state: ToolState): ToolPreview {
    void ctx;
    void state;
    return EMPTY_PREVIEW;
  }
}

/** Continues a gesture without changing anything. */
function unchanged(state: ToolState): ToolOutcome {
  return { state };
}

function commit(
  items: readonly CanvasItem[],
  selection: readonly string[],
  label: string,
): ToolCommit {
  return { items, selection, label };
}

/* ------------------------------------------------------------------ */
/* Select                                                              */
/* ------------------------------------------------------------------ */

class SelectTool extends KufiTool {
  readonly id = "select" as const;
  readonly label = "تحديد";
  readonly shortcut = "V";
  readonly cursor = "cursor-default";
  readonly icon: readonly ToolIconPart[] = [
    {
      d: "M5 3 L5 19.5 L9.4 15.2 L12.2 21.5 L15.1 20.1 L12.3 13.9 L18.2 13.4 Z",
      mode: "fill",
    },
  ];

  begin(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    void state;
    const hit = hitTest(ctx.config, ctx.items, input.point);
    const cell = cellAt(ctx, input.point);
    if (hit) {
      const already = ctx.selection.includes(hit.key);
      const selection = input.shift
        ? already
          ? ctx.selection.filter((key) => key !== hit.key)
          : [...ctx.selection, hit.key]
        : already
          ? ctx.selection
          : [hit.key];
      return {
        state: { kind: "move", from: cell, to: cell, keys: selection },
        selection,
      };
    }
    return {
      state: {
        kind: "marquee",
        from: input.point,
        to: input.point,
        base: input.shift ? ctx.selection : [],
      },
      selection: input.shift ? undefined : [],
    };
  }

  move(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    if (state.kind === "marquee") {
      const tiny =
        Math.abs(input.point.x - state.to.x) < 0.5 &&
        Math.abs(input.point.y - state.to.y) < 0.5;
      return tiny ? unchanged(state) : { state: { ...state, to: input.point } };
    }
    if (state.kind === "move") {
      const cell = cellAt(ctx, input.point);
      if (cell.column === state.to.column && cell.row === state.to.row) {
        return unchanged(state);
      }
      return { state: { ...state, to: cell } };
    }
    return unchanged(state);
  }

  end(ctx: ToolContext, state: ToolState): ToolOutcome {
    if (state.kind === "marquee") {
      const box = rectFromPoints(state.from, state.to);
      const merged = new Set(state.base);
      for (const key of marqueeSelection(ctx.config, ctx.items, box)) {
        merged.add(key);
      }
      return { state: NO_STATE, selection: [...merged] };
    }
    if (state.kind === "move") {
      const delta = moveDelta(ctx, state);
      if (delta.dColumn === 0 && delta.dRow === 0) return { state: NO_STATE };
      return {
        state: NO_STATE,
        commit: commit(
          // The **whole board** with the moved items on top: a commit's items
          // are diffed against the document (`toOps`), so handing it only the
          // fragments would read as "delete everything else".
          moveItems(
            ctx.config,
            ctx.items,
            [...state.keys],
            delta.dColumn,
            delta.dRow,
          ),
          state.keys,
          "تحريك",
        ),
      };
    }
    return { state: NO_STATE };
  }

  override preview(ctx: ToolContext, state: ToolState): ToolPreview {
    if (state.kind === "marquee") {
      const box = rectFromPoints(state.from, state.to);
      const keys = new Set(marqueeSelection(ctx.config, ctx.items, box));
      for (const key of state.base) keys.add(key);
      return {
        items: ctx.items.filter((item) => keys.has(item.key)),
        mode: "ghost",
        keys: [],
        marquee: box,
        marker: null,
      };
    }
    if (state.kind === "move") {
      const delta = moveDelta(ctx, state);
      if (delta.dColumn === 0 && delta.dRow === 0) return EMPTY_PREVIEW;
      return {
        items: shiftSelection(
          ctx.config,
          ctx.items,
          [...state.keys],
          delta.dColumn,
          delta.dRow,
        ),
        mode: "ghost",
        keys: [],
        marquee: null,
        marker: null,
      };
    }
    return EMPTY_PREVIEW;
  }
}

function cellAt(ctx: ToolContext, point: Point): Cell {
  return inkAnchorAt(ctx.config, point);
}

function moveDelta(
  ctx: ToolContext,
  state: Extract<ToolState, { kind: "move" }>,
): { dColumn: number; dRow: number } {
  return clampDelta(
    ctx.config,
    ctx.items,
    state.keys,
    state.to.column - state.from.column,
    state.to.row - state.from.row,
  );
}

/* ------------------------------------------------------------------ */
/* Pen                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The pen colours the cells the pointer is moved over: one fragment per
 * pointer position, painted **over** whatever is already there (same key →
 * replaced), which is how recolouring works in the old app. Nothing is drawn
 * between two positions — a stroke is exactly the cells that were visited —
 * and nothing is previewed before the pointer touches the canvas.
 */
class PenTool extends KufiTool {
  readonly id = "pen" as const;
  readonly label = "قلم";
  readonly shortcut = "P";
  readonly cursor = "cursor-crosshair";
  readonly icon: readonly ToolIconPart[] = [
    { d: "M4 20 L4.8 15.4 L15.6 4.6 L19.4 8.4 L8.6 19.2 Z" },
    { d: "M13.8 6.4 L17.6 10.2" },
    { d: "M6 18.6 L4.4 21.6 L7.4 20" },
  ];

  begin(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    void state;
    return { state: { kind: "pen", anchors: [anchorAt(ctx.config, input.point)] } };
  }

  move(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    if (state.kind !== "pen") return unchanged(state);
    const anchor = anchorAt(ctx.config, input.point);
    // One fragment per pointer position, and an anchor's key is its identity,
    // so the same cell is never listed twice.
    const taken = new Set(state.anchors.map(anchorKey));
    if (taken.has(anchorKey(anchor))) return unchanged(state);
    return { state: { kind: "pen", anchors: [...state.anchors, anchor] } };
  }

  end(ctx: ToolContext, state: ToolState): ToolOutcome {
    if (state.kind !== "pen") return { state: NO_STATE };
    const painted = this.items(ctx, state.anchors);
    if (painted.length === 0) return { state: NO_STATE };
    const next = paintItems({ items: ctx.items }, painted).items;
    if (next === ctx.items) return { state: NO_STATE };
    return {
      state: NO_STATE,
      commit: commit([...next], ctx.selection, "رسم"),
    };
  }

  override preview(ctx: ToolContext, state: ToolState): ToolPreview {
    if (state.kind !== "pen") return EMPTY_PREVIEW;
    return {
      items: this.items(ctx, state.anchors),
      mode: "solid",
      keys: [],
      marquee: null,
      marker: null,
    };
  }

  /** The pen's fragments, from the in-flight anchors and the draw style. */
  private items(ctx: ToolContext, anchors: readonly Anchor[]): CanvasItem[] {
    return penItems(ctx.config, anchors, {
      shape: ctx.style.shape,
      rotation: ctx.style.rotation,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Line                                                                */
/* ------------------------------------------------------------------ */

/**
 * The line tool is a click sequence, not a drag: the first click starts a run,
 * each further click extends it, and clicking the last point again commits an
 * open polyline while clicking the first one commits a closed one (`Z`). That
 * is exactly the reference app's behaviour. A run with a diagonal part is
 * stroked; a run made only of axis-aligned segments is drawn as
 * `config.straightLinesAsSquares` says — one square per cell, or one solid bar.
 */
class LineTool extends KufiTool {
  readonly id = "line" as const;
  readonly label = "خط";
  readonly shortcut = "L";
  readonly cursor = "cursor-crosshair";
  override readonly persistent = true;
  override readonly hint =
    "انقر لتحديد النقاط، ثم انقر النقطة الأخيرة للإنهاء أو الأولى للإغلاق";
  readonly icon: readonly ToolIconPart[] = [
    { d: "M5 19 L19 5" },
    {
      d: "M3.6 17.4 a 1.8 1.8 0 1 0 3.6 0 a 1.8 1.8 0 1 0 -3.6 0",
      mode: "fill",
    },
    {
      d: "M16.8 3.6 a 1.8 1.8 0 1 0 3.6 0 a 1.8 1.8 0 1 0 -3.6 0",
      mode: "fill",
    },
  ];

  begin(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    const anchor = inkAnchorAt(ctx.config, input.point);
    return this.extend(ctx, state, { column: anchor.column, row: anchor.row });
  }

  /**
   * Adds `cell` to the run held in `state`, or finishes it: clicking the last
   * point ends the polyline, clicking the first one closes it.
   */
  private extend(ctx: ToolContext, state: ToolState, cell: Cell): ToolOutcome {
    if (state.kind !== "line") {
      return { state: { kind: "line", points: [cell], hover: null } };
    }
    const points = state.points;
    const first = points[0];
    const last = points[points.length - 1];
    if (last.column === cell.column && last.row === cell.row) {
      return this.finish(ctx, points, false);
    }
    if (
      points.length >= 2 &&
      first.column === cell.column &&
      first.row === cell.row
    ) {
      return this.finish(ctx, points, true);
    }
    return {
      state: { kind: "line", points: [...points, cell], hover: null },
    };
  }

  /** Commits the run (`closed` adds the closing segment). */
  private finish(
    ctx: ToolContext,
    points: readonly Cell[],
    closed: boolean,
  ): ToolOutcome {
    const items = lineItems(ctx.config, points, closed);
    if (items.length === 0) return { state: NO_STATE };
    const next = addItems({ items: ctx.items }, items).items;
    if (next === ctx.items) return { state: NO_STATE };
    return { state: NO_STATE, commit: commit([...next], ctx.selection, "خط") };
  }

  move(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    if (state.kind !== "line") return unchanged(state);
    const anchor = inkAnchorAt(ctx.config, input.point);
    const hover: Cell = { column: anchor.column, row: anchor.row };
    if (
      state.hover !== null &&
      state.hover.column === hover.column &&
      state.hover.row === hover.row
    ) {
      return unchanged(state);
    }
    return { state: { ...state, hover } };
  }

  end(ctx: ToolContext, state: ToolState): ToolOutcome {
    void ctx;
    // Pointer-up only ends the *drag*; the click sequence lives on.
    return { state, keep: true };
  }

  override preview(ctx: ToolContext, state: ToolState): ToolPreview {
    if (state.kind !== "line" || state.points.length === 0) return EMPTY_PREVIEW;
    const first = state.points[0];
    return {
      items: linePreview(ctx.config, state.points, state.hover, false),
      mode: "ghost",
      keys: [],
      marquee: null,
      marker: first
        ? { column: first.column, row: first.row, zone: 0 }
        : null,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Eraser                                                              */
/* ------------------------------------------------------------------ */

class EraserTool extends KufiTool {
  readonly id = "eraser" as const;
  readonly label = "ممحاة";
  readonly shortcut = "E";
  readonly cursor = "cursor-cell";
  readonly icon: readonly ToolIconPart[] = [
    { d: "M4 15 L11 8 L19.5 16.5 L15.5 20.5 L8.5 20.5 Z" },
    { d: "M9.5 9.5 L18 18" },
  ];

  begin(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    void state;
    const hit = hitTest(ctx.config, ctx.items, input.point);
    return { state: { kind: "erase", keys: hit ? [hit.key] : [] } };
  }

  move(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    if (state.kind !== "erase") return unchanged(state);
    const hit = hitTest(ctx.config, ctx.items, input.point);
    if (!hit || state.keys.includes(hit.key)) return unchanged(state);
    return { state: { kind: "erase", keys: [...state.keys, hit.key] } };
  }

  end(ctx: ToolContext, state: ToolState): ToolOutcome {
    if (state.kind !== "erase" || state.keys.length === 0) {
      return { state: NO_STATE };
    }
    const next = removeItems({ items: ctx.items }, state.keys).items;
    if (next === ctx.items) return { state: NO_STATE };
    const doomed = new Set(state.keys);
    return {
      state: NO_STATE,
      commit: commit(
        [...next],
        ctx.selection.filter((key) => !doomed.has(key)),
        "مسح",
      ),
    };
  }

  override preview(ctx: ToolContext, state: ToolState): ToolPreview {
    if (state.kind !== "erase" || state.keys.length === 0) return EMPTY_PREVIEW;
    const doomed = new Set(state.keys);
    return {
      items: ctx.items.filter((item) => doomed.has(item.key)),
      mode: "ghost",
      keys: state.keys,
      marquee: null,
      marker: null,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Arc                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The rib (قوس): from one ink cell to another on the same row, the same column
 * or a 45° diagonal. Direction and size come from the tool's own controls —
 * docs/CANVAS.md §5 is the geometry, and the Arc item class owns the maths.
 *
 * It takes **both** gestures: drag from A to B (pointer-down arms, pointer-up
 * commits), or click A then click B (the state survives pointer-up, so the
 * second click commits and a click on the origin cancels).
 */
class ArcTool extends KufiTool {
  readonly id = "arc" as const;
  readonly label = "قوس";
  readonly shortcut = "A";
  readonly cursor = "cursor-crosshair";
  override readonly persistent = true;
  readonly icon: readonly ToolIconPart[] = [
    { d: "M4 18 A 8 8 0 0 1 20 18" },
    { d: "M4 18 L4 21.5" },
    { d: "M20 18 L20 21.5" },
  ];

  begin(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    const anchor = inkAnchorAt(ctx.config, input.point);
    if (state.kind !== "arc") {
      // First click / pointer-down: arm the tool at this cell.
      return { state: { kind: "arc", from: anchor, to: anchor } };
    }
    // Second click: clicking the origin again cancels, otherwise commit now.
    if (state.from.column === anchor.column && state.from.row === anchor.row) {
      return { state: NO_STATE };
    }
    return this.commit(ctx, state.from, anchor);
  }

  /**
   * Tracks the end cell. The controller calls this on hover too (the tool is
   * `persistent`), which is what lets click-click show the pending arc between
   * the two clicks.
   */
  move(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    if (state.kind !== "arc") return unchanged(state);
    const anchor = inkAnchorAt(ctx.config, input.point);
    if (anchor.column === state.to.column && anchor.row === state.to.row) {
      return unchanged(state);
    }
    return { state: { ...state, to: anchor } };
  }

  end(ctx: ToolContext, state: ToolState): ToolOutcome {
    if (state.kind !== "arc") return { state: NO_STATE };
    // A pointer-up on the armed cell is only the first click of a click
    // sequence, so the state survives and waits for the second click.
    if (state.from.column === state.to.column && state.from.row === state.to.row) {
      return { state, keep: true };
    }
    return this.commit(ctx, state.from, state.to);
  }

  override preview(ctx: ToolContext, state: ToolState): ToolPreview {
    if (state.kind !== "arc") return EMPTY_PREVIEW;
    const arc = this.between(ctx, state.from, state.to);
    return {
      items: arc ? [arc] : [],
      mode: "ghost",
      keys: [],
      marquee: null,
      marker: state.from,
    };
  }

  /** Commits the arc between two cells, or nothing when the pair cannot carry one. */
  private commit(ctx: ToolContext, from: Cell, to: Cell): ToolOutcome {
    const arc = this.between(ctx, from, to);
    if (!arc) return { state: NO_STATE };
    const next = addItems({ items: ctx.items }, [arc]).items;
    if (next === ctx.items) return { state: NO_STATE };
    return { state: NO_STATE, commit: commit([...next], ctx.selection, "قوس") };
  }

  private between(
    ctx: ToolContext,
    from: Cell,
    to: Cell,
  ): ArcItem | null {
    // The Arc class owns the geometry; `arcBetween` only supplies the style.
    if (from.column === to.column && from.row === to.row) return null;
    if (!Arc.isSupported(from, to)) return null;
    return arcBetween(ctx, from, to);
  }
}

/* ------------------------------------------------------------------ */
/* Hand                                                                */
/* ------------------------------------------------------------------ */

/**
 * The hand — the one *view* tool, and a deliberate exception to the shape of
 * the others: it draws nothing and owns no state. `pans` is the whole
 * contract (`docs/CANVAS.md` §6): the controller scrolls the viewport while
 * the pointer is down (`panScrollOffset`) and double-click recentres the board
 * (`centreScroll`). Nothing it does can reach the document, the undo stack or
 * the server, so its `begin` / `move` / `end` are empty on purpose.
 */
class HandTool extends KufiTool {
  readonly id = "hand" as const;
  readonly label = "يد";
  readonly shortcut = "H";
  readonly cursor = "cursor-grab active:cursor-grabbing";
  override readonly pans = true;
  override readonly hint =
    "اسحب لتحريك اللوحة، وانقر نقرتين لإرجاعها إلى المنتصف";
  readonly icon: readonly ToolIconPart[] = [
    { d: "M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" },
    { d: "M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" },
    { d: "M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" },
    {
      d: "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
    },
  ];

  begin(): ToolOutcome {
    return { state: NO_STATE };
  }

  move(): ToolOutcome {
    return { state: NO_STATE };
  }

  end(): ToolOutcome {
    return { state: NO_STATE };
  }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const REGISTRY: Readonly<Record<ToolId, KufiTool>> = {
  select: new SelectTool(),
  pen: new PenTool(),
  line: new LineTool(),
  eraser: new EraserTool(),
  arc: new ArcTool(),
  hand: new HandTool(),
};

/** Rail order (RTL: first = closest to the canvas edge). */
export const TOOL_ORDER: readonly ToolId[] = [
  "select",
  "pen",
  "line",
  "eraser",
  "arc",
  "hand",
];

/** The registered tools, in rail order — the one list the UI reads. */
export const TOOLS: readonly KufiTool[] = TOOL_ORDER.map((id) => REGISTRY[id]);

export function toolOf(id: ToolId): KufiTool {
  return REGISTRY[id];
}

export function isToolId(value: string): value is ToolId {
  return value in REGISTRY;
}

/** Every shortcut, for the keyboard map. */
export const TOOL_SHORTCUTS: Readonly<Record<ToolId, string>> = Object.fromEntries(
  TOOL_ORDER.map((id) => [id, REGISTRY[id].shortcut]),
) as Record<ToolId, string>;

export const TOOL_LABELS: Readonly<Record<ToolId, string>> = Object.fromEntries(
  TOOL_ORDER.map((id) => [id, REGISTRY[id].label]),
) as Record<ToolId, string>;

/** The tool whose class declares `key`, or `null`. */
export function toolForShortcut(key: string): ToolId | null {
  const upper = key.toUpperCase();
  for (const id of TOOL_ORDER) {
    if (REGISTRY[id].shortcut === upper) return id;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

export function beginTool(
  tool: ToolId,
  ctx: ToolContext,
  state: ToolState,
  input: ToolInput,
): ToolOutcome {
  return REGISTRY[tool].begin(ctx, state, input);
}

export function moveTool(
  tool: ToolId,
  ctx: ToolContext,
  state: ToolState,
  input: ToolInput,
): ToolOutcome {
  return REGISTRY[tool].move(ctx, state, input);
}

/** Pointer-up — only tools that own a drag state end their gesture here. */
export function endTool(
  tool: ToolId,
  ctx: ToolContext,
  state: ToolState,
): ToolOutcome {
  return REGISTRY[tool].end(ctx, state);
}

export function previewTool(
  tool: ToolId,
  ctx: ToolContext,
  state: ToolState,
): ToolPreview {
  return REGISTRY[tool].preview(ctx, state);
}

/** Unused re-exports kept out: `ArcStyle` / `DrawStyle` live in `interaction`. */
export type { ArcStyle, DrawStyle };
