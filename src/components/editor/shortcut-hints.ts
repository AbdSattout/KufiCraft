/**
 * KufiCraft — the keyboard surface's labels (pure, no React, no DOM).
 *
 * Every control that shows a key reads it here instead of writing the key
 * down again, and `shortcuts.test.ts` walks the whole `EditorShortcut` union
 * back through `shortcutFor` — so a hint cannot describe a key the map would
 * not fire, and the tenth palette shape (which has no digit) gets no hint.
 *
 * The platform only picks the *name* of the primary modifier (`Ctrl` on
 * Windows/Linux, `Cmd` on macOS): the map's `hasPrimary` treats both alike.
 */

import type { ShapeId } from "@/lib/canvas/model";
import type { EditorShortcut } from "./shortcuts";
import { SHAPE_ORDER } from "./interaction";
import { TOOL_SHORTCUTS } from "./tools";

/** The digit row reaches the first nine palette entries; the tenth has no key. */
const DIGIT_SHAPES = 9;

export type PrimaryModifier = "Ctrl" | "Cmd";

/** The `1…9` digit a palette shape answers to, or `null` (the tenth glyph). */
export function shapeDigit(shape: ShapeId): string | null {
  const index = SHAPE_ORDER.indexOf(shape);
  return index >= 0 && index < DIGIT_SHAPES ? String(index + 1) : null;
}

/** The key text a control shows for a shortcut, e.g. `Cmd+Shift+]` or `Del`. */
export function shortcutLabel(
  shortcut: { kind: "shape"; shape: ShapeId },
  primary: PrimaryModifier,
): string | null;
export function shortcutLabel(
  shortcut: Exclude<EditorShortcut, { kind: "shape" }>,
  primary: PrimaryModifier,
): string;
export function shortcutLabel(
  shortcut: EditorShortcut,
  primary: PrimaryModifier,
): string | null;
export function shortcutLabel(
  shortcut: EditorShortcut,
  primary: PrimaryModifier,
): string | null {
  switch (shortcut.kind) {
    case "tool":
      return TOOL_SHORTCUTS[shortcut.tool];
    case "shape":
      return shapeDigit(shortcut.shape);
    case "arrange":
      switch (shortcut.action) {
        case "front":
          return `${primary}+Shift+]`;
        case "forward":
          return `${primary}+]`;
        case "backward":
          return `${primary}+[`;
        case "back":
          return `${primary}+Shift+[`;
        default:
          return assertNever(shortcut.action);
      }
    case "delete":
      return "Del";
    case "undo":
      return `${primary}+Z`;
    case "redo":
      return `${primary}+Shift+Z`;
    case "duplicate":
      return `${primary}+D`;
    case "rotate":
      return "R";
    case "cancel":
      return "Esc";
    case "selectAll":
      return `${primary}+A`;
    case "zoomIn":
      return "+";
    case "zoomOut":
      return "-";
    case "zoomReset":
      return "0";
    case "toggleGrid":
      return "G";
    default:
      return assertNever(shortcut);
  }
}

/**
 * The `aria-keyshortcuts` spelling — WAI-ARIA names the modifiers
 * (`Control` / `Meta`) and the control keys (`Delete`, `Escape`).
 */
export function shortcutAriaLabel(
  shortcut: { kind: "shape"; shape: ShapeId },
  primary: PrimaryModifier,
): string | null;
export function shortcutAriaLabel(
  shortcut: Exclude<EditorShortcut, { kind: "shape" }>,
  primary: PrimaryModifier,
): string;
export function shortcutAriaLabel(
  shortcut: EditorShortcut,
  primary: PrimaryModifier,
): string | null;
export function shortcutAriaLabel(
  shortcut: EditorShortcut,
  primary: PrimaryModifier,
): string | null {
  const modifier = primary === "Cmd" ? "Meta" : "Control";
  switch (shortcut.kind) {
    case "tool":
      return TOOL_SHORTCUTS[shortcut.tool];
    case "shape":
      return shapeDigit(shortcut.shape);
    case "arrange":
      switch (shortcut.action) {
        case "front":
          return `${modifier}+Shift+]`;
        case "forward":
          return `${modifier}+]`;
        case "backward":
          return `${modifier}+[`;
        case "back":
          return `${modifier}+Shift+[`;
        default:
          return assertNever(shortcut.action);
      }
    case "delete":
      return "Delete";
    case "undo":
      return `${modifier}+Z`;
    // The map takes either spelling of redo.
    case "redo":
      return `${modifier}+Shift+Z ${modifier}+Y`;
    case "duplicate":
      return `${modifier}+D`;
    case "rotate":
      return "R";
    case "cancel":
      return "Escape";
    case "selectAll":
      return `${modifier}+A`;
    case "zoomIn":
      return "+";
    case "zoomOut":
      return "-";
    case "zoomReset":
      return "0";
    case "toggleGrid":
      return "G";
    default:
      return assertNever(shortcut);
  }
}

/** Exhaustiveness guard: a new `EditorShortcut` kind must be labelled here. */
function assertNever(value: never): never {
  throw new Error(`Unlabelled shortcut: ${JSON.stringify(value)}`);
}
