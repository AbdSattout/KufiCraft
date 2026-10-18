import { describe, expect, it } from "vitest";
import { shortcutFor } from "./shortcuts";
import type { EditorShortcut, ShortcutEvent } from "./shortcuts";
import {
  shapeDigit,
  shortcutAriaLabel,
  shortcutLabel,
} from "./shortcut-hints";
import type { PrimaryModifier } from "./shortcut-hints";
import { SHAPE_ORDER } from "./interaction";
import { ARRANGE_ACTIONS } from "@/lib/canvas/ops";
import { TOOL_ORDER, TOOL_SHORTCUTS } from "./tools";

describe("editor keyboard map", () => {
  it("maps digits to the shape palette in order", () => {
    expect(shortcutFor({ key: "1" })).toEqual({
      kind: "shape",
      shape: SHAPE_ORDER[0],
    });
    expect(shortcutFor({ key: "9" })).toEqual({
      kind: "shape",
      shape: "hamza2",
    });
  });

  it("maps the tool keys", () => {
    expect(shortcutFor({ key: "p" })).toEqual({ kind: "tool", tool: "pen" });
    expect(shortcutFor({ key: "l" })).toEqual({ kind: "tool", tool: "line" });
    expect(shortcutFor({ key: "E" })).toEqual({ kind: "tool", tool: "eraser" });
    expect(shortcutFor({ key: "a" })).toEqual({ kind: "tool", tool: "arc" });
    expect(shortcutFor({ key: "v" })).toEqual({ kind: "tool", tool: "select" });
    expect(shortcutFor({ key: "h" })).toEqual({ kind: "tool", tool: "hand" });
  });

  it("handles delete, escape and rotate", () => {
    expect(shortcutFor({ key: "Delete" })).toEqual({ kind: "delete" });
    expect(shortcutFor({ key: "Backspace" })).toEqual({ kind: "delete" });
    expect(shortcutFor({ key: "Escape" })).toEqual({ kind: "cancel" });
    expect(shortcutFor({ key: "Enter" })).toEqual({ kind: "cancel" });
    expect(shortcutFor({ key: "r" })).toEqual({ kind: "rotate" });
  });

  it("handles undo / redo on both modifiers", () => {
    expect(shortcutFor({ key: "z", ctrlKey: true })).toEqual({ kind: "undo" });
    expect(shortcutFor({ key: "z", metaKey: true })).toEqual({ kind: "undo" });
    expect(shortcutFor({ key: "Z", ctrlKey: true, shiftKey: true })).toEqual({
      kind: "redo",
    });
    expect(shortcutFor({ key: "y", ctrlKey: true })).toEqual({ kind: "redo" });
    expect(shortcutFor({ key: "d", ctrlKey: true })).toEqual({
      kind: "duplicate",
    });
    // Plain letters still select tools.
    expect(shortcutFor({ key: "z" })).toBeNull();
  });

  it("maps the arrange keys, Shift for the extremes", () => {
    expect(shortcutFor({ key: "]", ctrlKey: true })).toEqual({
      kind: "arrange",
      action: "forward",
    });
    expect(shortcutFor({ key: "]", ctrlKey: true, shiftKey: true })).toEqual({
      kind: "arrange",
      action: "front",
    });
    expect(shortcutFor({ key: "[", ctrlKey: true })).toEqual({
      kind: "arrange",
      action: "backward",
    });
    expect(shortcutFor({ key: "[", metaKey: true, shiftKey: true })).toEqual({
      kind: "arrange",
      action: "back",
    });
    // A bracket without a primary modifier is not a shortcut…
    expect(shortcutFor({ key: "]" })).toBeNull();
    // …and nothing fires while the user is typing.
    expect(
      shortcutFor({ key: "]", ctrlKey: true, target: { tagName: "INPUT" } }),
    ).toBeNull();
  });

  it("accepts the brace spellings of the shifted arrange keys", () => {
    // Browsers report the shifted character for `Ctrl+Shift+]` (`}` — the
    // combo produces no control character), and layouts that type the brackets
    // on the Shift or AltGr layer produce the braces for them too. The key the
    // user reaches for is unchanged; only the spelling it arrives in is.
    expect(shortcutFor({ key: "}", ctrlKey: true })).toEqual({
      kind: "arrange",
      action: "front",
    });
    expect(shortcutFor({ key: "}", ctrlKey: true, shiftKey: true })).toEqual({
      kind: "arrange",
      action: "front",
    });
    expect(shortcutFor({ key: "{", metaKey: true })).toEqual({
      kind: "arrange",
      action: "back",
    });
    // Still primary-only.
    expect(shortcutFor({ key: "}" })).toBeNull();
    expect(shortcutFor({ key: "{" })).toBeNull();
  });

  it("maps select-all on both primary modifiers", () => {
    expect(shortcutFor({ key: "a", ctrlKey: true })).toEqual({
      kind: "selectAll",
    });
    expect(shortcutFor({ key: "A", metaKey: true })).toEqual({
      kind: "selectAll",
    });
    // Plain `A` is still the arc tool, and typing fields keep their own Ctrl+A.
    expect(shortcutFor({ key: "a" })).toEqual({ kind: "tool", tool: "arc" });
    expect(
      shortcutFor({ key: "a", ctrlKey: true, target: { tagName: "INPUT" } }),
    ).toBeNull();
  });

  it("maps the view keys: zoom and the grid guide", () => {
    expect(shortcutFor({ key: "+" })).toEqual({ kind: "zoomIn" });
    expect(shortcutFor({ key: "=" })).toEqual({ kind: "zoomIn" });
    expect(shortcutFor({ key: "-" })).toEqual({ kind: "zoomOut" });
    expect(shortcutFor({ key: "0" })).toEqual({ kind: "zoomReset" });
    expect(shortcutFor({ key: "g" })).toEqual({ kind: "toggleGrid" });
    expect(shortcutFor({ key: "G" })).toEqual({ kind: "toggleGrid" });
    expect(shortcutFor({ key: "0", target: { tagName: "INPUT" } })).toBeNull();
    expect(
      shortcutFor({ key: "-", target: { tagName: "TEXTAREA" } }),
    ).toBeNull();
  });

  it("ignores keystrokes while typing", () => {
    expect(shortcutFor({ key: "p", target: { tagName: "INPUT" } })).toBeNull();
    expect(shortcutFor({ key: "Delete", target: { tagName: "textarea" } })).toBeNull();
    expect(
      shortcutFor({ key: "1", target: { tagName: "DIV", isContentEditable: true } }),
    ).toBeNull();
    expect(shortcutFor({ key: "p", target: { tagName: "BUTTON" } })).toEqual({
      kind: "tool",
      tool: "pen",
    });
  });
});

describe("shortcut hints", () => {
  /**
   * Every shortcut the map can actually resolve, paired with an event that
   * produces it — one entry per surface the UI may hint at. The tenth palette
   * shape is absent on purpose: only the digits `1…9` are mapped.
   */
  const cases: ReadonlyArray<{
    shortcut: EditorShortcut;
    event: ShortcutEvent;
  }> = [
    ...TOOL_ORDER.map((tool) => ({
      shortcut: { kind: "tool", tool } as const,
      event: { key: TOOL_SHORTCUTS[tool] },
    })),
    ...SHAPE_ORDER.slice(0, 9).map((shape, index) => ({
      shortcut: { kind: "shape", shape } as const,
      event: { key: String(index + 1) },
    })),
    {
      shortcut: { kind: "arrange", action: "front" } as const,
      // What a real browser reports for `Ctrl+Shift+]`.
      event: { key: "}", ctrlKey: true },
    },
    {
      shortcut: { kind: "arrange", action: "forward" } as const,
      event: { key: "]", ctrlKey: true },
    },
    {
      shortcut: { kind: "arrange", action: "backward" } as const,
      event: { key: "[", ctrlKey: true },
    },
    {
      shortcut: { kind: "arrange", action: "back" } as const,
      event: { key: "{", ctrlKey: true },
    },
    { shortcut: { kind: "delete" }, event: { key: "Delete" } },
    { shortcut: { kind: "undo" }, event: { key: "z", ctrlKey: true } },
    {
      shortcut: { kind: "redo" },
      event: { key: "Z", ctrlKey: true, shiftKey: true },
    },
    { shortcut: { kind: "duplicate" }, event: { key: "d", ctrlKey: true } },
    { shortcut: { kind: "rotate" }, event: { key: "r" } },
    { shortcut: { kind: "cancel" }, event: { key: "Escape" } },
    { shortcut: { kind: "selectAll" }, event: { key: "a", ctrlKey: true } },
    { shortcut: { kind: "zoomIn" }, event: { key: "+" } },
    { shortcut: { kind: "zoomOut" }, event: { key: "-" } },
    { shortcut: { kind: "zoomReset" }, event: { key: "0" } },
    { shortcut: { kind: "toggleGrid" }, event: { key: "g" } },
  ];

  const platforms: readonly PrimaryModifier[] = ["Ctrl", "Cmd"];

  it("labels every shortcut the map resolves, on both platforms", () => {
    for (const { shortcut } of cases) {
      for (const primary of platforms) {
        expect(shortcutLabel(shortcut, primary)).toBeTruthy();
        expect(shortcutAriaLabel(shortcut, primary)).toBeTruthy();
      }
    }
  });

  it("describes only keys the map actually fires", () => {
    // The hint surface walks back through the real map: a label that names a
    // key `shortcutFor` would not resolve fails here.
    for (const { shortcut, event } of cases) {
      expect(shortcutFor(event)).toEqual(shortcut);
    }
  });

  it("uses the platform's primary modifier and ARIA's key names", () => {
    expect(shortcutLabel({ kind: "undo" }, "Ctrl")).toBe("Ctrl+Z");
    expect(shortcutLabel({ kind: "undo" }, "Cmd")).toBe("Cmd+Z");
    expect(shortcutLabel({ kind: "redo" }, "Cmd")).toBe("Cmd+Shift+Z");
    expect(shortcutLabel({ kind: "duplicate" }, "Cmd")).toBe("Cmd+D");
    expect(shortcutLabel({ kind: "selectAll" }, "Ctrl")).toBe("Ctrl+A");
    expect(shortcutLabel({ kind: "arrange", action: "front" }, "Cmd")).toBe(
      "Cmd+Shift+]",
    );
    expect(shortcutLabel({ kind: "arrange", action: "backward" }, "Ctrl")).toBe(
      "Ctrl+[",
    );
    expect(shortcutAriaLabel({ kind: "undo" }, "Ctrl")).toBe("Control+Z");
    expect(shortcutAriaLabel({ kind: "undo" }, "Cmd")).toBe("Meta+Z");
    expect(shortcutAriaLabel({ kind: "redo" }, "Cmd")).toBe(
      "Meta+Shift+Z Meta+Y",
    );
    expect(shortcutAriaLabel({ kind: "delete" }, "Ctrl")).toBe("Delete");
    expect(shortcutAriaLabel({ kind: "cancel" }, "Ctrl")).toBe("Escape");
    // A label never names the other platform's modifier.
    for (const { shortcut } of cases) {
      expect(shortcutLabel(shortcut, "Ctrl") ?? "").not.toContain("Cmd");
      expect(shortcutLabel(shortcut, "Cmd") ?? "").not.toContain("Ctrl");
    }
  });

  it("leaves the tenth palette glyph without a digit", () => {
    expect(SHAPE_ORDER).toHaveLength(10);
    expect(shapeDigit(SHAPE_ORDER[0])).toBe("1");
    expect(shapeDigit(SHAPE_ORDER[8])).toBe("9");
    expect(shapeDigit(SHAPE_ORDER[9])).toBeNull();
    expect(
      shortcutLabel({ kind: "shape", shape: SHAPE_ORDER[9] }, "Ctrl"),
    ).toBeNull();
  });

  it("covers all four arrange actions", () => {
    expect(ARRANGE_ACTIONS).toHaveLength(4);
    for (const action of ARRANGE_ACTIONS) {
      const shortcut = { kind: "arrange", action } as const;
      expect(shortcutLabel(shortcut, "Ctrl")).toBeTruthy();
    }
  });
});
