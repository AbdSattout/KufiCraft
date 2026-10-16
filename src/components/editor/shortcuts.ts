/**
 * KufiCraft — editor keyboard map (pure, no React, no DOM).
 *
 * The editor listens on `window`, so `shortcutFor` takes a minimal event
 * shape and refuses to fire while the user is typing in a field. The global
 * shortcuts are exactly the ones documented in docs/UI.md §Editor plus
 * `Ctrl+D` (duplicate) and `R` (rotate the current shape).
 */

import type { TileShape } from "@/lib/canvas/model";
import { SHAPE_ORDER } from "./interaction";
import type { Tool } from "./interaction";

export type EditorShortcut =
  | { kind: "tool"; tool: Tool }
  | { kind: "shape"; shape: TileShape }
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
      default:
        return null;
    }
  }

  if (key === "Delete" || key === "Backspace") return { kind: "delete" };
  if (key === "Escape") return { kind: "cancel" };

  if (/^[1-9]$/.test(key)) {
    const shape = SHAPE_ORDER[Number(key) - 1];
    return shape ? { kind: "shape", shape } : null;
  }

  switch (key.toLowerCase()) {
    case "v":
      return { kind: "tool", tool: "select" };
    case "p":
      return { kind: "tool", tool: "pen" };
    case "e":
      return { kind: "tool", tool: "eraser" };
    case "a":
      return { kind: "tool", tool: "arch" };
    case "r":
      return { kind: "rotate" };
    default:
      return null;
  }
}
