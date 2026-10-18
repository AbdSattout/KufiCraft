"use client";

import { useRequireAuth } from "@/components/auth/require-auth";
import { SessionUnavailable } from "@/components/auth/session-unavailable";
import { SiteHeader } from "@/components/site-header";
import { ProjectsView } from "@/components/dashboard/projects-view";
import { DashboardSkeleton } from "@/components/dashboard/skeletons";

/**
 * The boards dashboard — the **home** route (`src/app/page.tsx`), which is also
 * where a signed-in visitor lands from the landing. The guard below only covers
 * a session that expired while the page was open; `src/proxy.ts` has already
 * sent anonymous visitors to the landing.
 */
export function BoardsScreen() {
  const gate = useRequireAuth();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
        {gate.reconnecting ? (
          <SessionUnavailable className="mt-10" onRetry={gate.retry} />
        ) : gate.ready ? (
          <ProjectsView />
        ) : (
          <DashboardSkeleton />
        )}
      </main>
    </div>
  );
}
