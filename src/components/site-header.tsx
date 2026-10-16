"use client";

import Link from "next/link";
import { useQuery, useConvexAuth } from "convex/react";
import { LogOut, User } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Shared shell header: wordmark, primary navigation and the account menu.
 * Signed-out visitors see sign-in / sign-up calls to action instead.
 *
 * Note: UI primitives are Base UI based — compose with `render={<Link … />}`
 * rather than Radix's `asChild`.
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

        <nav className="flex items-center gap-1 text-sm">
          <Button variant="ghost" size="sm" render={<Link href="/app" />}>
            لوحاتي
          </Button>
        </nav>

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
                <DropdownMenuLabel className="truncate">
                  {user?.name ?? "حسابي"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    void authClient.signOut();
                  }}
                >
                  <LogOut className="size-4" />
                  تسجيل الخروج
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                render={<Link href="/signin" />}
              >
                تسجيل الدخول
              </Button>
              <Button size="sm" render={<Link href="/signup" />}>
                إنشاء حساب
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
