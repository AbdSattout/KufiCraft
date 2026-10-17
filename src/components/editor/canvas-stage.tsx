"use client";

/**
 * KufiCraft — interactive canvas stage.
 *
 * The stage box is square (`aspect-square`) and its width is
 * `min(100%, 100svh - 14rem) × zoom`, so the SVG never letterboxes and the
 * zoom control is plain CSS — the pointer → viewBox mapping measures the
 * live rect, which makes both the zoom and RTL exact.
 *
 * The artwork itself is the memoised `<CanvasPreview>`; pointer moves only
 * re-render the overlay.
 */

import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CanvasPreview } from "@/components/canvas/canvas-preview";
import type { Anchor, CanvasItem, ProjectConfig } from "@/lib/canvas/model";
import type { Rect } from "@/lib/canvas/geometry";
import { cn } from "@/lib/utils";
import { MESSAGES } from "./messages";
import { formatCount } from "./editor-palette";
import { CanvasOverlay } from "./canvas-overlay";
import { toolOf } from "./tools";
import type { ToolId } from "./interaction";

export interface CanvasStageProps {
  config: ProjectConfig;
  items: readonly CanvasItem[];
  selectionItems: readonly CanvasItem[];
  previewItems: readonly CanvasItem[];
  eraseItems: readonly CanvasItem[];
  marquee: Rect | null;
  /** The armed start anchor of a click sequence (line / arc), or null. */
  marker: Anchor | null;
  previewMode: "solid" | "ghost";
  tool: ToolId;
  zoom: number;
  setZoom: (zoom: number) => void;
  surfaceRef: RefObject<HTMLDivElement | null>;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
}

export function CanvasStage({
  config,
  items,
  selectionItems,
  previewItems,
  eraseItems,
  marquee,
  marker,
  previewMode,
  tool,
  zoom,
  setZoom,
  surfaceRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: CanvasStageProps) {
  const selected = selectionItems.length;
  // The cursor comes from the tool class, so a new tool cannot forget one.
  const cursor = toolOf(tool).cursor;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-3 sm:p-5">
        <div className="flex min-h-full items-center justify-center">
          <div
            ref={surfaceRef}
            role="application"
            aria-label={MESSAGES.canvasLabel}
            tabIndex={0}
            style={{ width: `calc(min(100%, 100svh - 14rem) * ${zoom})` }}
            className={cn(
              "relative aspect-square shrink-0 touch-none rounded-sm bg-background",
              "shadow-sm ring-1 ring-border/70 outline-none select-none",
              "focus-visible:ring-2 focus-visible:ring-ring",
              cursor,
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onContextMenu={(event) => event.preventDefault()}
          >
            <CanvasPreview
              config={config}
              items={items}
              className="absolute inset-0 h-full w-full"
            />
            <CanvasOverlay
              config={config}
              selectionItems={selectionItems}
              previewItems={previewItems}
              eraseItems={eraseItems}
              marquee={marquee}
              marker={marker}
              previewMode={previewMode}
            />
          </div>
        </div>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border/70 bg-background px-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {formatCount(items.length)} {MESSAGES.itemsCount}
        </span>
        {selected > 0 ? (
          <span className="tabular-nums text-foreground">
            · {MESSAGES.selectedCount} {formatCount(selected)}
          </span>
        ) : null}
        {tool === "line" ? (
          <span className="truncate text-muted-foreground/80">
            · {MESSAGES.lineHint}
          </span>
        ) : null}

        <div className="ms-auto flex items-center gap-1">
          <span className="sr-only" id="editor-zoom-label">
            {MESSAGES.zoom}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={MESSAGES.zoomOut}
            disabled={zoom <= 0.5}
            onClick={() => setZoom(zoom - 0.25)}
          >
            <Minus />
          </Button>
          <button
            type="button"
            aria-describedby="editor-zoom-label"
            aria-label={MESSAGES.zoomReset}
            onClick={() => setZoom(1)}
            className="min-w-10 rounded text-center tabular-nums text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={MESSAGES.zoomIn}
            disabled={zoom >= 2}
            onClick={() => setZoom(zoom + 0.25)}
          >
            <Plus />
          </Button>
        </div>
      </div>
    </div>
  );
}
