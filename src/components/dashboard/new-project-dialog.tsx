"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { Circle, Square } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import {
  DEFAULT_PROJECT_CONFIG,
  MAX_NAME_LENGTH,
  MAX_RATIO,
  MIN_RATIO,
  type GridType,
} from "../../../convex/lib/model";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { mutationErrorMessage } from "@/components/dashboard/errors";

const MIN_PERCENT = Math.round(MIN_RATIO * 100);
const MAX_PERCENT = Math.round(MAX_RATIO * 100);

function percentFromRatio(ratio: number): number {
  return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, Math.round(ratio * 100)));
}

/** Two rectangles illustrating ink (القلم) vs space (الفراغ) inside one cell. */
function InkRatioPreview({ ratio }: { ratio: number }) {
  const ink = Math.round(ratio * 100);
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="size-11 shrink-0 text-primary"
    >
      <rect x="0" y="0" width="100" height="100" rx="8" className="fill-muted" />
      <rect x="0" y="0" width={ink} height={ink} rx="4" className="fill-current" />
    </svg>
  );
}

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewProjectDialog({
  open,
  onOpenChange,
}: NewProjectDialogProps) {
  const router = useRouter();
  const createProject = useMutation(api.projects.create);
  const [name, setName] = useState("");
  const [gridType, setGridType] = useState<GridType>(
    DEFAULT_PROJECT_CONFIG.gridType,
  );
  const [inkPercent, setInkPercent] = useState(() =>
    percentFromRatio(DEFAULT_PROJECT_CONFIG.ratio),
  );
  const [isCreating, setIsCreating] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isCreating) return;
    if (nextOpen) {
      setName("");
      setGridType(DEFAULT_PROJECT_CONFIG.gridType);
      setInkPercent(percentFromRatio(DEFAULT_PROJECT_CONFIG.ratio));
    }
    onOpenChange(nextOpen);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating) return;
    setIsCreating(true);
    try {
      const projectId = await createProject({
        name: name.trim(),
        config: {
          ...DEFAULT_PROJECT_CONFIG,
          gridType,
          ratio: inkPercent / 100,
        },
      });
      onOpenChange(false);
      router.push(`/app/${projectId}`);
    } catch (error) {
      toast.error(mutationErrorMessage(error, "تعذّر إنشاء اللوحة"));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>لوحة جديدة</DialogTitle>
          <DialogDescription>
            سمِّ اللوحة واختر نوع الشبكة ونسبة الحبر — يمكنك تغييرها لاحقًا من
            داخل المحرر.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleCreate} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="new-project-name">الاسم</Label>
            <Input
              id="new-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="لوحة بلا عنوان"
              maxLength={MAX_NAME_LENGTH}
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <Label id="new-project-grid-type-label">نوع الشبكة</Label>
            <ToggleGroup
              aria-labelledby="new-project-grid-type-label"
              variant="outline"
              spacing={0}
              className="w-full"
              value={[gridType]}
              onValueChange={(nextValue) => {
                setGridType(nextValue[0] === "circular" ? "circular" : "square");
              }}
            >
              <ToggleGroupItem value="square" className="flex-1">
                <Square className="size-4" />
                مربعة
              </ToggleGroupItem>
              <ToggleGroupItem value="circular" className="flex-1">
                <Circle className="size-4" />
                دائرية
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <Label id="new-project-ink-ratio-label">نسبة الحبر</Label>
              <span className="text-sm tabular-nums text-muted-foreground">
                {inkPercent}٪
              </span>
            </div>
            <Slider
              aria-labelledby="new-project-ink-ratio-label"
              min={MIN_PERCENT}
              max={MAX_PERCENT}
              step={1}
              value={[inkPercent]}
              onValueChange={(value) => {
                const nextPercent = Array.isArray(value) ? value[0] : value;
                if (typeof nextPercent === "number") {
                  setInkPercent(Math.round(nextPercent));
                }
              }}
            />
            <div className="flex items-center gap-3 rounded-lg bg-muted/60 p-3">
              <InkRatioPreview ratio={inkPercent / 100} />
              <p className="text-xs leading-relaxed text-muted-foreground">
                يوضّح الرسم نسبة القلم إلى الفراغ داخل الخلية: كلما زادت، صارت
                الحروف أكثف.
              </p>
            </div>
          </div>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={isCreating} />
              }
            >
              إلغاء
            </DialogClose>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? (
                <>
                  <Spinner className="size-4" aria-label="جارٍ الإنشاء" />
                  جارٍ الإنشاء…
                </>
              ) : (
                "إنشاء اللوحة"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
