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
 * `toolsFor(grid)` (the board's tools, in `TOOLS` order), shortcuts and labels
 * come from the classes, and the controller dispatches through `beginTool` /
 * `moveTool` / `endTool` / `previewTool` instead of switching on a tool name.
 * Adding a tool means adding a class and one line in `REGISTRY` — nothing else
 * in the editor changes.
 *
 * The items a tool produces are built by the item classes in
 * `@/lib/canvas/items`, so a tool never hand-writes geometry.
 */

import { linePoint, sameLinePoint } from "@/lib/canvas/model";
import type {
  Anchor,
  ArcItem,
  ArcPoint,
  CanvasItem,
  CanvasItemType,
  GridType,
  LinePoint,
} from "@/lib/canvas/model";
import type { Point, Rect } from "@/lib/canvas/geometry";
import { addItems, lineItems, paintItems, penItems, removeItems } from "@/lib/canvas/ops";
import { Arc, isItemTypeAllowed } from "@/lib/canvas/items";
import { linePointPosition, smartArcPoints } from "@/lib/canvas/grid";
import {
  anchorKey,
  anchorAt,
  anchorsAlongLine,
  anchorsAlongStroke,
  arcBetween,
  arcPointAt,
  clampMoveOffset,
  clampToCanvas,
  hitTest,
  linePointAt,
  linePreview,
  lineRun,
  marqueeSelection,
  moveItemsWithSelection,
  moveOffset,
  rectFromPoints,
  shiftSelection,
  type ArcStyle,
  type DrawStyle,
  type MoveOffset,
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
  | { kind: "pen"; anchors: Anchor[]; cursor: Anchor; cursorPoint: Point }
  | { kind: "erase"; keys: string[]; from: Anchor }
  | { kind: "arc"; from: LinePoint | null; to: LinePoint }
  | { kind: "line"; points: LinePoint[]; hover: LinePoint | null }
  | { kind: "marquee"; from: Point; to: Point; base: readonly string[] }
  | {
      kind: "move";
      /** Pointer anchors: the whole-cell and half-cell translation rides here. */
      from: Anchor;
      to: Anchor;
      keys: readonly string[];
    };

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
  /**
   * The armed start point of a click sequence (line / arc), painted as the
   * snap dot — the actual stored point, not the whole cell.
   */
  marker: LinePoint | null;
  /** The point the next click would store (the line / arc tool's hover). */
  dot: LinePoint | null;
}

const EMPTY_PREVIEW: ToolPreview = {
  items: [],
  mode: "ghost",
  keys: [],
  marquee: null,
  marker: null,
  dot: null,
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
  /**
   * The item types this tool creates — the grid rule the whole editor reads.
   * A tool is usable only on boards that carry its items (`isToolAvailable`):
   * a circular board has no `line` and no `arc`, so those tools are absent
   * from the rail and inert on the keyboard. Tools that create nothing
   * (select, eraser, hand) are available everywhere.
   */
  readonly creates: readonly CanvasItemType[] = [];
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

  /**
   * Settles a live gesture when the user chooses a **different** tool. The
   * default drops it: only a tool whose sequence is already meaningful
   * without more input commits here (the line tool does). Re-clicking the
   * active tool is handled by `leaveTool` as a cancel, never a settle.
   */
  settle(ctx: ToolContext, state: ToolState): ToolOutcome {
    void ctx;
    void state;
    return { state: NO_STATE };
  }

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
    const anchor = anchorAt(ctx.config, input.point);
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
        state: { kind: "move", from: anchor, to: anchor, keys: selection },
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
      const anchor = anchorAt(ctx.config, input.point);
      if (
        anchor.column === state.to.column &&
        anchor.row === state.to.row &&
        anchor.zone === state.to.zone
      ) {
        return unchanged(state);
      }
      return { state: { ...state, to: anchor } };
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
      const offset = moveFor(ctx, state);
      if (
        offset.dColumn === 0 &&
        offset.dRow === 0 &&
        offset.dHalfColumn === 0 &&
        offset.dHalfRow === 0
      ) {
        return { state: NO_STATE };
      }
      // The committed selection is the moved items' **new** keys: a key
      // embeds the cell and zone, so keeping `state.keys` would leave the
      // selection pointing at fragments that no longer exist (`pruneSelection`
      // drops them on the next render). The whole board rides along because a
      // commit is diffed against the document (`toOps`); fragments alone would
      // read as "delete everything else".
      const moved = moveItemsWithSelection(
        ctx.config,
        ctx.items,
        [...state.keys],
        offset,
      );
      return {
        state: NO_STATE,
        commit: commit(moved.items, moved.keys, "تحريك"),
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
        dot: null,
      };
    }
    if (state.kind === "move") {
      const offset = moveFor(ctx, state);
      if (
        offset.dColumn === 0 &&
        offset.dRow === 0 &&
        offset.dHalfColumn === 0 &&
        offset.dHalfRow === 0
      ) {
        return EMPTY_PREVIEW;
      }
      // The same offset the commit resolves: a 1:1 zone drag previews the
      // fragments in their translated cells, not only their cell delta.
      return {
        items: shiftSelection(
          ctx.config,
          ctx.items,
          [...state.keys],
          offset,
        ),
        mode: "ghost",
        keys: [],
        marquee: null,
        marker: null,
        dot: null,
      };
    }
    return EMPTY_PREVIEW;
  }
}

/**
 * The move a drag has resolved so far, clamped to the grid. Preview and
 * commit both call this, so the ghost and the stored board cannot disagree.
 *
 * At 1:1 a pointer that changes zone inside a cell still moves the item by a
 * signed half-cell step (`moveOffset`); at denser ratios the half step is zero
 * and the zones ride along unchanged, because changing one would resize the
 * fragment.
 */
function moveFor(
  ctx: ToolContext,
  state: Extract<ToolState, { kind: "move" }>,
): MoveOffset {
  return clampMoveOffset(
    ctx.config,
    ctx.items,
    state.keys,
    moveOffset(ctx.config, state.from, state.to),
  );
}

/* ------------------------------------------------------------------ */
/* Pen                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The pen colours the cells the pointer is moved over: one fragment per cell,
 * painted **over** whatever is already there (same key → replaced), which is
 * how recolouring works in the old app. Nothing is previewed before the
 * pointer touches the canvas: the in-flight fragments are the real items.
 *
 * The pointer reports one position per event, so a fast drag flies over whole
 * cells and over several fragments inside each. The segment between the
 * pointer's last reported position and the new one is filled with
 * `anchorsAlongStroke`, which keeps the real path and paints every fragment it
 * swept — the ink square *and* the paper strip of each cell, exactly as a slow
 * drag over the same path would. The fill's source is the pointer
 * (`cursorPoint`), never the last stored fragment: a pointer that retraces the
 * stroke stores nothing — dedup decides what is painted, not where the fill
 * starts — so retracing to the junction of a T and turning up paints the turn,
 * not a chord across the bar. And the pen still never merges a run into a bar.
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
    const point = clampToCanvas(input.point);
    const anchor = anchorAt(ctx.config, point);
    return {
      state: {
        kind: "pen",
        anchors: [anchor],
        cursor: anchor,
        cursorPoint: point,
      },
    };
  }

  move(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    if (state.kind !== "pen") return unchanged(state);
    const point = clampToCanvas(input.point);
    const anchor = anchorAt(ctx.config, point);
    // The fill runs from the pointer's live position, never from the stroke's
    // last stored fragment: a pointer that retraces already-painted cells
    // stores nothing, and fuelling the next fill from the tail would paint the
    // chord the pointer never walked (the T's bar-to-stem jump).
    const cursor = state.cursor;
    const sameCell =
      cursor.column === anchor.column && cursor.row === anchor.row;
    // The walk keeps the pointer's real segment and every fragment it swept,
    // so a fast drag is as filled as a slow one. Inside one cell only the
    // fragment(s) under the pointer can change; the cross-cell walk brings the
    // cells and fragments the pointer flew over along with it.
    const candidates = anchorsAlongStroke(ctx.config, state.cursorPoint, point);
    // An anchor's key is its identity, so a fragment is never listed twice and
    // the already-painted part of the line is dropped, not re-added. De-dup
    // decides what is stored — never where the fill starts.
    const taken = new Set(state.anchors.map(anchorKey));
    const fresh = candidates.filter(
      (candidate) => !taken.has(anchorKey(candidate)),
    );
    if (fresh.length === 0) {
      // Nothing to store, but the pointer still moved: keep the fill's source
      // live, or a retrace would freeze the pen at the stroke's tail.
      if (sameCell) return unchanged(state);
      return { state: { ...state, cursor: anchor, cursorPoint: point } };
    }
    return {
      state: {
        ...state,
        anchors: [...state.anchors, ...fresh],
        cursor: anchor,
        cursorPoint: point,
      },
    };
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
      dot: null,
    };
  }

  /** The pen's fragments, from the in-flight anchors and the draw style. */
  private items(ctx: ToolContext, anchors: readonly Anchor[]): CanvasItem[] {
    return penItems(ctx.config, anchors, {
      shape: ctx.style.shape,
      rotation: ctx.style.rotation,
      rounding: ctx.style.rounding,
      border: ctx.style.border,
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
 * is exactly the reference app's behaviour.
 *
 * Clicks land on the nine anchors of the fragment under the cursor
 * (`linePointAt`), so a run can turn and end inside a cell; the overlay shows
 * a dot on the anchor the next click would store. In smart mode the same
 * fragment is used but every point is its centre, which is the mobile default.
 * Both the ghost and the committed run are resolved by `lineRun` +
 * `lineItems`, so the preview shows the *same* endpoints the click stores. A
 * run with a diagonal part, or with anchored points, is stroked; a run made
 * only of centre points and axis-aligned segments is drawn as
 * `config.straightLinesAsSquares` says — one square per cell, or one solid bar.
 */
class LineTool extends KufiTool {
  readonly id = "line" as const;
  readonly label = "خط";
  readonly shortcut = "L";
  readonly cursor = "cursor-crosshair";
  override readonly persistent = true;
  override readonly creates = ["line"] as const;
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
    const point = linePointAt(ctx.config, input.point, ctx.smartPoints);
    const points = state.kind === "line" ? state.points : [];
    const run = lineRun(points, point);
    if (!run.finished) {
      return { state: { kind: "line", points: run.points, hover: null } };
    }
    return this.commitRun(ctx, run.points, run.closed);
  }

  /**
   * Tracks the anchor under the cursor — on hover too (the tool is
   * `persistent`), because the dot it produces is where the next click lands.
   * The hover is a *pending* click: it is the same value `begin` would store,
   * so the two can never drift apart.
   */
  move(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    if (state.kind !== "none" && state.kind !== "line") return unchanged(state);
    const hover = linePointAt(ctx.config, input.point, ctx.smartPoints);
    if (state.kind === "line" && state.hover !== null && sameLinePoint(state.hover, hover)) {
      return unchanged(state);
    }
    return {
      state: {
        kind: "line",
        points: state.kind === "line" ? state.points : [],
        hover,
      },
    };
  }

  end(ctx: ToolContext, state: ToolState): ToolOutcome {
    void ctx;
    // Pointer-up only ends the *drag*; the click sequence lives on.
    return { state, keep: true };
  }

  override preview(ctx: ToolContext, state: ToolState): ToolPreview {
    if (state.kind !== "line") return EMPTY_PREVIEW;
    return {
      items: linePreview(ctx.config, state.points, state.hover, ctx.style),
      mode: "ghost",
      keys: [],
      marquee: null,
      marker: state.points[0] ?? null,
      dot: state.hover,
    };
  }

  /**
   * Leaving the line tool draws the points already clicked as an open run —
   * switching to another tool must not silently discard a visible sequence.
   * One point still has no segment (`lineItems` returns nothing), and
   * `leaveTool` keeps selecting the line tool again as an explicit cancel.
   */
  override settle(ctx: ToolContext, state: ToolState): ToolOutcome {
    if (state.kind !== "line" || state.points.length < 2) {
      return { state: NO_STATE };
    }
    return this.commitRun(ctx, state.points, false);
  }

  /** Commits a finished run — the exact points and closing the preview showed. */
  private commitRun(
    ctx: ToolContext,
    points: readonly LinePoint[],
    closed: boolean,
  ): ToolOutcome {
    const items = lineItems(ctx.config, points, closed, undefined, ctx.style);
    if (items.length === 0) return { state: NO_STATE };
    const next = addItems({ items: ctx.items }, items).items;
    if (next === ctx.items) return { state: NO_STATE };
    return { state: NO_STATE, commit: commit([...next], ctx.selection, "خط") };
  }
}

/* ------------------------------------------------------------------ */
/* Eraser                                                              */
/* ------------------------------------------------------------------ */

/**
 * The eraser removes whatever the pointer touches. The reported position is
 * exact, and the cells a fast drag flew over between two reported positions are
 * swept at the centre of the fragment the sweep carries (the target anchor's
 * zone, in the same spirit as the pen's gap fill), so a quick sweep does not
 * skip the items it passed over — ink or space. The sweep also runs from the
 * pointer's **live** cell (`from`), so a sweep that retraces itself does not
 * brush the chord its stale end would draw.
 */
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
    return {
      state: {
        kind: "erase",
        keys: hit ? [hit.key] : [],
        from: anchorAt(ctx.config, input.point),
      },
    };
  }

  move(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    if (state.kind !== "erase") return unchanged(state);
    const anchor = anchorAt(ctx.config, input.point);
    const keys = new Set(state.keys);
    const hit = hitTest(ctx.config, ctx.items, input.point);
    if (hit) keys.add(hit.key);
    for (const step of anchorsAlongLine(ctx.config, state.from, anchor)) {
      // The sweep carries the target anchor's zone (`anchorsAlongLine`), so
      // sample **that fragment's** centre: a fast drag over a space fragment
      // must brush it exactly like an ink one, and must not brush the ink
      // square beside it.
      const brushed = hitTest(
        ctx.config,
        ctx.items,
        linePointPosition(
          ctx.config,
          linePoint(step.column, step.row, step.zone),
        ),
      );
      if (brushed) keys.add(brushed.key);
    }
    // The sweep's source is the live pointer, for the pen's reason: a retrace
    // adds no keys, and a sweep fuelled by a stale `from` would brush the
    // chord it never walked.
    const moved =
      anchor.column !== state.from.column || anchor.row !== state.from.row;
    if (keys.size === state.keys.length && !moved) return unchanged(state);
    return { state: { kind: "erase", keys: [...keys], from: anchor } };
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
      dot: null,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Arc                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The rib (قوس): from one **fragment** to another on the same row, the same
 * column or a 45° diagonal. Each endpoint is a **user-picked point** — the
 * same nine anchors the line tool uses (`arcPointAt`), on the fragment under
 * the pointer and stored whole with the centre included, because for an arc
 * endpoint an absent anchor means the legacy spring point (docs/CANVAS.md §5).
 * With smart mode on, the tap's exact anchor is replaced by the pair rule
 * (`smartArcPoints`): top/bottom middle for a horizontal chord, left/right
 * middle for a vertical one, both centres otherwise.
 * Direction and size come from the tool's own controls; the Arc item class
 * owns the maths.
 *
 * It takes **both** gestures: drag from A to B (pointer-down arms, pointer-up
 * commits), or click A then click B (the state survives pointer-up, so the
 * second click commits and a click on the origin cancels). The overlay's dot
 * marks the point the next click would store, and the armed start is painted
 * as the same dot on its own point — never a whole-cell square.
 */
class ArcTool extends KufiTool {
  readonly id = "arc" as const;
  readonly label = "قوس";
  readonly shortcut = "A";
  readonly cursor = "cursor-crosshair";
  override readonly persistent = true;
  override readonly creates = ["arc"] as const;
  readonly icon: readonly ToolIconPart[] = [
    { d: "M4 18 A 8 8 0 0 1 20 18" },
    { d: "M4 18 L4 21.5" },
    { d: "M20 18 L20 21.5" },
  ];

  begin(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    const point = arcPointAt(ctx.config, input.point);
    if (state.kind !== "arc" || state.from === null) {
      // First click / pointer-down: arm the tool at this exact point.
      return { state: { kind: "arc", from: point, to: point } };
    }
    // Second click: clicking the origin again cancels, otherwise commit now.
    if (sameArcCell(state.from, point)) {
      return { state: NO_STATE };
    }
    return this.commit(ctx, state.from, point);
  }

  /**
   * Tracks the point under the cursor — on hover too (the tool is
   * `persistent`), because the dot it produces is where the next click lands.
   * Before the first click the state is hover-only (`from: null`), so the dot
   * shows the pending start without a ghost arc.
   */
  move(ctx: ToolContext, state: ToolState, input: ToolInput): ToolOutcome {
    const point = arcPointAt(ctx.config, input.point);
    const from = state.kind === "arc" ? state.from : null;
    if (
      state.kind === "arc" &&
      state.from !== null &&
      sameArcPoint(state.to, point)
    ) {
      return unchanged(state);
    }
    return { state: { kind: "arc", from, to: point } };
  }

  end(ctx: ToolContext, state: ToolState): ToolOutcome {
    if (state.kind !== "arc" || state.from === null) return { state: NO_STATE };
    // A pointer-up on the armed cell is only the first click of a click
    // sequence, so the state survives and waits for the second click.
    if (sameArcCell(state.from, state.to)) {
      return { state, keep: true };
    }
    return this.commit(ctx, state.from, state.to);
  }

  override preview(ctx: ToolContext, state: ToolState): ToolPreview {
    if (state.kind !== "arc") return EMPTY_PREVIEW;
    const pair = this.resolve(ctx, state.from ?? state.to, state.to);
    const arc =
      state.from === null ? null : this.between(ctx, state.from, state.to);
    return {
      items: arc ? [arc] : [],
      mode: "ghost",
      keys: [],
      marquee: null,
      marker: state.from === null ? null : pair.from,
      dot: pair.to,
    };
  }

  /** Commits the arc between two points, or nothing when the pair cannot carry one. */
  private commit(ctx: ToolContext, from: ArcPoint, to: ArcPoint): ToolOutcome {
    const arc = this.between(ctx, from, to);
    if (!arc) return { state: NO_STATE };
    const next = addItems({ items: ctx.items }, [arc]).items;
    if (next === ctx.items) return { state: NO_STATE };
    return { state: NO_STATE, commit: commit([...next], ctx.selection, "قوس") };
  }

  /** The endpoints the commit will store: the exact clicks or the smart pair. */
  private resolve(
    ctx: ToolContext,
    from: ArcPoint,
    to: ArcPoint,
  ): { from: ArcPoint; to: ArcPoint } {
    return ctx.smartPoints
      ? smartArcPoints(from, to, ctx.arc.direction)
      : { from, to };
  }

  private between(
    ctx: ToolContext,
    from: ArcPoint,
    to: ArcPoint,
  ): ArcItem | null {
    const pair = this.resolve(ctx, from, to);
    // The Arc class owns the geometry; `arcBetween` only supplies the style.
    if (sameArcCell(pair.from, pair.to)) return null;
    if (!Arc.isSupported(pair.from, pair.to)) return null;
    return arcBetween(ctx, pair.from, pair.to);
  }
}

/** Whether two arc endpoints sit in the same cell (always a degenerate pair). */
function sameArcCell(a: ArcPoint, b: ArcPoint): boolean {
  return a.column === b.column && a.row === b.row;
}

/**
 * Whether two arc endpoints are the **same point**. Absence is a value on an
 * arc (`ArcPoint`), so a point without an anchor is not the same as one on the
 * centre — unlike `sameLinePoint`, which reads both as the centre.
 */
function sameArcPoint(a: ArcPoint, b: ArcPoint): boolean {
  if (a.column !== b.column || a.row !== b.row) return false;
  if ((a.zone ?? 0) !== (b.zone ?? 0)) return false;
  if (a.anchor === undefined || b.anchor === undefined) {
    return a.anchor === undefined && b.anchor === undefined;
  }
  return a.anchor.x === b.anchor.x && a.anchor.y === b.anchor.y;
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
export function toolForShortcut(key: string, gridType?: GridType): ToolId | null {
  const upper = key.toUpperCase();
  for (const id of TOOL_ORDER) {
    if (REGISTRY[id].shortcut !== upper) continue;
    // A tool the grid does not carry has no shortcut either: on a circular
    // board `L`/`A` are inert instead of arming an invisible tool.
    return gridType === undefined || isToolAvailable(gridType, id) ? id : null;
  }
  return null;
}

/**
 * Whether `id` is usable on a board of `gridType`. This is **the** per-grid
 * tool rule (`docs/CANVAS.md` §3, docs/UI.md §Editor): the rail lists
 * `toolsFor`, the keyboard asks `toolForShortcut`, and the controller falls
 * back to `fallbackTool` when the grid changes under an armed tool.
 */
export function isToolAvailable(gridType: GridType, id: ToolId): boolean {
  return REGISTRY[id].creates.every((type) => isItemTypeAllowed(gridType, type));
}

/** The tools of `gridType`, in rail order. */
export function toolsFor(gridType: GridType): readonly KufiTool[] {
  return TOOLS.filter((tool) => isToolAvailable(gridType, tool.id));
}

/** The tool to activate when the current one is not on this board. */
export function fallbackTool(gridType: GridType): ToolId {
  return TOOLS.find((tool) => isToolAvailable(gridType, tool.id))?.id ?? "select";
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

/**
 * Settles the active tool's gesture when the user chooses `next`. A real tool
 * change lets the old tool finish meaningful work (the line tool commits its
 * clicked points); choosing the same tool again only cancels the gesture.
 */
export function leaveTool(
  current: ToolId,
  next: ToolId,
  ctx: ToolContext,
  state: ToolState,
): ToolOutcome {
  if (current === next) return { state: NO_STATE };
  return REGISTRY[current].settle(ctx, state);
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
