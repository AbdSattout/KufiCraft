"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import {
  Copy,
  EllipsisVertical,
  FileJson,
  FolderOpen,
  Pencil,
  Trash2,
} from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { MAX_NAME_LENGTH } from "../../../convex/lib/model";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Spinner } from "@/components/ui/spinner";
import { mutationErrorMessage } from "@/components/dashboard/errors";
import { formatItemCount, formatUpdatedAt } from "@/components/dashboard/format";
import { useExportProjectFile } from "@/components/dashboard/project-files";

type ProjectSummary = FunctionReturnType<typeof api.projects.list>[number];

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const router = useRouter();
  const renameProject = useMutation(api.projects.rename);
  const duplicateProject = useMutation(api.projects.duplicate);
  const removeProject = useMutation(api.projects.remove);
  const exportFile = useExportProjectFile();

  const [renderedAt] = useState(() => Date.now());
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const projectHref = `/app/${project._id}`;

  function openRename() {
    setDraftName(project.name);
    setRenameOpen(true);
  }

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRenaming) return;
    setIsRenaming(true);
    try {
      await renameProject({ projectId: project._id, name: draftName.trim() });
      setRenameOpen(false);
      toast.success("تم حفظ الاسم");
    } catch (error) {
      toast.error(mutationErrorMessage(error, "تعذّر إعادة التسمية"));
    } finally {
      setIsRenaming(false);
    }
  }

  async function handleDuplicate() {
    if (isDuplicating) return;
    setIsDuplicating(true);
    try {
      await duplicateProject({ projectId: project._id });
      toast.success("أُنشئت نسخة من اللوحة");
    } catch (error) {
      toast.error(mutationErrorMessage(error, "تعذّر نسخ اللوحة"));
    } finally {
      setIsDuplicating(false);
    }
  }

  async function handleExport() {
    if (isExporting) return;
    setIsExporting(true);
    try {
      // The card only has a summary — fetch the full document before writing.
      await exportFile(project._id, project.name);
      toast.success("تم تصدير الملف");
    } catch (error) {
      toast.error(mutationErrorMessage(error, "تعذّر تصدير الملف"));
    } finally {
      setIsExporting(false);
    }
  }

  async function handleDelete() {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await removeProject({ projectId: project._id });
      setDeleteOpen(false);
      toast.success("حُذفت اللوحة");
    } catch (error) {
      toast.error(mutationErrorMessage(error, "تعذّر حذف اللوحة"));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Card className="gap-0 py-0 transition-shadow hover:ring-foreground/25">
      <Link
        href={projectHref}
        aria-label={`فتح لوحة ${project.name}`}
        className="relative block aspect-square overflow-hidden bg-muted/50 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {project.thumbnail ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 block [&_svg]:block [&_svg]:size-full"
            dangerouslySetInnerHTML={{ __html: project.thumbnail }}
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            لوحة فارغة
          </span>
        )}
      </Link>

      <CardHeader className="px-4 pt-3 pb-4">
        <CardTitle className="truncate">
          <Link
            href={projectHref}
            className="outline-none hover:underline hover:underline-offset-4 focus-visible:underline"
          >
            {project.name}
          </Link>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span>{formatItemCount(project.itemCount)}</span>
          <span aria-hidden="true" className="text-border">
            •
          </span>
          <span>آخر تعديل {formatUpdatedAt(project.updatedAt, renderedAt)}</span>
        </CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`خيارات لوحة ${project.name}`}
                />
              }
            >
              <EllipsisVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuItem onClick={() => router.push(projectHref)}>
                <FolderOpen className="size-4" />
                فتح
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openRename}>
                <Pencil className="size-4" />
                إعادة تسمية
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isDuplicating}
                onClick={() => void handleDuplicate()}
              >
                <Copy className="size-4" />
                نسخ
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isExporting}
                onClick={() => void handleExport()}
              >
                <FileJson className="size-4" />
                تصدير الملف
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4" />
                حذف
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>

      <Dialog
        open={renameOpen}
        onOpenChange={(nextOpen) => {
          if (!isRenaming) setRenameOpen(nextOpen);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>إعادة تسمية اللوحة</DialogTitle>
            <DialogDescription>
              اختر اسمًا واضحًا يسهّل العثور على اللوحة لاحقًا.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRename} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor={`rename-${project._id}`}>الاسم</Label>
              <Input
                id={`rename-${project._id}`}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                maxLength={MAX_NAME_LENGTH}
                autoComplete="off"
              />
            </div>
            <DialogFooter>
              <DialogClose
                render={
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isRenaming}
                  />
                }
              >
                إلغاء
              </DialogClose>
              <Button type="submit" disabled={isRenaming}>
                {isRenaming ? (
                  <>
                    <Spinner className="size-4" aria-label="جارٍ الحفظ" />
                    جارٍ الحفظ…
                  </>
                ) : (
                  "حفظ"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(nextOpen) => {
          if (!isDeleting) setDeleteOpen(nextOpen);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف لوحة «{project.name}»؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف المشروع وكل عناصره نهائيًا، ولا يمكن التراجع عن هذا
              الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeleting}
              onClick={() => void handleDelete()}
            >
              {isDeleting ? (
                <>
                  <Spinner className="size-4" aria-label="جارٍ الحذف" />
                  جارٍ الحذف…
                </>
              ) : (
                "حذف"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
