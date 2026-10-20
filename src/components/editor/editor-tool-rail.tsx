"use client";

/**
 * KufiCraft — tool rail.
 *
 * Vertical icon rail on desktop (RTL: right edge, labels under the icons),
 * horizontal bar above the status line on mobile. It is generated from the
 * tool registry (`tools.ts`): the order, the labels, the shortcut hints and
 * the glyphs all come from the tool classes, and a grid that does not carry a
 * tool's items does not list it (`toolsFor`, docs/CANVAS.md §3) — so a new
 * tool shows up here without touching this file.
 *
 * The arc tool reveals its own controls next to it: the sweep direction and
 * the circle size (`docs/CANVAS.md` §5).
 */

import { Button } from "@/components/ui/button";
import type { GridType } from "@/lib/canvas/model";
import { cn } from "@/lib/utils";
import { MESSAGES } from "./messages";
import { isToolAvailable, toolOf, toolsFor } from "./tools";
import type { ToolIconPart } from "./tools";
import type { ArcStyle, ToolId } from "./interaction";

/** Renders one tool's glyph in a 24×24 box (paths are the tool's own). */
export function ToolGlyph({
  tool,
  className,
}: {
  tool: ToolId;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-4", className)}>
      {toolOf(tool).icon.map((part: ToolIconPart, index: number) =>
        part.mode === "fill" ? (
          <path key={index} d={part.d} fill="currentColor" />
        ) : (
          <path
            key={index}
            d={part.d}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
}

export interface ToolRailProps {
  tool: ToolId;
  setTool: (tool: ToolId) => void;
  /** The board's grid — decides which tools exist (docs/CANVAS.md §3). */
  gridType: GridType;
  arc: ArcStyle;
  setArcDirection: (direction: ArcStyle["direction"]) => void;
  setArcSize: (size: ArcStyle["size"]) => void;
  /** Double click on a view tool's button (the hand centres the board). */
  onCentreView: () => void;
  orientation: "vertical" | "horizontal";
  className?: string;
}

export function ToolRail({
  tool,
  setTool,
  gridType,
  arc,
  setArcDirection,
  setArcSize,
  onCentreView,
  orientation,
  className,
}: ToolRailProps) {
  const vertical = orientation === "vertical";

  return (
    <div
      role="toolbar"
      aria-label={MESSAGES.tools}
      aria-orientation={orientation}
      className={cn(
        "flex gap-1 bg-background",
        vertical
          ? "w-16 shrink-0 flex-col items-stretch border-e border-border/70 p-1.5"
          : "flex-row items-center overflow-x-auto overscroll-x-contain border-t border-border/70 p-1.5",
        className,
      )}
    >
      {toolsFor(gridType).map((entry) => {
        const active = entry.id === tool;
        const hint = entry.pans
          ? `${entry.label} (${entry.shortcut}) — ${MESSAGES.handDoubleClick}`
          : `${entry.label} (${entry.shortcut})`;
        return (
          <Button
            key={entry.id}
            variant={active ? "secondary" : "ghost"}
            aria-pressed={active}
            aria-label={hint}
            title={hint}
            onClick={() => setTool(entry.id)}
            onDoubleClick={entry.pans ? onCentreView : undefined}
            className={cn(
              "h-auto flex-col gap-0.5 px-1 py-1.5 text-[0.7rem]",
              vertical ? "w-full" : "min-w-16 shrink-0",
            )}
          >
            <ToolGlyph tool={entry.id} />
            <span>{entry.label}</span>
          </Button>
        );
      })}

      {isToolAvailable(gridType, "arc") && tool === "arc" ? (
        <>
          <div
            role="group"
            aria-label={MESSAGES.arcDirection}
            className={cn(
              "flex gap-1",
              vertical ? "flex-col" : "flex-row items-center",
            )}
          >
            <Button
              variant={arc.direction === "clockwise" ? "secondary" : "ghost"}
              aria-pressed={arc.direction === "clockwise"}
              aria-label={MESSAGES.arcClockwise}
              title={MESSAGES.arcClockwise}
              onClick={() => setArcDirection("clockwise")}
              className="h-auto flex-col gap-0.5 px-1 py-1.5 text-[0.7rem]"
            >
              <span aria-hidden className="text-base leading-none">
                ⟳
              </span>
              <span>{MESSAGES.arcClockwiseShort}</span>
            </Button>
            <Button
              variant={
                arc.direction === "counterclockwise" ? "secondary" : "ghost"
              }
              aria-pressed={arc.direction === "counterclockwise"}
              aria-label={MESSAGES.arcCounterclockwise}
              title={MESSAGES.arcCounterclockwise}
              onClick={() => setArcDirection("counterclockwise")}
              className="h-auto flex-col gap-0.5 px-1 py-1.5 text-[0.7rem]"
            >
              <span aria-hidden className="text-base leading-none">
                ⟲
              </span>
              <span>{MESSAGES.arcCounterclockwiseShort}</span>
            </Button>
          </div>

          <div
            role="group"
            aria-label={MESSAGES.arcSize}
            className={cn(
              "flex gap-1",
              vertical ? "flex-col" : "flex-row items-center",
            )}
          >
            <Button
              variant={arc.size === "quarter" ? "secondary" : "ghost"}
              aria-pressed={arc.size === "quarter"}
              aria-label={MESSAGES.arcQuarter}
              title={MESSAGES.arcQuarter}
              onClick={() => setArcSize("quarter")}
              className="h-auto flex-col gap-0.5 px-1 py-1.5 text-[0.7rem]"
            >
              <span aria-hidden className="text-base leading-none">
                ◜
              </span>
              <span>{MESSAGES.arcQuarterShort}</span>
            </Button>
            <Button
              variant={arc.size === "half" ? "secondary" : "ghost"}
              aria-pressed={arc.size === "half"}
              aria-label={MESSAGES.arcHalf}
              title={MESSAGES.arcHalf}
              onClick={() => setArcSize("half")}
              className="h-auto flex-col gap-0.5 px-1 py-1.5 text-[0.7rem]"
            >
              <span aria-hidden className="text-base leading-none">
                ⌒
              </span>
              <span>{MESSAGES.arcHalfShort}</span>
            </Button>
            <Button
              variant={arc.size === "threeQuarter" ? "secondary" : "ghost"}
              aria-pressed={arc.size === "threeQuarter"}
              aria-label={MESSAGES.arcThreeQuarter}
              title={MESSAGES.arcThreeQuarter}
              onClick={() => setArcSize("threeQuarter")}
              className="h-auto flex-col gap-0.5 px-1 py-1.5 text-[0.7rem]"
            >
              <span aria-hidden className="text-base leading-none">
                ◠
              </span>
              <span>{MESSAGES.arcThreeQuarterShort}</span>
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
