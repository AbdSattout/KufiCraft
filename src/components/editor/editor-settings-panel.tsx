"use client";

/**
 * KufiCraft — project settings panel.
 *
 * Ordered the way the sidebar reads: the two colours first (لون الحبر is the
 * pen's colour, so it sits right under the shape palette; لون الورقة is the
 * board's background), then the ink ratio as the five presets `1:1`…`1:5`
 * (live re-render), the cell size, the grid-type switch (warned, because
 * existing items are re-interpreted), the board toggles, and finally “مسح الكل”
 * behind a confirm dialog.
 */

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RATIO_PRESETS, VIEWBOX_SIZE, ratioLabel } from "@/lib/canvas/model";
import type { GridType, ProjectConfig } from "@/lib/canvas/model";
import { MESSAGES } from "./messages";
import { INK_SWATCHES, PAPER_SWATCHES, formatCount, swatchLabel } from "./editor-palette";
import { ColourField, PanelSection, SliderField } from "./editor-controls";

const MIN_BASE = 4;
const MAX_BASE = 100;

export interface SettingsPanelProps {
  config: ProjectConfig;
  /** Recent ink colours, most-recent-first (shown ahead of the defaults). */
  inkSwatches: readonly string[];
  itemsCount: number;
  /** Sets the project ink (the colour the pen paints with). */
  setInkColor: (color: string) => void;
  patchConfig: (patch: Partial<ProjectConfig>) => void;
  /** Live, mutation-free update while a slider is dragged. */
  previewConfig: (patch: Partial<ProjectConfig>) => void;
  clearAll: () => void;
}

/** The recent colours first, then the defaults, without duplicates. */
function mergedSwatches(
  recent: readonly string[],
  defaults: readonly string[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const color of [...recent, ...defaults]) {
    const key = color.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(color);
  }
  return merged;
}

function ToggleRow({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-sm text-muted-foreground">
        {label}
      </Label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </div>
  );
}

export function SettingsPanel({
  config,
  inkSwatches,
  itemsCount,
  setInkColor,
  patchConfig,
  previewConfig,
  clearAll,
}: SettingsPanelProps) {
  const [pendingGridType, setPendingGridType] = useState<GridType | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const swatches = useMemo(
    () => mergedSwatches(inkSwatches, INK_SWATCHES),
    [inkSwatches],
  );

  const requestGridType = (next: GridType) => {
    if (next === config.gridType) return;
    if (itemsCount > 0) {
      setPendingGridType(next);
      return;
    }
    patchConfig({ gridType: next });
  };

  const cellsPerAxis = Math.round(VIEWBOX_SIZE / config.base);

  return (
    <>
      <PanelSection title={MESSAGES.inkColor}>
        <p className="text-xs text-muted-foreground/80">
          {MESSAGES.inkColorHint}
        </p>
        <ColourField
          label={MESSAGES.inkColor}
          value={config.ink}
          colors={swatches}
          onPick={setInkColor}
          labelFor={(color) => swatchLabel(MESSAGES.inkColor, color)}
          hideLabel
        />
      </PanelSection>

      <PanelSection title={MESSAGES.paperColor}>
        <ColourField
          label={MESSAGES.paperColor}
          value={config.background}
          colors={PAPER_SWATCHES}
          onPick={(color) => patchConfig({ background: color })}
          labelFor={(color) => swatchLabel(MESSAGES.paperColor, color)}
          hideLabel
        />
      </PanelSection>

      <Separator />

      <PanelSection title={MESSAGES.inkRatio}>
        <ToggleGroup
          aria-label={MESSAGES.inkRatio}
          variant="outline"
          spacing={0}
          className="w-full"
          value={[ratioLabel(config.ratio)]}
          onValueChange={(next) => {
            const preset = RATIO_PRESETS.find((entry) => entry.label === next[0]);
            if (preset) patchConfig({ ratio: preset.ratio });
          }}
        >
          {RATIO_PRESETS.map((preset) => (
            <ToggleGroupItem
              key={preset.label}
              value={preset.label}
              className="flex-1 tabular-nums"
              aria-label={`${MESSAGES.inkRatio} ${preset.label}`}
            >
              {preset.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground/80">
          {config.ratio >= 1 ? MESSAGES.ratioFullCell : MESSAGES.ratioHint}
        </p>
      </PanelSection>

      <PanelSection title={MESSAGES.cellSize}>
        <SliderField
          label={MESSAGES.cellSize}
          value={Math.round(config.base)}
          min={MIN_BASE}
          max={MAX_BASE}
          onPreview={(value) => previewConfig({ base: value })}
          onCommit={(value) => patchConfig({ base: value })}
        />
        <p className="text-xs text-muted-foreground/80">
          {`${formatCount(cellsPerAxis)} × ${formatCount(cellsPerAxis)}`}
        </p>
      </PanelSection>

      <PanelSection title={MESSAGES.gridType}>
        <div className="flex gap-1.5">
          <Button
            variant={config.gridType === "square" ? "secondary" : "outline"}
            size="sm"
            className="flex-1"
            aria-pressed={config.gridType === "square"}
            onClick={() => requestGridType("square")}
          >
            {MESSAGES.gridSquare}
          </Button>
          <Button
            variant={config.gridType === "circular" ? "secondary" : "outline"}
            size="sm"
            className="flex-1"
            aria-pressed={config.gridType === "circular"}
            onClick={() => requestGridType("circular")}
          >
            {MESSAGES.gridCircular}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground/80">
          {MESSAGES.gridTypeHint}
        </p>
      </PanelSection>

      <PanelSection title={MESSAGES.boardOptions}>
        <ToggleRow
          id="editor-show-grid"
          label={MESSAGES.showGrid}
          checked={config.showGrid}
          onCheckedChange={(checked) => patchConfig({ showGrid: checked })}
        />
        <ToggleRow
          id="editor-straight-lines"
          label={MESSAGES.straightLinesAsSquares}
          checked={config.straightLinesAsSquares}
          onCheckedChange={(checked) =>
            patchConfig({ straightLinesAsSquares: checked })
          }
        />
        <p className="text-xs text-muted-foreground/80">
          {MESSAGES.straightLinesAsSquaresHint}
        </p>
      </PanelSection>

      <Separator />

      <Button
        variant="destructive"
        size="sm"
        onClick={() => setConfirmClear(true)}
      >
        <Trash2 />
        {MESSAGES.clearAll}
      </Button>

      <AlertDialog
        open={pendingGridType !== null}
        onOpenChange={(open) => {
          if (!open) setPendingGridType(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{MESSAGES.gridChangeTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {MESSAGES.gridChangeBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{MESSAGES.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingGridType !== null) {
                  patchConfig({ gridType: pendingGridType });
                }
                setPendingGridType(null);
              }}
            >
              {MESSAGES.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{MESSAGES.clearAllTitle}</AlertDialogTitle>
            <AlertDialogDescription>{MESSAGES.clearAllBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{MESSAGES.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                clearAll();
                setConfirmClear(false);
              }}
            >
              {MESSAGES.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
