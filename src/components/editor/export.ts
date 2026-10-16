/**
 * KufiCraft — SVG / PNG export (browser only).
 *
 * Both formats come from the engine: `renderSvg` produces the standalone
 * document, and the PNG is that same document rasterised through an
 * `<img>` + `<canvas>` so exports and thumbnails can never drift apart.
 */

import { renderSvg } from "@/lib/canvas/render";
import type { CanvasItem, ProjectConfig } from "@/lib/canvas/model";

const PNG_SIZE = 2000;

const EXPORT_ERROR = "تعذّر تصدير اللوحة";

function safeFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : "kuficraft";
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads the artwork as a standalone SVG document (no grid). */
export function downloadSvg(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  name: string,
): void {
  const svg = renderSvg(config, items, { showGrid: false, size: 1000 });
  triggerDownload(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    `${safeFileName(name)}.svg`,
  );
}

/** Downloads the artwork as a PNG rasterised at 2000 × 2000. */
export async function downloadPng(
  config: ProjectConfig,
  items: readonly CanvasItem[],
  name: string,
): Promise<void> {
  const svg = renderSvg(config, items, { showGrid: false, size: PNG_SIZE });
  const image = new Image();
  image.width = PNG_SIZE;
  image.height = PNG_SIZE;
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(EXPORT_ERROR));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = PNG_SIZE;
  canvas.height = PNG_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(EXPORT_ERROR);
  if (config.background !== "transparent") {
    context.fillStyle = config.background;
    context.fillRect(0, 0, PNG_SIZE, PNG_SIZE);
  }
  context.drawImage(image, 0, 0, PNG_SIZE, PNG_SIZE);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) throw new Error(EXPORT_ERROR);
  triggerDownload(blob, `${safeFileName(name)}.png`);
}
