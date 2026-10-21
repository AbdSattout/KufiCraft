"use client";

/**
 * KufiCraft — editor top bar.
 *
 * Back link, inline project name (committed on blur / Enter), the autosave
 * indicator, undo/redo, the export menu and the mobile settings trigger.
 */

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Download,
  FileDown,
  FileJson,
  ImageDown,
  Redo2,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { SaveState } from "@/lib/save-state";
import { MESSAGES } from "./messages";
import { shortcutAriaLabel } from "./shortcut-hints";
import { ShortcutTooltip } from "./shortcut-tooltip";
import { usePrimaryModifier } from "./use-primary-modifier";

/** Dot, label and tone for each save state — the two warnings are the only loud ones. */
const SAVE_INDICATORS: Record<
  SaveState,
  { label: string; dot: string; warning: boolean }
> = {
  saved: {
    label: MESSAGES.savedAutomatically,
    dot: "bg-primary/40",
    warning: false,
  },
  saving: {
    label: MESSAGES.saving,
    dot: "bg-accent",
    warning: false,
  },
  retrying: {
    label: MESSAGES.savingRetrying,
    dot: "bg-destructive/70",
    warning: true,
  },
  offline: {
    label: MESSAGES.unsavedOffline,
    dot: "bg-destructive",
    warning: true,
  },
};

interface ProjectNameInputProps {
  name: string;
  rename: (name: string) => void;
}

function ProjectNameInput({ name, rename }: ProjectNameInputProps) {
  /** `null` while showing the server name; holds the edit in progress. */
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? name;

  const commit = () => {
    const next = (draft ?? name).replace(/\s+/g, " ").trim();
    setDraft(null);
    if (next.length === 0 || next === name) return;
    rename(next);
  };

  return (
    <ShortcutTooltip
      label={MESSAGES.renameHint}
      side="bottom"
      trigger={
        <Input
          value={shown}
          aria-label={MESSAGES.renameLabel}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
          className={cn(
            "h-8 min-w-0 flex-1 border-transparent bg-transparent px-2 font-heading text-sm shadow-none",
            "hover:border-input/60 focus-visible:border-input md:max-w-72 md:text-base",
          )}
        />
      }
    />
  );
}

export interface EditorTopBarProps {
  name: string;
  rename: (name: string) => void;
  /** Saved / saving / retrying / offline — the one place the app says it. */
  save: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  exportSvg: () => void;
  exportPng: () => void;
  exportFile: () => void;
  onOpenSettings: () => void;
}

export function EditorTopBar({
  name,
  rename,
  save,
  canUndo,
  canRedo,
  undo,
  redo,
  exportSvg,
  exportPng,
  exportFile,
  onOpenSettings,
}: EditorTopBarProps) {
  const indicator = SAVE_INDICATORS[save];
  // The platform only names the primary modifier; the map accepts both.
  const primary = usePrimaryModifier();

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border/70 bg-background px-2 sm:px-3">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={MESSAGES.backToDashboardHint}
        nativeButton={false}
        render={<Link href="/" />}
      >
        <ArrowRight />
      </Button>

      <ProjectNameInput name={name || MESSAGES.untitled} rename={rename} />

      <span
        aria-live="polite"
        className={cn(
          "hidden shrink-0 items-center gap-1.5 text-xs sm:flex",
          indicator.warning ? "text-destructive" : "text-muted-foreground",
        )}
      >
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", indicator.dot)}
        />
        {indicator.label}
      </span>

      <div className="ms-auto flex shrink-0 items-center gap-1">
        <ShortcutTooltip
          label={MESSAGES.undo}
          shortcut={{ kind: "undo" }}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={MESSAGES.undo}
              aria-keyshortcuts={shortcutAriaLabel({ kind: "undo" }, primary)}
              disabled={!canUndo}
              onClick={undo}
            >
              <Undo2 />
            </Button>
          }
        />
        <ShortcutTooltip
          label={MESSAGES.redo}
          shortcut={{ kind: "redo" }}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={MESSAGES.redo}
              aria-keyshortcuts={shortcutAriaLabel({ kind: "redo" }, primary)}
              disabled={!canRedo}
              onClick={redo}
            >
              <Redo2 />
            </Button>
          }
        />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={MESSAGES.export}
              >
                <Download />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={exportSvg}>
              <FileDown />
              {MESSAGES.exportSvg}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportPng}>
              <ImageDown />
              {MESSAGES.exportPng}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportFile}>
              <FileJson />
              {MESSAGES.exportFile}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label={MESSAGES.openSettings}
          onClick={onOpenSettings}
        >
          <SlidersHorizontal />
        </Button>
      </div>
    </header>
  );
}
