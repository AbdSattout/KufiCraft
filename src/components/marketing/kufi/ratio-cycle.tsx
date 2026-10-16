"use client";

import { useEffect, useRef } from "react";
import { RATIO_PRESETS } from "@/lib/canvas/model";
import { cn } from "@/lib/utils";
import { KufiSvg } from "./kufi-svg";
import { medallion } from "./compositions";

/** The tool's default (1:3) between the two ends of the scale, 1:1 and 1:5. */
const RATIOS = [
  RATIO_PRESETS[2].ratio,
  RATIO_PRESETS[0].ratio,
  RATIO_PRESETS[4].ratio,
];

/**
 * The closing figure: the hero's medallion, held while its ink ratio moves
 * from the tool's default to the two ends of the scale and back. Paused while
 * the tab is hidden; under reduced motion only the first build is drawn.
 */
export function RatioCycle({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      el.classList.toggle("mk-paused", document.hidden);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <div ref={ref} className={cn("mk-cycle", className)}>
      {RATIOS.map((ratio) => (
        <KufiSvg
          key={ratio}
          piece={medallion}
          ratio={ratio}
          grid
          className="mk-cycle__frame h-full"
        />
      ))}
    </div>
  );
}
