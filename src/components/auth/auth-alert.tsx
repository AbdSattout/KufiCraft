"use client";

import { CircleAlert, Info } from "lucide-react";
import { cn } from "cn";

/**
 * Inline feedback for the auth screens. Kept local to the auth components
 * because the vendored `ui/` set has no `alert` primitive; styling uses the
 * shared destructive/muted tokens either way.
 */
export function AuthAlert({
  variant = "error",
  children,
  className,
}: {
  variant?: "error" | "info";
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = variant === "error" ? CircleAlert : Info;
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      data-slot="auth-alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm leading-snug",
        variant === "error"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-border bg-muted/50 text-muted-foreground",
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1">{children}</div>
    </div>
  );
}
