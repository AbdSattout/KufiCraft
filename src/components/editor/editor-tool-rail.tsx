"use client";

/**
 * KufiCraft — tool rail.
 *
 * Vertical icon rail on desktop (RTL: right edge, labels under the icons),
 * horizontal bar above the status line on mobile. The arch tool reveals its
 * bulge toggle next to it.
 */

import { Eraser, MousePointer2, Pen, Spline } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MESSAGES } from "./messages";
import { TOOL_LABELS, TOOL_ORDER, TOOL_SHORTCUTS } from "./interaction";
import type { Tool } from "./interaction";

const TOOL_ICONS: Record<Tool, typeof Pen> = {
  select: MousePointer2,
  pen: Pen,
  eraser: Eraser,
  arch: Spline,
};

export interface ToolRailProps {
  tool: Tool;
  setTool: (tool: Tool) => void;
  bulge: 0 | 1;
  setBulge: (bulge: 0 | 1) => void;
  orientation: "vertical" | "horizontal";
  className?: string;
}

export function ToolRail({
  tool,
  setTool,
  bulge,
  setBulge,
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
          : "flex-row items-center overflow-x-auto border-t border-border/70 p-1.5",
        className,
      )}
    >
      {TOOL_ORDER.map((entry) => {
        const Icon = TOOL_ICONS[entry];
        const active = entry === tool;
        return (
          <Button
            key={entry}
            variant={active ? "secondary" : "ghost"}
            aria-pressed={active}
            aria-label={`${TOOL_LABELS[entry]} (${TOOL_SHORTCUTS[entry]})`}
            title={`${TOOL_LABELS[entry]} (${TOOL_SHORTCUTS[entry]})`}
            onClick={() => setTool(entry)}
            className={cn(
              "h-auto flex-col gap-0.5 px-1 py-1.5 text-[0.7rem]",
              vertical ? "w-full" : "min-w-16 shrink-0",
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span>{TOOL_LABELS[entry]}</span>
          </Button>
        );
      })}

      {tool === "arch" ? (
        <div
          role="group"
          aria-label={MESSAGES.bulgeUp}
          className={cn(
            "flex gap-1",
            vertical ? "flex-col" : "flex-row items-center",
          )}
        >
          <Button
            variant={bulge === 0 ? "secondary" : "ghost"}
            aria-pressed={bulge === 0}
            aria-label={MESSAGES.bulgeUp}
            onClick={() => setBulge(0)}
            className="h-auto flex-col gap-0.5 px-1 py-1.5 text-[0.7rem]"
          >
            <span aria-hidden className="text-base leading-none">
              ⌒
            </span>
            <span>علوية</span>
          </Button>
          <Button
            variant={bulge === 1 ? "secondary" : "ghost"}
            aria-pressed={bulge === 1}
            aria-label={MESSAGES.bulgeDown}
            onClick={() => setBulge(1)}
            className="h-auto flex-col gap-0.5 px-1 py-1.5 text-[0.7rem]"
          >
            <span aria-hidden className="text-base leading-none">
              ⌣
            </span>
            <span>سفلية</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
