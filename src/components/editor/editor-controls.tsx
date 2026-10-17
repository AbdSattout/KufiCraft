"use client";

/**
 * KufiCraft — small editor controls shared by the panels.
 *
 * These are thin wrappers over the vendored Base UI primitives: a labelled
 * slider that stays live locally and commits once (so dragging the ink ratio
 * redraws immediately without writing to Convex on every frame), a colour
 * field with a swatch row, and the panel section frame.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";

export interface PanelSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function PanelSection({ title, children, className }: PanelSectionProps) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <h2 className="font-heading text-xs text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Shown next to the value, e.g. `%`. */
  suffix?: string;
  /** Live update while dragging (local preview only). */
  onPreview: (value: number) => void;
  /** Committed value (one backend write). */
  onCommit: (value: number) => void;
}

export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onPreview,
  onCommit,
}: SliderFieldProps) {
  /** `null` until the user drags — then the label follows the thumb live. */
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {shown}
          {suffix}
        </span>
      </div>
      <Slider
        value={shown}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onValueChange={(next) => {
          const numeric = Number(next);
          setDraft(numeric);
          onPreview(numeric);
        }}
        onValueCommitted={(next) => {
          setDraft(null);
          onCommit(Number(next));
        }}
      />
    </div>
  );
}

export interface SwatchRowProps {
  colors: readonly string[];
  /** Highlighted when it equals this colour. */
  current?: string;
  onPick: (color: string) => void;
  labelFor: (color: string) => string;
}

export function SwatchRow({ colors, current, onPick, labelFor }: SwatchRowProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={labelFor(color)}
          aria-pressed={current === color}
          onClick={() => onPick(color)}
          style={{ backgroundColor: color }}
          className={cn(
            "size-6 rounded-full border border-border/70 transition-transform duration-150 ease-out",
            "hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            current === color ? "ring-2 ring-ring ring-offset-1 ring-offset-background" : "",
          )}
        />
      ))}
    </div>
  );
}

export interface ColourFieldProps {
  label: string;
  value: string;
  colors: readonly string[];
  onPick: (color: string) => void;
  labelFor: (color: string) => string;
  /**
   * Hides the inline label (kept for screen readers) when the surrounding
   * section heading already names the control.
   */
  hideLabel?: boolean;
}

export function ColourField({
  label,
  value,
  colors,
  onPick,
  labelFor,
  hideLabel = false,
}: ColourFieldProps) {
  /** `null` until the picker moves — then the row follows the picker live. */
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  // The native colour picker fires continuously while dragging; debounce so
  // a picker sweep becomes one write instead of fifty.
  useEffect(() => {
    if (draft === null || draft === value) return;
    const timer = window.setTimeout(() => {
      setDraft(null);
      onPick(draft);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draft, onPick, value]);

  const pick = (color: string) => {
    setDraft(null);
    onPick(color);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={cn("text-sm text-muted-foreground", hideLabel && "sr-only")}>
          {label}
        </span>
        <Input
          type="color"
          value={shown}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          className="h-7 w-10 shrink-0 cursor-pointer p-0.5"
        />
        <span className="truncate text-xs text-muted-foreground/80" dir="ltr">
          {shown.toUpperCase()}
        </span>
      </div>
      <SwatchRow
        colors={colors}
        current={shown}
        onPick={pick}
        labelFor={labelFor}
      />
    </div>
  );
}
