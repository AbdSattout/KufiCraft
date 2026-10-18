"use client";

import { CloudOff, RotateCw } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * Stand-in for a session screen while a session answer is not arriving — a
 * timeout, DNS, a 500 from the auth proxy.
 *
 * This deliberately does *not* read as an error, and it does not replace the
 * screen for the first couple of failures: the gate retries by itself and only
 * falls back to this once those attempts are spent (`src/lib/session-gate.ts`,
 * docs/AUTH.md § Transient failures). Nothing is broken and there is nothing to
 * fix — a request is being asked again, and the visitor should be told that,
 * quietly, while the rest of the screen stays exactly where it was.
 */
export function SessionUnavailable({
  onRetry,
  className,
}: {
  onRetry: () => void;
  className?: string;
}) {
  return (
    <Empty className={cn("mx-auto max-w-md", className)} role="status">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CloudOff />
        </EmptyMedia>
        <EmptyTitle>جارٍ إعادة الاتصال…</EmptyTitle>
        <EmptyDescription>
          لم يصل ردّ من الخادم بعد. سنعيد المحاولة تلقائيًا، ويمكنك المتابعة من
          حيث توقّفت.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="ghost" onClick={onRetry}>
          <RotateCw />
          أعد المحاولة الآن
        </Button>
      </EmptyContent>
    </Empty>
  );
}
