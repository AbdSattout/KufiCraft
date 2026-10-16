"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { KufiMotif } from "@/components/dashboard/kufi-motif";

export function EmptyProjects({ onCreate }: { onCreate: () => void }) {
  return (
    <Empty className="border border-dashed border-border bg-card/60 py-14">
      <EmptyMedia>
        <KufiMotif className="size-16 text-primary/30" />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle className="text-base">لا توجد لوحات بعد</EmptyTitle>
        <EmptyDescription>
          ابدأ أول لوحة كوفي مربع: اختر الاسم ونوع الشبكة ونسبة الحبر، ثم ارسم
          على الشبكة وسيُحفظ عملك تلقائيًا.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onCreate}>
          <Plus className="size-4" />
          لوحة جديدة
        </Button>
      </EmptyContent>
    </Empty>
  );
}
