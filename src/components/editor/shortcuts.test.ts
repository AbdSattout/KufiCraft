import { describe, expect, it } from "vitest";
import { shortcutFor } from "./shortcuts";
import { SHAPE_ORDER } from "./interaction";

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
    expect(shortcutFor({ key: "0" })).toBeNull();
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
