/**
 * KufiCraft — the `.kuficraft` project file (format v1).
 *
 * One small JSON document holding everything needed to redraw an artwork,
 * independent of the server: the shared `ProjectConfig` + `CanvasItem[]` from
 * `convex/lib/model.ts` (the contract is `docs/FORMAT.md`). The editor and the
 * dashboard both use this module; it is client-only and never runs on the
 * server.
 *
 * Reads are total: a corrupt or hostile file is *sanitised* like the backend
 * (`sanitizeConfig`) or rejected with the exact Arabic messages the doc lists.
 * Writers emit minified JSON and never include unknown fields.
 */

import {
  DEFAULT_BACKGROUND,
  DEFAULT_BASE,
  DEFAULT_INK,
  DEFAULT_PROJECT_CONFIG,
  DEFAULT_RATIO,
  MAX_COLOR_LENGTH,
  MAX_ITEMS,
  MAX_NAME_LENGTH,
  snapRatio,
} from "@/lib/canvas/model";
import type {
  ArchItem,
  CanvasItem,
  GridType,
  LineItem,
  ProjectConfig,
  TileItem,
  TileShape,
  ZoneQuadrant,
} from "@/lib/canvas/model";
import { SHAPE_ORDER } from "@/components/editor/interaction";

/* ------------------------------------------------------------------ */
/* Format constants                                                    */
/* ------------------------------------------------------------------ */

export const FILE_FORMAT = "kuficraft" as const;
export const FILE_VERSION = 1 as const;
export const FILE_EXTENSION = ".kuficraft";

/** Backend name default (`sanitizeName` in `convex/projects.ts`). */
export const FALLBACK_PROJECT_NAME = "لوحة بلا عنوان";
/** Fallback download name from docs/FORMAT.md §File conventions. */
export const FALLBACK_FILE_NAME = "لوحة-بلا-عنوان.kuficraft";

/** Import errors — exactly the Arabic copy documented in docs/FORMAT.md. */
export const FILE_ERRORS = {
  notKuficraft: "هذا الملف ليس ملف KufiCraft",
  unknownVersion: "إصدار الملف غير مدعوم",
} as const;

const MIN_BASE = 4;
const MAX_BASE = 100;

/* ------------------------------------------------------------------ */
/* Shape of the file                                                   */
/* ------------------------------------------------------------------ */

export interface ProjectFile {
  format: typeof FILE_FORMAT;
  version: typeof FILE_VERSION;
  name: string;
  config: ProjectConfig;
  items: CanvasItem[];
  exportedAt?: string;
}

export interface ProjectFileInput {
  name: string;
  config: ProjectConfig;
  items: readonly CanvasItem[];
}

export interface ParsedProjectFile {
  name: string;
  config: ProjectConfig;
  items: CanvasItem[];
  /** Valid, unique items dropped because the file exceeded `MAX_ITEMS`. */
  droppedItems: number;
}

/* ------------------------------------------------------------------ */
/* Untrusted-value helpers                                             */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isQuadrant(value: unknown): value is ZoneQuadrant {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function isRotation(value: unknown): value is 0 | 1 | 2 | 3 {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function isShape(value: unknown): value is TileShape {
  return (
    typeof value === "string" && (SHAPE_ORDER as readonly string[]).includes(value)
  );
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!isFiniteNumber(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function sanitizeColour(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value.slice(0, MAX_COLOR_LENGTH);
  }
  return fallback;
}

/** Item colours keep the model type; empty strings degrade to "no override". */
function itemColour(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/* ------------------------------------------------------------------ */
/* Sanitising                                                          */
/* ------------------------------------------------------------------ */

/**
 * Same semantics as the backend's `sanitizeConfig`: `ratio` snapped to the
 * nearest `RATIO_PRESETS` value, `base ∈ [4, 100]`, colours truncated,
 * `gridType` restricted, unknown fields dropped, missing fields defaulted.
 */
export function sanitizeProjectConfig(value: unknown): ProjectConfig {
  const record = isRecord(value) ? value : {};
  const gridType: GridType = record.gridType === "circular" ? "circular" : "square";
  return {
    gridType,
    ratio:
      typeof record.ratio === "number" ? snapRatio(record.ratio) : DEFAULT_RATIO,
    base: clampNumber(record.base, MIN_BASE, MAX_BASE, DEFAULT_BASE),
    ink: sanitizeColour(record.ink, DEFAULT_INK),
    background: sanitizeColour(record.background, DEFAULT_BACKGROUND),
    showGrid:
      typeof record.showGrid === "boolean"
        ? record.showGrid
        : DEFAULT_PROJECT_CONFIG.showGrid,
    mergeLines:
      typeof record.mergeLines === "boolean"
        ? record.mergeLines
        : DEFAULT_PROJECT_CONFIG.mergeLines,
  };
}

/** Trimmed / collapsed / capped like the backend's `sanitizeName`. */
export function sanitizeProjectName(value: unknown): string {
  if (typeof value !== "string") return FALLBACK_PROJECT_NAME;
  const name = value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return name.length > 0 ? name : FALLBACK_PROJECT_NAME;
}

/**
 * Structural validation against the shared model. Returns the canonical item
 * (only model fields) or `null`. Keys are identity: a non-empty string key is
 * required and preserved; NaN coordinates / bad discriminants are rejected.
 */
export function normalizeItem(value: unknown): CanvasItem | null {
  if (!isRecord(value)) return null;
  const k = value.k;
  if (typeof k !== "string" || k.length === 0) return null;

  switch (value.t) {
    case "tile": {
      if (
        !isFiniteNumber(value.i) ||
        !isFiniteNumber(value.j) ||
        !isQuadrant(value.q)
      ) {
        return null;
      }
      const item: TileItem = { t: "tile", k, i: value.i, j: value.j, q: value.q };
      if (isShape(value.s)) item.s = value.s;
      const c = itemColour(value.c);
      if (c !== undefined) item.c = c;
      if (isRotation(value.r)) item.r = value.r;
      return item;
    }
    case "line": {
      if (
        !isFiniteNumber(value.i1) ||
        !isFiniteNumber(value.j1) ||
        !isFiniteNumber(value.i2) ||
        !isFiniteNumber(value.j2)
      ) {
        return null;
      }
      const item: LineItem = {
        t: "line",
        k,
        i1: value.i1,
        j1: value.j1,
        i2: value.i2,
        j2: value.j2,
      };
      const c = itemColour(value.c);
      if (c !== undefined) item.c = c;
      return item;
    }
    case "arch": {
      if (
        !isFiniteNumber(value.i1) ||
        !isFiniteNumber(value.j1) ||
        !isFiniteNumber(value.i2) ||
        !isFiniteNumber(value.j2) ||
        (value.d !== 0 && value.d !== 1)
      ) {
        return null;
      }
      const item: ArchItem = {
        t: "arch",
        k,
        i1: value.i1,
        j1: value.j1,
        i2: value.i2,
        j2: value.j2,
        d: value.d,
      };
      const c = itemColour(value.c);
      if (c !== undefined) item.c = c;
      return item;
    }
    default:
      return null;
  }
}

/** Rebuilds an item with only the model fields (writers never emit extras). */
function serializeItem(item: CanvasItem): CanvasItem {
  switch (item.t) {
    case "tile": {
      const next: TileItem = {
        t: "tile",
        k: item.k,
        i: item.i,
        j: item.j,
        q: item.q,
      };
      if (item.s !== undefined) next.s = item.s;
      if (item.c !== undefined) next.c = item.c;
      if (item.r !== undefined) next.r = item.r;
      return next;
    }
    case "line": {
      const next: LineItem = {
        t: "line",
        k: item.k,
        i1: item.i1,
        j1: item.j1,
        i2: item.i2,
        j2: item.j2,
      };
      if (item.c !== undefined) next.c = item.c;
      return next;
    }
    case "arch": {
      const next: ArchItem = {
        t: "arch",
        k: item.k,
        i1: item.i1,
        j1: item.j1,
        i2: item.i2,
        j2: item.j2,
        d: item.d,
      };
      if (item.c !== undefined) next.c = item.c;
      return next;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Minified JSON for a project (UTF-8 when written to a blob). */
export function exportProjectFile(
  input: ProjectFileInput,
  exportedAt: string = new Date().toISOString(),
): string {
  const file: ProjectFile = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    name: sanitizeProjectName(input.name),
    config: sanitizeProjectConfig(input.config),
    items: input.items.map(serializeItem),
    exportedAt,
  };
  return JSON.stringify(file);
}

/**
 * Validates and sanitises a `.kuficraft` document. Throws an `Error` carrying
 * the Arabic message from docs/FORMAT.md when the envelope is not usable.
 */
export function parseProjectFile(text: string): ParsedProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(FILE_ERRORS.notKuficraft);
  }

  if (!isRecord(raw) || raw.format !== FILE_FORMAT) {
    throw new Error(FILE_ERRORS.notKuficraft);
  }
  if (raw.version !== FILE_VERSION) {
    throw new Error(FILE_ERRORS.unknownVersion);
  }

  const candidates = Array.isArray(raw.items) ? raw.items : [];
  const items: CanvasItem[] = [];
  const seen = new Set<string>();
  let droppedItems = 0;

  for (const candidate of candidates) {
    const item = normalizeItem(candidate);
    if (!item || seen.has(item.k)) continue;
    seen.add(item.k);
    if (items.length >= MAX_ITEMS) {
      droppedItems += 1;
      continue;
    }
    items.push(item);
  }

  return {
    name: sanitizeProjectName(raw.name),
    config: sanitizeProjectConfig(raw.config),
    items,
    droppedItems,
  };
}

/** Sanitised project name + `.kuficraft` (fallback `لوحة-بلا-عنوان.kuficraft`). */
export function projectFileName(name: string): string {
  const cleaned = sanitizeProjectName(name)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${cleaned.length > 0 ? cleaned : "لوحة-بلا-عنوان"}${FILE_EXTENSION}`;
}

/** Browser download of the minified JSON as a temporary `<a download>`. */
export function downloadProjectFile(input: ProjectFileInput): void {
  const blob = new Blob([exportProjectFile(input)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = projectFileName(input.name);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Reads a picked / dropped file and validates it (browser only). */
export async function readProjectFile(file: File): Promise<ParsedProjectFile> {
  const text = await file.text();
  return parseProjectFile(text);
}
