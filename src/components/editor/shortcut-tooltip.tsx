"use client";

/**
 * KufiCraft — the one way a control carries its key.
 *
 * Shortcuts are not printed in the editor: a control says its action, and the
 * key rides in a tooltip on hover or keyboard focus (`docs/UI.md` § Editor,
 * “Showing shortcuts”). `ShortcutTooltip` keeps that policy in one place:
 *
 * * the control itself is the trigger (Base UI's `render`), so the tooltip
 *   never wraps it in a second interactive element and the click target is
 *   unchanged;
 * * the key text comes from `shortcut-hints.ts`, the single display/aria
 *   source, and is a `<Kbd data-slot="kbd">` styled by the vendored tooltip;
 * * `label` is repeated as the trigger's `aria-label` by the caller (never the
 *   key); the caller also keeps `aria-keyshortcuts` for assistive tech.
 *
 * A disabled trigger does not open a tooltip — an action that cannot run does
 * not advertise its key. That is deliberate, and the reason the top bar's
 * undo/redo need no special case.
 */

import type { ReactElement } from "react";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { EditorShortcut } from "./shortcuts";
import { shortcutLabel } from "./shortcut-hints";
import { usePrimaryModifier } from "./use-primary-modifier";

type TooltipSide =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "inline-start"
  | "inline-end";

export interface ShortcutTooltipProps {
  /** The action or tool name — the accessible name, never the key. */
  label: string;
  /** A second, non-key line (the hand tool's double-click hint). */
  description?: string;
  /** The shortcut the control fires; omit for a name-only tooltip. */
  shortcut?: EditorShortcut | null;
  /** The control itself (it keeps its children and its own props). */
  trigger: ReactElement;
  /** Which side the tooltip opens on; Base UI flips it when space is short. */
  side?: TooltipSide;
}

export function ShortcutTooltip({
  label,
  description,
  shortcut = null,
  trigger,
  side,
}: ShortcutTooltipProps) {
  // The platform only names the primary modifier; the map accepts both.
  const primary = usePrimaryModifier();
  const key = shortcut ? shortcutLabel(shortcut, primary) : null;

  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent side={side}>
        <span className="flex flex-col gap-0.5 text-start">
          <span className="flex items-center gap-1.5">
            {label}
            {key ? (
              <Kbd dir="ltr" aria-hidden="true">
                {key}
              </Kbd>
            ) : null}
          </span>
          {description ? (
            <span className="text-background/70">{description}</span>
          ) : null}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
