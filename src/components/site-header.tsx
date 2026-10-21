"use client";

import Link from "next/link";
import { useConvexAuth } from "convex/react";
import { KeyRound, LogOut, User } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { SignInButton } from "@/components/auth/sign-in-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Shared shell header: the wordmark and the account menu. There is no board
 * link: the boards are the home route (`/`), so the wordmark already goes
 * there. Signed-out visitors get a single `تسجيل الدخول` button, which opens
 * the sign-in dialog (`src/components/auth/sign-in-dialog.tsx`).
 *
 * Note: UI primitives are Base UI based — compose with `render={<Link … />}`
 * rather than Radix's `asChild`.
 */
export function SiteHeader() {
  const { isAuthenticated, isLoading } = useConvexAuth();

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
            <AccountMenu />
          ) : (
            <SignInButton variant="outline" size="sm">
              تسجيل الدخول
            </SignInButton>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * The account's name **is** its passkey's name — there is no separate profile
 * name (docs/AUTH.md § Accounts) — so this reads the passkey list and falls back
 * to `حسابي` while it loads. Mounted only for a signed-in visitor so an
 * anonymous page never asks for a passkey list it cannot have.
 */
function AccountMenu() {
  const { data: passkeys } = authClient.useListPasskeys();
  const accountName = passkeys?.[0]?.name?.trim() || "حسابي";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2">
            <User className="size-4" />
            <span className="max-w-32 truncate" dir="auto">
              {accountName}
            </span>
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-52">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
