"use client";

import { useState } from "react";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { RATIO_PRESETS } from "@/lib/canvas/model";
import { KufiSvg } from "./kufi-svg";
import { medallion, solar } from "./compositions";

const GRIDS = [
  { value: "square", label: "مربعة", piece: medallion },
  { value: "circular", label: "دائرية", piece: solar },
] as const;

type GridValue = (typeof GRIDS)[number]["value"];

/** The tool's default 1:3 — the medallion's opening frame. */
const OPENING_RATIO = RATIO_PRESETS[2].label;

/**
 * The hero's one live control: the ink ratio and the grid kind, driving the
 * drawing above them. This panel is a fragment of the editor, so it carries
 * `data-ui` and the product's own control conventions inside — and the ratio
 * is one of the five presets kufi is drawn in (1:1 … 1:5), never a free value.
 */
export function RatioInstrument() {
  const [ratio, setRatio] = useState(OPENING_RATIO);
  const [grid, setGrid] = useState<GridValue>("square");
  const piece = grid === "square" ? medallion : solar;
  const preset =
    RATIO_PRESETS.find((option) => option.label === ratio) ?? RATIO_PRESETS[0];

  return (
    // Base UI takes its direction from this provider, not from the document, so
    // the panel declares it: without it the arrow keys move through a group the
    // opposite way to the order the reader sees.
    <DirectionProvider direction="rtl">
      <div
        data-ui=""
        className="mk-stage flex flex-col gap-5 bg-secondary px-4 py-5 text-primary sm:px-6 sm:py-6"
      >
        <div className="mk-stage__frame">
          <KufiSvg
            piece={piece}
            ratio={preset.ratio}
            grid
            label={`${piece.name}: ${piece.note} بنسبة حبر ${preset.label}`}
            className="h-full"
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <span
              id="mk-ratio-label"
              className="mk-small shrink-0 text-foreground"
            >
              نسبة الحبر
            </span>
            <ToggleGroup
              value={[preset.label]}
              onValueChange={(values) => {
                const next = values[0];
                if (next) setRatio(next);
              }}
              multiple={false}
              variant="outline"
              size="sm"
              aria-labelledby="mk-ratio-label"
            >
              {RATIO_PRESETS.map((option) => (
                <ToggleGroupItem
                  key={option.label}
                  value={option.label}
                  aria-label={`نسبة الحبر ${option.label}`}
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <span
              id="mk-grid-label"
              className="mk-small shrink-0 text-foreground"
            >
              نوع الشبكة
            </span>
            <ToggleGroup
              value={[grid]}
              onValueChange={(values) => {
                const next = values[0];
                if (next === "square" || next === "circular") setGrid(next);
              }}
              multiple={false}
              variant="outline"
              size="sm"
              aria-labelledby="mk-grid-label"
            >
              {GRIDS.map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  aria-label={`شبكة ${option.label}`}
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      </div>
    </DirectionProvider>
  );
}
