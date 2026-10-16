"use client";

import { useRef, useState, type DragEvent } from "react";
import { useQuery } from "convex/react";
import { FileUp, Plus } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { EmptyProjects } from "@/components/dashboard/empty-projects";
import { NewProjectDialog } from "@/components/dashboard/new-project-dialog";
import { ProjectCard } from "@/components/dashboard/project-card";
import { DashboardSkeleton } from "@/components/dashboard/skeletons";
import { PROJECTS_GRID_CLASSES } from "@/components/dashboard/grid";
import { useImportProjectFile } from "@/components/dashboard/project-files";

/** Whether a drag carries files (so page drops don't hijack text selections). */
function hasFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** Dashboard body: live list of the signed-in user's projects. */
export function ProjectsView() {
  const projects = useQuery(api.projects.list);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDropActive, setIsDropActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importFile = useImportProjectFile();

  function importSelected(file: File | undefined) {
    if (file) void importFile(file);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setIsDropActive(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setIsDropActive(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setIsDropActive(false);
    importSelected(event.dataTransfer.files?.[0]);
  }

  if (projects === undefined) {
    return <DashboardSkeleton />;
  }

  return (
    <div
      className="relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-medium tracking-tight">
            لوحاتي
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            كل التغييرات تُحفظ تلقائيًا وتظهر على جميع أجهزتك.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp className="size-4" />
            استيراد ملف
          </Button>
          {projects.length > 0 && (
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="size-4" />
              لوحة جديدة
            </Button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".kuficraft,application/json"
        aria-label="استيراد ملف KufiCraft"
        className="sr-only"
        onChange={(event) => {
          importSelected(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {projects.length === 0 ? (
        <EmptyProjects onCreate={() => setIsCreateOpen(true)} />
      ) : (
        <div className={PROJECTS_GRID_CLASSES}>
          {projects.map((project) => (
            <ProjectCard key={project._id} project={project} />
          ))}
        </div>
      )}

      {isDropActive ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl border-2 border-dashed border-primary/60 bg-background/80">
          <p className="font-heading text-sm text-primary">
            أفلت الملف لإنشاء لوحة جديدة
          </p>
        </div>
      ) : null}

      <NewProjectDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </div>
  );
}
