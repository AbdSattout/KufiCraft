/**
 * KufiCraft — editor keyboard map (pure, no React, no DOM).
 *
 * The editor listens on `window`, so `shortcutFor` takes a minimal event
 * shape and refuses to fire while the user is typing in a field. The global
 * shortcuts are exactly the ones documented in docs/UI.md §Editor plus
 * `Ctrl+D` (duplicate), `Ctrl+A` (select all), `R` (rotate the current shape),
 * the view keys `+` / `-` / `0` (zoom) and `G` (the grid guide), and the
 * arrange keys `Ctrl+[` / `Ctrl+]` (add Shift for the extremes).
 *
 * Tool keys come from the tool classes (`TOOL_SHORTCUTS`) and shape digits from
 * the shape registry (`SHAPE_ORDER`), so this map cannot drift from the UI.
 * `shortcut-hints.ts` is the one place that writes these keys down again for
 * the UI to show, and its test walks both directions.
 */

import type { GridType, ShapeId } from "@/lib/canvas/model";
import type { ArrangeAction } from "@/lib/canvas/ops";
import { SHAPE_ORDER } from "@/lib/canvas/shapes";
import { toolForShortcut } from "./tools";
import type { ToolId } from "./interaction";

export type EditorShortcut =
  | { kind: "tool"; tool: ToolId }
  | { kind: "shape"; shape: ShapeId }
  | { kind: "arrange"; action: ArrangeAction }
  | { kind: "delete" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "duplicate" }
  | { kind: "rotate" }
  | { kind: "cancel" }
  | { kind: "selectAll" }
  | { kind: "zoomIn" }
  | { kind: "zoomOut" }
  | { kind: "zoomReset" }
  | { kind: "toggleGrid" };

/** The event fields the map reads — `KeyboardEvent` satisfies this. */
export interface ShortcutEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: {
    tagName?: string;
    isContentEditable?: boolean;
  } | null;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION"]);

function isTyping(event: ShortcutEvent): boolean {
  const target = event.target;
  if (!target) return false;
  if (target.isContentEditable) return true;
  return target.tagName ? TYPING_TAGS.has(target.tagName.toUpperCase()) : false;
}

/** Primary modifier: `Ctrl` on Windows/Linux, `Cmd` on macOS. */
function hasPrimary(event: ShortcutEvent): boolean {
  return event.ctrlKey === true || event.metaKey === true;
}

/**
 * `gridType` is the board's grid, when the caller knows it (`docs/CANVAS.md`
 * §3): a tool the grid does not carry has no shortcut there, so `L` and `A`
 * stay inert on a circular board instead of arming an invisible tool. Others
 * may omit it — no grid, no per-grid filtering.
 */
export function shortcutFor(
  event: ShortcutEvent,
  gridType?: GridType,
): EditorShortcut | null {
  if (isTyping(event)) return null;
  const key = event.key;

  if (hasPrimary(event)) {
    switch (key.toLowerCase()) {
      case "z":
        return event.shiftKey ? { kind: "redo" } : { kind: "undo" };
      case "y":
        return { kind: "redo" };
      case "d":
        return { kind: "duplicate" };
      case "a":
        return { kind: "selectAll" };
      // Illustrator / Figma: `Ctrl+]` brings forward, `Shift` sends to the
      // extreme; the brackets mirror themselves (`Ctrl+[` sends backward).
      // The brace spellings are the same physical keys: browsers report the
      // **shifted character** for a Shift combo that produces no control
      // character (`}` for Ctrl+Shift+`]`), and layouts that put the brackets
      // on the Shift or AltGr layer produce `{` / `}` for them too.
      case "]":
        return {
          kind: "arrange",
          action: event.shiftKey ? "front" : "forward",
        };
      case "}":
        return { kind: "arrange", action: "front" };
      case "[":
        return {
          kind: "arrange",
          action: event.shiftKey ? "back" : "backward",
        };
      case "{":
        return { kind: "arrange", action: "back" };
      default:
        return null;
    }
  }

  if (key === "Delete" || key === "Backspace") return { kind: "delete" };
  if (key === "Escape") return { kind: "cancel" };
  if (key === "Enter") return { kind: "cancel" };

  // View keys, plain: a primary modifier here would fight the browser's own
  // page zoom (`Ctrl` + `+` / `-` / `0`).
  if (key === "+" || key === "=") return { kind: "zoomIn" };
  if (key === "-") return { kind: "zoomOut" };
  if (key === "0") return { kind: "zoomReset" };

  if (/^[1-9]$/.test(key)) {
    const shape = SHAPE_ORDER[Number(key) - 1];
    return shape ? { kind: "shape", shape } : null;
  }

  if (key.toLowerCase() === "r") return { kind: "rotate" };
  if (key.toLowerCase() === "g") return { kind: "toggleGrid" };

  const tool = toolForShortcut(key, gridType);
  return tool ? { kind: "tool", tool } : null;
}
