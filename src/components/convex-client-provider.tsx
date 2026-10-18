"use client";

import { useMemo } from "react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { createConvexAuthHook } from "@/lib/convex-auth";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({
  children,
  initialToken,
}: {
  children: React.ReactNode;
  initialToken?: string | null;
}) {
  const useAuth = useMemo(() => createConvexAuthHook(initialToken), [initialToken]);

  return (
    <ConvexProviderWithAuth client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}
