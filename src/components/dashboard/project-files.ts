"use client";

/**
 * KufiCraft — dashboard wiring for `.kuficraft` files (docs/FORMAT.md).
 *
 * Export fetches the *full* document first (the card list only carries
 * summaries, so the items must never be missing); import always creates a new
 * project — nothing in the dashboard is ever overwritten.
 */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useConvex, useMutation } from "convex/react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  downloadProjectFile,
  readProjectFile,
  sanitizeProjectConfig,
} from "@/lib/kuficraft-file";

const EXPORT_ERROR = "تعذّر تصدير الملف";
const IMPORT_ERROR = "تعذّر استيراد الملف";

/** Arabic message of a thrown value: ConvexError → data, Error → message. */
function fileErrorMessage(error: unknown, fallback: string): string {
  if (
    error instanceof ConvexError &&
    typeof error.data === "string" &&
    error.data.length > 0
  ) {
    return error.data;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return fallback;
}

/** Full-document export used by each card's «تصدير الملف» action. */
export function useExportProjectFile(): (
  projectId: Id<"projects">,
  fallbackName: string,
) => Promise<void> {
  const convex = useConvex();
  return useCallback(
    async (projectId: Id<"projects">, fallbackName: string) => {
      const doc = await convex.query(api.projects.get, { projectId });
      if (!doc) throw new Error(EXPORT_ERROR);
      downloadProjectFile({
        name: doc.name || fallbackName,
        // Normalised here too: a document written before a config field existed
        // (or by an older deployment) still exports a complete config.
        config: sanitizeProjectConfig(doc.config),
        items: doc.items,
      });
    },
    [convex],
  );
}

/** Import a picked / dropped file into a brand-new project. */
export function useImportProjectFile(): (file: File) => Promise<void> {
  const createProject = useMutation(api.projects.create);
  const applyOps = useMutation(api.projects.applyOps);
  const router = useRouter();

  return useCallback(
    async (file: File) => {
      try {
        const parsed = await readProjectFile(file);
        if (parsed.droppedItems > 0) {
          toast.warning(
            `تم تجاهل ${parsed.droppedItems} عنصرًا لتجاوز الحد الأقصى`,
          );
        }
        const projectId = await createProject({
          name: parsed.name,
          config: parsed.config,
        });
        // The project is created empty, then filled with ONE add batch.
        if (parsed.items.length > 0) {
          await applyOps({
            projectId,
            ops: [{ type: "add", items: parsed.items }],
          });
        }
        router.push(`/${projectId}`);
      } catch (error) {
        toast.error(fileErrorMessage(error, IMPORT_ERROR));
      }
    },
    [applyOps, createProject, router],
  );
}
