"use client";

/**
 * KufiCraft — interactive canvas stage.
 *
 * The stage box is square (`aspect-square`) and its width is
 * `min(100%, 100svh - 14rem) × zoom`, so the SVG never letterboxes and the
 * zoom control is plain CSS — the pointer → viewBox mapping measures the
 * live rect, which makes both the zoom and RTL exact.
 *
 * When the board is bigger than the pane, the surrounding scroller (the
 * `viewportRef` element) does the moving. The surface centres itself with
 * `margin: auto`, which collapses to zero as soon as it overflows, so the
 * whole artwork stays inside the scrollable region — a canvas centred with
 * `justify-center` overflows off the inline-start edge too, and a scroll
 * container can never reach that. The hand tool drags this scroller, and a
 * double click puts the middle of the board back in the middle of the pane
 * (`docs/CANVAS.md` §6).
 *
 * The artwork itself is the memoised `<CanvasPreview>`; pointer moves only
 * re-render the overlay.
 */

import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CanvasPreview } from "@/components/canvas/canvas-preview";
import { visibleItems } from "@/lib/canvas/items";
import type { CanvasItem, LinePoint, ProjectConfig } from "@/lib/canvas/model";
import type { Rect } from "@/lib/canvas/geometry";
import { MAX_ZOOM, MIN_ZOOM } from "@/lib/editor-prefs";
import { cn } from "@/lib/utils";
import { MESSAGES } from "./messages";
import { formatCount } from "./editor-palette";
import { CanvasOverlay } from "./canvas-overlay";
import { toolOf } from "./tools";
import { nextZoom, zoomPercent } from "./interaction";
import type { ToolId } from "./interaction";
import { shortcutAriaLabel } from "./shortcut-hints";
import { ShortcutTooltip } from "./shortcut-tooltip";
import { usePrimaryModifier } from "./use-primary-modifier";

export interface CanvasStageProps {
  config: ProjectConfig;
  items: readonly CanvasItem[];
  selectionItems: readonly CanvasItem[];
  previewItems: readonly CanvasItem[];
  eraseItems: readonly CanvasItem[];
  marquee: Rect | null;
  /** The armed start point of a click sequence (line / arc), or null. */
  marker: LinePoint | null;
  /** The point the next click would store (the line / arc dot). */
  dot: LinePoint | null;
  previewMode: "solid" | "ghost";
  tool: ToolId;
  zoom: number;
  setZoom: (zoom: number) => void;
  surfaceRef: RefObject<HTMLDivElement | null>;
  /** The scroll container around the canvas (the hand tool pans it). */
  viewportRef: RefObject<HTMLDivElement | null>;
  /** Double click with a view tool: middle of the canvas in the middle. */
  onCentreView: () => void;
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
  dot,
  previewMode,
  tool,
  zoom,
  setZoom,
  surfaceRef,
  viewportRef,
  onCentreView,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: CanvasStageProps) {
  const selected = selectionItems.length;
  // The board draws only what its grid carries (`docs/CANVAS.md` §3): a
  // circular board hides line/arc items, which stay in the document untouched.
  const shown = visibleItems(config.gridType, items);
  // The cursor, the hint and the pan flag all come from the tool class, so a
  // new tool cannot forget them.
  const active = toolOf(tool);
  const primary = usePrimaryModifier();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        The canvas is centred with `m-auto` on the surface rather than
        `justify-center` on this wrapper: auto margins collapse to zero when the
        surface is larger than the viewport, which puts the whole artwork inside
        the scrollable overflow region. A centred flex item overflows both
        edges, and a scroll container cannot reach its inline-start edge — that
        is what used to leave the board unscrollable sideways.
      */}
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain bg-muted/30 p-3 sm:p-5"
      >
        <div className="flex min-h-full">
          <div
            ref={surfaceRef}
            role="application"
            aria-label={MESSAGES.canvasLabel}
            tabIndex={0}
            style={{ width: `calc(min(100%, 100svh - 14rem) * ${zoom})` }}
            className={cn(
              "relative m-auto aspect-square shrink-0 touch-none rounded-sm bg-background",
              "shadow-sm ring-1 ring-border/70 outline-none select-none",
              "focus-visible:ring-2 focus-visible:ring-ring",
              active.cursor,
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onDoubleClick={active.pans ? onCentreView : undefined}
            onContextMenu={(event) => event.preventDefault()}
          >
            <CanvasPreview
              config={config}
              items={shown}
              className="absolute inset-0 h-full w-full"
            />
            <CanvasOverlay
              config={config}
              selectionItems={selectionItems}
              previewItems={previewItems}
              eraseItems={eraseItems}
              marquee={marquee}
              marker={marker}
              dot={dot}
              previewMode={previewMode}
            />
          </div>
        </div>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border/70 bg-background px-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {formatCount(shown.length)} {MESSAGES.itemsCount}
        </span>
        {selected > 0 ? (
          <span className="tabular-nums text-foreground">
            · {MESSAGES.selectedCount} {formatCount(selected)}
          </span>
        ) : null}
        {active.hint ? (
          <span className="truncate text-muted-foreground/80">
            · {active.hint}
          </span>
        ) : null}

        <div className="ms-auto flex items-center gap-1">
          <span className="sr-only" id="editor-zoom-label">
            {MESSAGES.zoom}
          </span>
          <ShortcutTooltip
            label={MESSAGES.zoomOut}
            shortcut={{ kind: "zoomOut" }}
            trigger={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={MESSAGES.zoomOut}
                aria-keyshortcuts={shortcutAriaLabel({ kind: "zoomOut" }, primary)}
                disabled={zoom <= MIN_ZOOM}
                onClick={() => setZoom(nextZoom(zoom, -1, MIN_ZOOM, MAX_ZOOM))}
              >
                <Minus />
              </Button>
            }
          />
          <ShortcutTooltip
            label={MESSAGES.zoomReset}
            shortcut={{ kind: "zoomReset" }}
            trigger={
              <button
                type="button"
                aria-describedby="editor-zoom-label"
                aria-label={MESSAGES.zoomReset}
                aria-keyshortcuts={shortcutAriaLabel({ kind: "zoomReset" }, primary)}
                onClick={() => setZoom(1)}
                className="min-w-10 rounded text-center tabular-nums text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {zoomPercent(zoom)}%
              </button>
            }
          />
          <ShortcutTooltip
            label={MESSAGES.zoomIn}
            shortcut={{ kind: "zoomIn" }}
            trigger={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={MESSAGES.zoomIn}
                aria-keyshortcuts={shortcutAriaLabel({ kind: "zoomIn" }, primary)}
                disabled={zoom >= MAX_ZOOM}
                onClick={() => setZoom(nextZoom(zoom, 1, MIN_ZOOM, MAX_ZOOM))}
              >
                <Plus />
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );
}
