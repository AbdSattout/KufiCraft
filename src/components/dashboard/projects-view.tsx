"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { EmptyProjects } from "@/components/dashboard/empty-projects";
import { NewProjectDialog } from "@/components/dashboard/new-project-dialog";
import { ProjectCard } from "@/components/dashboard/project-card";
import { DashboardSkeleton } from "@/components/dashboard/skeletons";
import { PROJECTS_GRID_CLASSES } from "@/components/dashboard/grid";

/** Dashboard body: live list of the signed-in user's projects. */
export function ProjectsView() {
  const projects = useQuery(api.projects.list);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  if (projects === undefined) {
    return <DashboardSkeleton />;
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-medium tracking-tight">
            لوحاتي
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            كل التغييرات تُحفظ تلقائيًا وتظهر على جميع أجهزتك.
          </p>
        </div>
        {projects.length > 0 && (
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="size-4" />
            لوحة جديدة
          </Button>
        )}
      </div>

      {projects.length === 0 ? (
        <EmptyProjects onCreate={() => setIsCreateOpen(true)} />
      ) : (
        <div className={PROJECTS_GRID_CLASSES}>
          {projects.map((project) => (
            <ProjectCard key={project._id} project={project} />
          ))}
        </div>
      )}

      <NewProjectDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </>
  );
}
