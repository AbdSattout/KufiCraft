"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { KufiSvg } from "./kufi-svg";
import { medallion } from "./compositions";

const RATIOS = [0.5, 0.75, 0.25];

/**
 * The closing figure: the hero's medallion, held while its ink ratio moves
 * from the tool's default to the two ends of its range and back. Paused while
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
