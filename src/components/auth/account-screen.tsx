"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AccountSecurity } from "@/components/auth/account-security";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * `/account`: the "الحساب والأمان" screen — passkeys and sign-out — for a
 * visitor with a live session. `/signin` no longer doubles as this screen, and
 * `src/proxy.ts` has already sent anonymous visitors to `/signin`; the client
 * check below only covers a session that expired while the page was open.
 */
export function AccountScreen() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session?.user) router.replace("/signin");
  }, [isPending, session?.user, router]);

  if (isPending || !session?.user) return <AccountSkeleton />;

  return (
    <AccountSecurity userName={session.user.name?.trim() || "مستخدم"} />
  );
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
