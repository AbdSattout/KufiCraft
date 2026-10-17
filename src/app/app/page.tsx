"use client";

import { SiteHeader } from "@/components/site-header";
import { ProjectsView } from "@/components/dashboard/projects-view";
import { DashboardSkeleton } from "@/components/dashboard/skeletons";
import { useRequireAuth } from "@/components/auth/require-auth";

/** `/app` — the boards dashboard. `/` rewrites here for a signed-in visitor
 * (see `src/proxy.ts`), so this is also "the home page" once you are in. The
 * client guard below only covers a session that expired while the page was
 * open (it clears the stale cookie and returns to the sign-in dialog). */
export default function DashboardPage() {
  const { isAuthenticated } = useRequireAuth();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
        {isAuthenticated ? <ProjectsView /> : <DashboardSkeleton />}
      </main>
    </div>
  );
}
