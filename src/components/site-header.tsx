"use client";

import Link from "next/link";
import { useQuery, useConvexAuth } from "convex/react";
import { KeyRound, LogOut, User } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Shared shell header: the wordmark and the account menu. There is no board
 * link: the boards are the home route (`/`), so the wordmark already goes
 * there. Signed-out visitors get a single `تسجيل الدخول` button — sign-in and
 * sign-up live on the same screen (`/signin`).
 *
 * Note: UI primitives are Base UI based — compose with `render={<Link … />}`
 * rather than Radix's `asChild`. `DropdownMenuLabel` is a Base UI
 * `Menu.GroupLabel`, so it must stay inside a `DropdownMenuGroup`.
 */
export function SiteHeader() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const user = useQuery(api.auth.getCurrentUser);

  return (
    <header className="border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2">
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-sm bg-primary text-primary-foreground"
          >
            <span className="font-heading text-sm leading-none">ك</span>
          </span>
          <span className="font-heading text-lg tracking-tight">KufiCraft</span>
        </Link>

        <div className="ms-auto flex items-center gap-2">
          {isLoading ? (
            <span className="h-8 w-24 animate-pulse rounded-md bg-muted" />
          ) : isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" className="gap-2">
                    <User className="size-4" />
                    <span className="max-w-32 truncate">
                      {user?.name ?? "حسابي"}
                    </span>
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="truncate">
                    {user?.name ?? "حسابي"}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem render={<Link href="/account" />}>
                    <KeyRound className="size-4" />
                    الحساب والأمان
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      void authClient.signOut();
                    }}
                  >
                    <LogOut className="size-4" />
                    تسجيل الخروج
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/signin" />}
            >
              تسجيل الدخول
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
