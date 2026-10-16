/**
 * KufiCraft — editor preferences in `localStorage` (client-only, versioned).
 *
 * Two keys, both private to the browser and never sent to the server:
 *
 *   • `kuficraft.editor-prefs.v1` — how the editor opens: tool, shape and
 *     rotation, arch bulge, zoom and the last few ink colours.
 *   • `kuficraft.last-config.v1` — the last committed project config, used as
 *     the default in the dashboard's «لوحة جديدة» dialog. The grid, merge and
 *     ratio settings live here, not in the prefs: they belong to the document,
 *     and the project itself is authoritative while one is open.
 *
 * Reads are total (corrupt / stale / unknown-version values fall back to the
 * model defaults, never throw) and writes are failure-tolerant (private mode
 * or a full quota must never break the editor).
 */

import type { ProjectConfig, TileShape } from "@/lib/canvas/model";
import { SHAPE_ORDER, TOOL_ORDER } from "@/components/editor/interaction";
import type { Tool } from "@/components/editor/interaction";
import { sanitizeProjectConfig } from "@/lib/kuficraft-file";

export const EDITOR_PREFS_KEY = "kuficraft.editor-prefs.v1";
export const LAST_CONFIG_KEY = "kuficraft.last-config.v1";

/** How many recent ink colours the editor remembers. */
export const MAX_INK_SWATCHES = 8;
export const DEFAULT_ZOOM = 1;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;

export type Rotation = 0 | 1 | 2 | 3;

export interface EditorPrefs {
  tool: Tool;
  shape: TileShape;
  rotation: Rotation;
  bulge: 0 | 1;
  zoom: number;
  /** Recent ink colours, most-recent-first, deduped case-insensitively. */
  inkSwatches: string[];
}

export const DEFAULT_EDITOR_PREFS: EditorPrefs = {
  tool: "pen",
  shape: "square",
  rotation: 0,
  bulge: 0,
  zoom: DEFAULT_ZOOM,
  inkSwatches: [],
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

function isTool(value: unknown): value is Tool {
  return (
    typeof value === "string" && (TOOL_ORDER as readonly string[]).includes(value)
  );
}

function isShape(value: unknown): value is TileShape {
  return (
    typeof value === "string" && (SHAPE_ORDER as readonly string[]).includes(value)
  );
}

function isRotation(value: unknown): value is Rotation {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function isBulge(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

function clampZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
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
    bulge: isBulge(record.bulge) ? record.bulge : DEFAULT_EDITOR_PREFS.bulge,
    zoom: clampZoom(record.zoom),
    inkSwatches: normalizeSwatches(record.inkSwatches),
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
