/**
 * KufiCraft — editor swatch palettes and number formatting.
 *
 * Swatches are artwork data (hex colours stored on items / config), not UI
 * chrome, so they are literal values; every other colour in the editor comes
 * from the theme tokens in `globals.css`.
 */

export const INK_SWATCHES: readonly string[] = [
  "#1a1a2e",
  "#0f172a",
  "#111827",
  "#7c2d12",
  "#a16207",
  "#166534",
  "#155e75",
  "#3730a3",
  "#6b21a8",
  "#9f1239",
];

export const PAPER_SWATCHES: readonly string[] = [
  "#ffffff",
  "#faf7f0",
  "#f5f0e6",
  "#eef2f7",
  "#e2e8f0",
  "#1a1a2e",
  "#0f172a",
  "#000000",
];

/** `#a1b2c3` → “a1b2c3” (Latin hex stays Latin, as in the docs). */
export function swatchLabel(prefix: string, color: string): string {
  return `${prefix} ${color.replace("#", "").toUpperCase()}`;
}

/** The recent colours first, then the defaults, without duplicates. */
export function mergedSwatches(
  recent: readonly string[],
  defaults: readonly string[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const color of [...recent, ...defaults]) {
    const key = color.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(color);
  }
  return merged;
}

const arabicNumbers = new Intl.NumberFormat("ar-EG");

/** Arabic-Indic digits for counts shown as UI copy. */
export function formatCount(value: number): string {
  return arabicNumbers.format(value);
}
