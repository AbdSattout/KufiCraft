/**
 * KufiCraft — editor keyboard map (pure, no React, no DOM).
 *
 * The editor listens on `window`, so `shortcutFor` takes a minimal event
 * shape and refuses to fire while the user is typing in a field. The global
 * shortcuts are exactly the ones documented in docs/UI.md §Editor plus
 * `Ctrl+D` (duplicate), `R` (rotate the current shape) and the arrange keys
 * `Ctrl+[` / `Ctrl+]` (add Shift for the extremes).
 *
 * Tool keys come from the tool classes (`TOOL_SHORTCUTS`) and shape digits from
 * the shape registry (`SHAPE_ORDER`), so this map cannot drift from the UI.
 */

import type { ShapeId } from "@/lib/canvas/model";
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
  | { kind: "cancel" };

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

export function shortcutFor(event: ShortcutEvent): EditorShortcut | null {
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
      // Illustrator / Figma: `Ctrl+]` brings forward, `Shift` sends to the
      // extreme; the brackets mirror themselves (`Ctrl+[` sends backward).
      case "]":
        return {
          kind: "arrange",
          action: event.shiftKey ? "front" : "forward",
        };
      case "[":
        return {
          kind: "arrange",
          action: event.shiftKey ? "back" : "backward",
        };
      default:
        return null;
    }
  }

  if (key === "Delete" || key === "Backspace") return { kind: "delete" };
  if (key === "Escape") return { kind: "cancel" };
  if (key === "Enter") return { kind: "cancel" };

  if (/^[1-9]$/.test(key)) {
    const shape = SHAPE_ORDER[Number(key) - 1];
    return shape ? { kind: "shape", shape } : null;
  }

  if (key.toLowerCase() === "r") return { kind: "rotate" };

  const tool = toolForShortcut(key);
  return tool ? { kind: "tool", tool } : null;
}
