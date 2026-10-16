"use client";

import { useState } from "react";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { KufiSvg } from "./kufi-svg";
import { medallion, solar } from "./compositions";

const GRIDS = [
  { value: "square", label: "مربعة", piece: medallion },
  { value: "circular", label: "دائرية", piece: solar },
] as const;

type GridValue = (typeof GRIDS)[number]["value"];

/**
 * The hero's one live control: the ink ratio and the grid kind, driving the
 * drawing above them. This panel is a fragment of the editor, so it carries
 * `data-ui` and the product's own control conventions inside.
 */
export function RatioInstrument() {
  const [ratio, setRatio] = useState(50);
  const [grid, setGrid] = useState<GridValue>("square");
  const piece = grid === "square" ? medallion : solar;

  return (
    // Base UI takes its direction from this provider, not from the document, so
    // the panel declares it: without it the arrow keys move the thumb the
    // opposite way to the track the reader sees.
    <DirectionProvider direction="rtl">
      <div
        data-ui=""
        className="mk-stage flex flex-col gap-5 bg-secondary px-4 py-5 text-primary sm:px-6 sm:py-6"
      >
        <div className="mk-stage__frame">
          <KufiSvg
            piece={piece}
            ratio={ratio / 100}
            grid
            label={`${piece.name}: ${piece.note} بنسبة حبر ${ratio}%`}
            className="h-full"
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
          <div className="flex min-w-40 grow items-center gap-3">
            <span
              id="mk-ratio-label"
              className="mk-small shrink-0 text-foreground"
            >
              نسبة الحبر
            </span>
            <Slider
              aria-labelledby="mk-ratio-label"
              min={25}
              max={75}
              step={5}
              value={[ratio]}
              onValueChange={(value) => {
                setRatio(Array.isArray(value) ? value[0] : value);
              }}
              className="grow"
            />
            <span className="mk-small w-9 shrink-0 text-end text-foreground tabular-nums">
              {ratio}%
            </span>
          </div>

          <ToggleGroup
            value={[grid]}
            onValueChange={(values) => {
              const next = values[0];
              if (next === "square" || next === "circular") setGrid(next);
            }}
            multiple={false}
            variant="outline"
            aria-label="نوع الشبكة"
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
    </DirectionProvider>
  );
}
