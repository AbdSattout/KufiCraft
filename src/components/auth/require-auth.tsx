"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";

/**
 * Client-side guard for authenticated screens: redirects to `/signin` once
 * Convex reports an anonymous visitor. The dashboard/editor currently keep
 * their own inline version — import this when consolidating.
 */
export function useRequireAuth(redirectTo = "/signin") {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace(redirectTo);
    }
  }, [isLoading, isAuthenticated, router, redirectTo]);

  return { isLoading, isAuthenticated };
}

/** Renders `children` only for authenticated visitors; `fallback` otherwise. */
export function RequireAuth({
  children,
  fallback = null,
  redirectTo = "/signin",
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  redirectTo?: string;
}) {
  const { isLoading, isAuthenticated } = useRequireAuth(redirectTo);
  if (isLoading || !isAuthenticated) return <>{fallback}</>;
  return <>{children}</>;
}
