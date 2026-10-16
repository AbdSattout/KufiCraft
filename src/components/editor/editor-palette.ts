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

const arabicNumbers = new Intl.NumberFormat("ar-EG");

/** Arabic-Indic digits for counts shown as UI copy. */
export function formatCount(value: number): string {
  return arabicNumbers.format(value);
}
