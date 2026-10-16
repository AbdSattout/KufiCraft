"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { SiteHeader } from "@/components/site-header";
import { ProjectsView } from "@/components/dashboard/projects-view";
import { DashboardSkeleton } from "@/components/dashboard/skeletons";

/** `/app` — dashboard guarded on the client; sign-in page is `/signin`. */
export default function DashboardPage() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/signin");
    }
  }, [isLoading, isAuthenticated, router]);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
        {isAuthenticated ? <ProjectsView /> : <DashboardSkeleton />}
      </main>
    </div>
  );
}
