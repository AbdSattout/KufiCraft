/**
 * KufiCraft — the `.kuficraft` project file (format v2).
 *
 * One small JSON document holding everything needed to redraw an artwork,
 * independent of the server: the shared `ProjectConfig` + `CanvasItem[]` from
 * `convex/lib/model.ts` (the contract is `docs/FORMAT.md`). The editor and the
 * dashboard both use this module; it is client-only and never runs on the
 * server.
 *
 * Field names are spelled out (`column`, `row`, `zone`, `from`, `to`, …) — a
 * file has to be readable, so nothing here is abbreviated. `key` is written
 * for readability but **re-derived on read** from the geometry, because keys
 * are identity: two documents that describe the same fragment must agree on it.
 *
 * Reads are total: a corrupt or hostile file is *sanitised* like the backend
 * (`sanitizeConfig`) or rejected with the exact Arabic messages the doc lists.
 * Writers emit minified JSON and never include unknown fields.
 *
 * v1 files (abbreviated fields, nine shapes, no strokes) are still readable;
 * see `upgradeItem`. Writing always emits v2.
 */

import {
  CORNER_ALL,
  DEFAULT_BACKGROUND,
  DEFAULT_BASE,
  DEFAULT_BORDER_WIDTH,
  DEFAULT_INK,
  DEFAULT_PROJECT_CONFIG,
  DEFAULT_RATIO,
  MAX_CIRCULAR_SECTORS,
  MAX_COLOR_LENGTH,
  MAX_ITEMS,
  MAX_NAME_LENGTH,
  MIN_CIRCULAR_SECTORS,
  arcKey,
  circularSectors,
  fragmentPoint,
  lineKey,
  linePoint,
  maxGridIndex,
  normalizeAnchor,
  sanitizeBorder,
  sanitizeRounding,
  snapRatio,
  strokeKey,
  tileKey,
} from "@/lib/canvas/model";
import type {
  ArcDirection,
  ArcItem,
  CanvasItem,
  Cell,
  FragmentPoint,
  GridType,
  ItemBorder,
  ItemRounding,
  LineItem,
  LinePoint,
  ProjectConfig,
  Rotation,
  ShapeId,
  StrokeItem,
  TileItem,
  Zone,
} from "@/lib/canvas/model";
import { SHAPE_IDS } from "@/lib/canvas/model";

/* ------------------------------------------------------------------ */
/* Format constants                                                    */
/* ------------------------------------------------------------------ */

export const FILE_FORMAT = "kuficraft" as const;
/** Current writer version (`docs/FORMAT.md`). */
export const FILE_VERSION = 2 as const;
/** The version this module can still read. */
export const FILE_VERSION_MIN = 1 as const;
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

function isZone(value: unknown): value is Zone {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function isRotation(value: unknown): value is Rotation {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function isShape(value: unknown): value is ShapeId {
  return (
    typeof value === "string" && (SHAPE_IDS as readonly string[]).includes(value)
  );
}

function isDirection(value: unknown): value is ArcDirection {
  return value === "clockwise" || value === "counterclockwise";
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
  return typeof value === "string" && value.length > 0
    ? value.slice(0, MAX_COLOR_LENGTH)
    : undefined;
}

/** A grid index: finite, integral, and inside the cell grid of `base`. */
function gridIndex(value: unknown, max: number): number | null {
  if (!isFiniteNumber(value)) return null;
  const index = Math.trunc(value);
  return index < 0 || index > max ? null : index;
}

function cellOf(value: unknown, maxColumn: number, maxRow: number): Cell | null {
  if (!isRecord(value)) return null;
  const column = gridIndex(value.column, maxColumn);
  const row = gridIndex(value.row, maxRow);
  if (column === null || row === null) return null;
  return { column, row };
}

/**
 * The optional zone of a stored fragment: `undefined` when absent (the ink
 * fragment), `null` when present but not one of the four zones. A bad zone is
 * structural — it decides *where* the point is, so the item is dropped rather
 * than silently moved to another fragment (the tile reader does the same).
 */
function zoneOf(value: Record<string, unknown>): Zone | undefined | null {
  if (value.zone === undefined) return undefined;
  return isZone(value.zone) ? value.zone : null;
}

/** A stored fragment end: a valid cell plus its optional zone. */
function fragmentOf(
  value: unknown,
  maxColumn: number,
  maxRow: number,
): FragmentPoint | null {
  const cell = cellOf(value, maxColumn, maxRow);
  if (!cell) return null;
  const zone = zoneOf(value as Record<string, unknown>);
  if (zone === null) return null;
  return fragmentPoint(cell.column, cell.row, zone);
}

/* ------------------------------------------------------------------ */
/* Sanitising                                                          */
/* ------------------------------------------------------------------ */

/**
 * Same semantics as the backend's `sanitizeConfig`: `ratio` snapped to the
 * nearest `RATIO_PRESETS` value, `base ∈ [4, 100]`, `circularSectors` rounded
 * into `[MIN_CIRCULAR_SECTORS, MAX_CIRCULAR_SECTORS]`, colours truncated,
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
    // A sector count is a whole number of divisions: a fraction rounds to the
    // nearest sector, and absent / unusable input takes the default (36).
    circularSectors: Math.round(
      clampNumber(
        record.circularSectors,
        MIN_CIRCULAR_SECTORS,
        MAX_CIRCULAR_SECTORS,
        DEFAULT_PROJECT_CONFIG.circularSectors,
      ),
    ),
    ink: sanitizeColour(record.ink, DEFAULT_INK),
    background: sanitizeColour(record.background, DEFAULT_BACKGROUND),
    showGrid:
      typeof record.showGrid === "boolean"
        ? record.showGrid
        : DEFAULT_PROJECT_CONFIG.showGrid,
    // Files written before the field existed (and the legacy `mergeLines` flag)
    // fall back to the default; `mergeLines` is deliberately dropped.
    straightLinesAsSquares:
      typeof record.straightLinesAsSquares === "boolean"
        ? record.straightLinesAsSquares
        : DEFAULT_PROJECT_CONFIG.straightLinesAsSquares,
  };
}

/** Trimmed / collapsed / capped like the backend's `sanitizeName`. */
export function sanitizeProjectName(value: unknown): string {
  if (typeof value !== "string") return FALLBACK_PROJECT_NAME;
  const name = value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return name.length > 0 ? name : FALLBACK_PROJECT_NAME;
}

/**
 * Reads an untrusted rounding object the way `sanitizeRounding` does on the
 * backend: a missing / non-numeric radius means there is no rounding at all,
 * a missing corner mask means all four corners. The result is `undefined`
 * (the field is absent) when the radius clamps to zero.
 */
function itemRounding(value: unknown): ItemRounding | undefined {
  if (!isRecord(value) || !isFiniteNumber(value.radius)) return undefined;
  return sanitizeRounding({
    radius: value.radius,
    corners: isFiniteNumber(value.corners) ? value.corners : CORNER_ALL,
  });
}

/**
 * Reads an untrusted border object. `sides` must be a real number — a border
 * without sides is not a border, so a broken mask drops the whole field rather
 * than silently outlining all four sides.
 */
function itemBorder(value: unknown): ItemBorder | undefined {
  if (!isRecord(value) || !isFiniteNumber(value.sides)) return undefined;
  return sanitizeBorder({
    sides: value.sides,
    width: isFiniteNumber(value.width) ? value.width : DEFAULT_BORDER_WIDTH,
    color: itemColour(value.color),
  });
}

/**
 * Structural validation of a **v2** item. Returns the canonical item (keys
 * derived from the geometry) or `null`. Coordinates must be finite integers
 * inside the grid for `config`; optional fields are dropped when absent.
 */
export function normalizeItem(
  value: unknown,
  config: ProjectConfig,
): CanvasItem | null {
  if (!isRecord(value)) return null;
  const maxColumn = maxGridIndex(config.base);
  const maxRow =
    config.gridType === "circular" ? circularSectors(config) - 1 : maxColumn;
  const colour = itemColour(value.color);
  const border = itemBorder(value.border);
  const rounding = itemRounding(value.rounding);

  switch (value.type) {
    case "tile": {
      if (!isZone(value.zone)) return null;
      const column = gridIndex(value.column, maxColumn);
      const row = gridIndex(value.row, maxRow);
      if (column === null || row === null) return null;
      const item: TileItem = {
        type: "tile",
        key: tileKey(column, row, value.zone),
        column,
        row,
        zone: value.zone,
      };
      if (isShape(value.shape) && value.shape !== "square") {
        item.shape = value.shape;
      }
      if (isRotation(value.rotation) && value.rotation !== 0) {
        item.rotation = value.rotation;
      }
      if (rounding !== undefined) item.rounding = rounding;
      if (border !== undefined) item.border = border;
      if (colour !== undefined) item.color = colour;
      return item;
    }
    case "line": {
      const from = fragmentOf(value.from, maxColumn, maxRow);
      const to = fragmentOf(value.to, maxColumn, maxRow);
      if (!from || !to) return null;
      const item: LineItem = {
        type: "line",
        key: lineKey(from, to),
        from,
        to,
      };
      if (rounding !== undefined) item.rounding = rounding;
      if (border !== undefined) item.border = border;
      if (colour !== undefined) item.color = colour;
      return item;
    }
    case "stroke": {
      if (!Array.isArray(value.points) || value.points.length < 2) return null;
      const points: LinePoint[] = [];
      for (const candidate of value.points) {
        if (!isRecord(candidate)) return null;
        const cell = cellOf(candidate, maxColumn, maxRow);
        if (!cell) return null;
        // The zone is structural (a bad one drops the item); the anchor is
        // optional and bounded to the point's fragment, so an unusable one
        // falls back to the fragment centre instead of killing the item.
        const zone = zoneOf(candidate);
        if (zone === null) return null;
        points.push(
          linePoint(
            cell.column,
            cell.row,
            zone,
            normalizeAnchor(candidate.anchor),
          ),
        );
      }
      const closed = value.closed === true;
      const item: StrokeItem = {
        type: "stroke",
        key: strokeKey(points, closed),
        points,
      };
      if (closed) item.closed = true;
      if (rounding !== undefined) item.rounding = rounding;
      if (border !== undefined) item.border = border;
      if (colour !== undefined) item.color = colour;
      return item;
    }
    case "arc": {
      const from = fragmentOf(value.from, maxColumn, maxRow);
      const to = fragmentOf(value.to, maxColumn, maxRow);
      if (!from || !to) return null;
      if (from.column === to.column && from.row === to.row) return null;
      const direction: ArcDirection = isDirection(value.direction)
        ? value.direction
        : "clockwise";
      const size = value.size === "threeQuarter" ? "threeQuarter" : "half";
      const item: ArcItem = {
        type: "arc",
        key: arcKey(from, to, direction, size),
        from,
        to,
        direction,
        size,
      };
      if (border !== undefined) item.border = border;
      if (colour !== undefined) item.color = colour;
      return item;
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* v1 → v2                                                             */
/* ------------------------------------------------------------------ */

/** v1 shape ids that were renamed in v2 (docs/FORMAT.md §v1 → v2). */
const V1_SHAPES: Record<string, ShapeId> = {
  square: "square",
  circle: "circle",
  triangle: "triangle",
  quarterCircle: "quarterCircle",
  semiCircle: "semiCircle",
  hamza1: "hamza1",
  hamza2: "hamza2",
  "semi-hexagone": "pentagon",
  arc: "curve",
  comb: "comb",
};

/**
 * Rewrites one **v1** item into its v2 field names. Returns `null` for
 * anything unrecognised; the result still goes through `normalizeItem`, so a
 * v1 file cannot smuggle values past the validator.
 */
export function upgradeItem(value: unknown): unknown | null {
  if (!isRecord(value)) return null;
  const type = value.t;
  const colour = value.c;
  if (type === "tile") {
    return {
      type: "tile",
      column: value.i,
      row: value.j,
      zone: value.q,
      shape: typeof value.s === "string" ? V1_SHAPES[value.s] : undefined,
      rotation: value.r,
      color: colour,
    };
  }
  if (type === "line") {
    return {
      type: "line",
      from: { column: value.i1, row: value.j1 },
      to: { column: value.i2, row: value.j2 },
      color: colour,
    };
  }
  if (type === "arch") {
    // v1 stored the bulge side as a flag; v2 stores the sweep direction. The
    // two are equivalent for the half-circle arcs v1 could express.
    return {
      type: "arc",
      from: { column: value.i1, row: value.j1 },
      to: { column: value.i2, row: value.j2 },
      direction: value.d === 1 ? "counterclockwise" : "clockwise",
      size: "half",
      color: colour,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Minified JSON for a project (UTF-8 when written to a blob). */
export function exportProjectFile(
  input: ProjectFileInput,
  exportedAt: string = new Date().toISOString(),
): string {
  const config = sanitizeProjectConfig(input.config);
  // Items go through the same validator as an imported file, so a writer can
  // never emit unknown fields or a non-canonical key (docs/FORMAT.md §Rules).
  const items: CanvasItem[] = [];
  for (const item of input.items) {
    const clean = normalizeItem(item, config);
    if (clean !== null) items.push(clean);
  }
  const file: ProjectFile = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    name: sanitizeProjectName(input.name),
    config,
    items,
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
  const version = raw.version;
  if (version !== 1 && version !== 2) {
    throw new Error(FILE_ERRORS.unknownVersion);
  }

  const config = sanitizeProjectConfig(raw.config);
  const legacy = version === 1;
  const candidates = Array.isArray(raw.items) ? raw.items : [];
  const items: CanvasItem[] = [];
  const seen = new Set<string>();
  let droppedItems = 0;

  for (const candidate of candidates) {
    const source = legacy ? upgradeItem(candidate) : candidate;
    const item = source === null ? null : normalizeItem(source, config);
    if (!item || seen.has(item.key)) continue;
    seen.add(item.key);
    if (items.length >= MAX_ITEMS) {
      droppedItems += 1;
      continue;
    }
    items.push(item);
  }

  return {
    name: sanitizeProjectName(raw.name),
    config,
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
