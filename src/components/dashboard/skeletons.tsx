import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PROJECTS_GRID_CLASSES } from "@/components/dashboard/grid";

function ProjectCardSkeleton() {
  return (
    <Card className="gap-0 py-0">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="grid gap-2 px-4 pt-3 pb-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </Card>
  );
}

export function ProjectsGridSkeleton() {
  return (
    <div className={PROJECTS_GRID_CLASSES} aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <ProjectCardSkeleton key={index} />
      ))}
    </div>
  );
}

/** Page-level loading placeholders: title row + card grid. */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-label="جارٍ تحميل اللوحات…">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      <ProjectsGridSkeleton />
    </div>
  );
}
