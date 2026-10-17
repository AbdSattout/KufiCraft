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
 * Stand-in for a session screen when the session request itself failed (a
 * timeout, DNS, a 500 from the auth proxy). The screen cannot tell whether the
 * visitor is signed in, so it says exactly that and offers to ask again — the
 * one honest thing to do while the network is the problem.
 */
export function SessionUnavailable({
  onRetry,
  className,
}: {
  onRetry: () => void;
  className?: string;
}) {
  return (
    <Empty className={cn("mx-auto max-w-md", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CloudOff />
        </EmptyMedia>
        <EmptyTitle>تعذّر الاتصال بالخادم</EmptyTitle>
        <EmptyDescription>
          لم يصل ردّ من الخادم. تحقّق من اتصالك بالإنترنت ثم أعد المحاولة.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={onRetry}>
          <RotateCw />
          أعد المحاولة
        </Button>
      </EmptyContent>
    </Empty>
  );
}
