"use client";

import { authClient } from "@/lib/auth-client";
import { AccountSecurity } from "@/components/auth/account-security";
import { useRequireAuth } from "@/components/auth/require-auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * `/account`: the "الحساب والأمان" screen — the account's name (its passkey's)
 * and sign-out — for a visitor with a live session. `src/proxy.ts` has already
 * sent anonymous visitors home; the client guard below only covers a session
 * that expired while the page was open.
 */
export function AccountScreen() {
  const { isAuthenticated } = useRequireAuth();
  // The passkey list comes from the better-auth session, which the provider
  // above loads from the same cookie; wait for it before asking for the key.
  const { data: session, isPending } = authClient.useSession();

  if (!isAuthenticated || isPending || !session?.user) {
    return <AccountSkeleton />;
  }

  return <AccountSecurity />;
}

function AccountSkeleton() {
  return (
    <Card aria-busy>
      <CardHeader>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-8 w-32" />
      </CardContent>
    </Card>
  );
}
