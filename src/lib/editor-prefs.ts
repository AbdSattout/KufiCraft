/**
 * KufiCraft — editor preferences in `localStorage` (client-only, versioned).
 *
 * Two keys, both private to the browser and never sent to the server:
 *
 *   • `kuficraft.editor-prefs.v1` — how the editor opens: tool, shape and
 *     rotation, the arc style (direction + size), zoom, the construction grid,
 *     the last few ink colours and the next stroke's style (rounding, border,
 *     cap + join).
 *   • `kuficraft.last-config.v1` — the last committed project config, used as
 *     the default in the dashboard's «لوحة جديدة» dialog. The ratio, cell size,
 *     grid type, colours and line shape live here, not in the prefs: they are
 *     the artwork, and the project itself is authoritative while one is open.
 *
 * `showGrid` is the exception: the construction grid is a **view guide**, not
 * artwork — it belongs to the person looking at the board, so it follows the
 * user from project to project. `config.showGrid` stays in the document (and
 * the `.kuficraft` format) as a tolerated field that nothing renders from.
 *
 * Reads are total (corrupt / stale / unknown-version values fall back to the
 * model defaults, never throw) and writes are failure-tolerant (private mode
 * or a full quota must never break the editor).
 */

import type {
  ArcDirection,
  ArcSize,
  ItemBorder,
  ItemRounding,
  ProjectConfig,
  ShapeId,
  StrokeCap,
  StrokeJoin,
} from "@/lib/canvas/model";
import {
  ARC_DIRECTIONS,
  ARC_SIZES,
  CORNER_ALL,
  DEFAULT_BORDER,
  DEFAULT_BORDER_COLOR,
  DEFAULT_STROKE_CAP,
  DEFAULT_STROKE_JOIN,
  MAX_BORDER_WIDTH,
  MAX_COLOR_LENGTH,
  MAX_ROUNDING_RADIUS,
  normalizeStrokeCap,
  normalizeStrokeJoin,
} from "@/lib/canvas/model";
import { SHAPE_ORDER } from "@/lib/canvas/shapes";
import { TOOL_ORDER } from "@/components/editor/tools";
import type { ArcStyle, Rotation, ToolId } from "@/components/editor/interaction";
import { sanitizeProjectConfig } from "@/lib/kuficraft-file";

export const EDITOR_PREFS_KEY = "kuficraft.editor-prefs.v1";
export const LAST_CONFIG_KEY = "kuficraft.last-config.v1";

/** How many recent ink colours the editor remembers. */
export const MAX_INK_SWATCHES = 8;
export const DEFAULT_ZOOM = 1;
/**
 * Zoom bounds: a board far bigger than the pane must still be viewable whole
 * (0.1), and a dense one needs more than the old 4× ceiling up close — a cell
 * of `base` 4 is ~3 px at zoom 1 on a desktop surface, so the ladder goes to 32.
 */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 32;

export interface EditorPrefs {
  tool: ToolId;
  shape: ShapeId;
  rotation: Rotation;
  arc: ArcStyle;
  zoom: number;
  /** The construction grid — a view guide, the same for the user everywhere. */
  showGrid: boolean;
  /** Recent ink colours, most-recent-first, deduped case-insensitively. */
  inkSwatches: string[];
  /** Corner rounding of the next drawn tiles (radius 0 = square corners). */
  rounding: ItemRounding;
  /** Outside border of the next drawn items (width 0 = none). */
  border: ItemBorder;
  /** End shape of the next stroked item. */
  cap: StrokeCap;
  /** Turn shape of the next stroked item. */
  join: StrokeJoin;
}

export const DEFAULT_EDITOR_PREFS: EditorPrefs = {
  tool: "pen",
  shape: "square",
  rotation: 0,
  arc: { direction: "clockwise", size: "half" },
  zoom: DEFAULT_ZOOM,
  showGrid: true,
  inkSwatches: [],
  rounding: { radius: 0, corners: CORNER_ALL },
  border: { ...DEFAULT_BORDER },
  cap: DEFAULT_STROKE_CAP,
  join: DEFAULT_STROKE_JOIN,
};

/** The slice of the Web Storage API this module needs (easy to stub). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `window.localStorage`, or `null` on the server / when access throws. */
function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    // Access itself can throw (blocked storage / private mode).
    return null;
  }
}

function readRaw(storage: StorageLike | null, key: string): unknown {
  if (storage === null) return null;
  try {
    const text = storage.getItem(key);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function writeRaw(storage: StorageLike | null, key: string, value: unknown): void {
  if (storage === null) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota: preferences are best-effort, never fatal.
  }
}

/* ------------------------------------------------------------------ */
/* Field validation                                                    */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTool(value: unknown): value is ToolId {
  return (
    typeof value === "string" && (TOOL_ORDER as readonly string[]).includes(value)
  );
}

function isShape(value: unknown): value is ShapeId {
  return (
    typeof value === "string" && (SHAPE_ORDER as readonly string[]).includes(value)
  );
}

function isRotation(value: unknown): value is Rotation {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function isDirection(value: unknown): value is ArcDirection {
  return (ARC_DIRECTIONS as readonly string[]).includes(value as string);
}

function isSize(value: unknown): value is ArcSize {
  return (ARC_SIZES as readonly string[]).includes(value as string);
}

/** Arc style from prefs, tolerating the pre-2 field shape (`bulge: 0 | 1`). */
function arcStyle(value: unknown): ArcStyle {
  const record = isRecord(value) ? value : {};
  const direction = isDirection(record.direction)
    ? record.direction
    : DEFAULT_EDITOR_PREFS.arc.direction;
  const size = isSize(record.size) ? record.size : DEFAULT_EDITOR_PREFS.arc.size;
  return { direction, size };
}

function clampZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/**
 * Rounding from prefs: the radius is clamped to the model's range (`0` stays
 * `0` — the off state) and the corner mask to the four real corners. A missing
 * or broken value is the default, which rounds nothing.
 */
function roundingPref(value: unknown): ItemRounding {
  const record = isRecord(value) ? value : {};
  const radius =
    typeof record.radius === "number" && Number.isFinite(record.radius)
      ? Math.min(MAX_ROUNDING_RADIUS, Math.max(0, record.radius))
      : DEFAULT_EDITOR_PREFS.rounding.radius;
  const corners =
    typeof record.corners === "number" && Number.isFinite(record.corners)
      ? Math.trunc(record.corners) & CORNER_ALL
      : DEFAULT_EDITOR_PREFS.rounding.corners;
  return { radius, corners };
}

/**
 * Border from prefs: width is the switch, colour defaults to black.
 *
 * Prefs written before the width switch carried a `sides` mask and remembered
 * an always-on width (the old default was 2). That width must not turn the new
 * default of 0 into an unexpected outline, so a stored mask resets the whole
 * border once; the next save writes the new shape and the guard stops
 * matching. The current build never writes `sides`.
 */
function borderPref(value: unknown): ItemBorder {
  const record = isRecord(value) ? value : {};
  if (record.sides !== undefined) return { ...DEFAULT_EDITOR_PREFS.border };
  const width =
    typeof record.width === "number" && Number.isFinite(record.width)
      ? Math.min(MAX_BORDER_WIDTH, Math.max(0, record.width))
      : DEFAULT_EDITOR_PREFS.border.width;
  const color =
    typeof record.color === "string" && record.color.length > 0
      ? record.color.slice(0, MAX_COLOR_LENGTH)
      : DEFAULT_BORDER_COLOR;
  return { width, color };
}

function normalizeSwatches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const swatches: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    swatches.push(entry);
    if (swatches.length >= MAX_INK_SWATCHES) break;
  }
  return swatches;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Total read: every field is validated, anything unknown → model default. */
export function loadEditorPrefs(
  storage: StorageLike | null = defaultStorage(),
): EditorPrefs {
  const raw = readRaw(storage, EDITOR_PREFS_KEY);
  const record = isRecord(raw) ? raw : {};
  return {
    tool: isTool(record.tool) ? record.tool : DEFAULT_EDITOR_PREFS.tool,
    shape: isShape(record.shape) ? record.shape : DEFAULT_EDITOR_PREFS.shape,
    rotation: isRotation(record.rotation)
      ? record.rotation
      : DEFAULT_EDITOR_PREFS.rotation,
    arc: arcStyle(record.arc),
    zoom: clampZoom(record.zoom),
    // Booleans are validated like the file format's own fields do it.
    showGrid:
      typeof record.showGrid === "boolean"
        ? record.showGrid
        : DEFAULT_EDITOR_PREFS.showGrid,
    inkSwatches: normalizeSwatches(record.inkSwatches),
    rounding: roundingPref(record.rounding),
    border: borderPref(record.border),
    cap: normalizeStrokeCap(record.cap),
    join: normalizeStrokeJoin(record.join),
  };
}

/** Best-effort write — a storage throw is swallowed. */
export function saveEditorPrefs(
  prefs: EditorPrefs,
  storage: StorageLike | null = defaultStorage(),
): void {
  writeRaw(storage, EDITOR_PREFS_KEY, prefs);
}

/** The last committed config, or `null` when absent / corrupt. */
export function loadLastConfig(
  storage: StorageLike | null = defaultStorage(),
): ProjectConfig | null {
  const raw = readRaw(storage, LAST_CONFIG_KEY);
  return isRecord(raw) ? sanitizeProjectConfig(raw) : null;
}

/** Best-effort write of a sanitised config. */
export function saveLastConfig(
  config: ProjectConfig,
  storage: StorageLike | null = defaultStorage(),
): void {
  writeRaw(storage, LAST_CONFIG_KEY, sanitizeProjectConfig(config));
}

/** Adds `color` to the front of the history (deduped, capped). */
export function rememberInkSwatch(
  swatches: readonly string[],
  color: string,
): string[] {
  if (color.length === 0) return [...swatches];
  return normalizeSwatches([color, ...swatches]);
}
