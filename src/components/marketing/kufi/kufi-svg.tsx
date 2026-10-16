import { cn } from "@/lib/utils";
import type { Piece } from "./compositions";
import {
  constructionLines,
  gridOf,
  paint,
  viewBoxOf,
  type Grid,
  type Item,
} from "./geometry";

type KufiSvgProps = {
  piece: Piece;
  /** Ink ratio, one of the five presets (1:1 … 1:5). Defaults to the piece's own. */
  ratio?: number;
  /** Draw only part of the piece — used to show the same figure mid-drawing. */
  items?: Item[];
  /** Draw the editor's construction grid under the artwork. */
  grid?: boolean;
  /** Accessible name. Without one the drawing is presentational. */
  label?: string;
  /**
   * How the drawing fills its box: `meet` keeps the whole figure, `slice`
   * fills the box and lets a cell edge crop the figure.
   */
  fit?: "meet" | "slice";
  className?: string;
};

/**
 * Draws one composition as inline SVG, using the same cell, zone and fragment
 * rules the editor stores: the paths come from `geometry.ts`, so the landing
 * page shows what the tool draws rather than a picture of it. Ink is
 * `currentColor`, so the ground decides the colour.
 */
export function KufiSvg({
  piece,
  ratio = piece.ratio,
  items,
  grid = false,
  label,
  fit = "meet",
  className,
}: KufiSvgProps) {
  const g = gridOf(piece.spec, ratio);
  const drawn = items ?? piece.items;
  return (
    <svg
      viewBox={viewBoxOf(piece.spec)}
      preserveAspectRatio={`xMidYMid ${fit}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("block w-full", className)}
    >
      {grid && g.kind === "square" ? <Construction g={g} /> : null}
      {drawn.map((item, index) => {
        const painted = paint(g, item);
        if (!painted) return null;
        return (
          <path
            key={index}
            d={painted.d}
            transform={painted.transform}
            fill={painted.mode === "fill" ? "currentColor" : "none"}
            stroke={painted.mode === "stroke" ? "currentColor" : undefined}
            strokeWidth={
              painted.mode === "stroke" ? painted.strokeWidth : undefined
            }
          />
        );
      })}
    </svg>
  );
}

function Construction({ g }: { g: Grid }) {
  if (g.kind !== "square") return null;
  return (
    <g fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5}>
      {constructionLines(g).map((d) => (
        <path key={d} d={d} />
      ))}
    </g>
  );
}
