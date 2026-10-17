"use client";

/**
 * KufiCraft — the editor's view of one project document.
 *
 * The server document (`useQuery(api.projects.get)`) stays the source of
 * truth; every completed gesture lands as ONE `applyOps` batch (`toOps`
 * diff) and is shown immediately through a local overlay. An overlay is
 * dropped as soon as the query echo confirms all in-flight writes
 * (`updatedAt` ack comparison), which makes a second tab or device win
 * without fighting the local state.
 *
 * Thumbnails follow the same document but at a slower rhythm: one
 * `updateThumbnail` at least 2 s after the last commit (docs/UI.md §Editor).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DEFAULT_PROJECT_CONFIG } from "@/lib/canvas/model";
import type { CanvasItem, ProjectConfig } from "@/lib/canvas/model";
import { toOps } from "@/lib/canvas/ops";
import { renderThumbnail } from "@/lib/canvas/render";
import { sanitizeProjectConfig } from "@/lib/kuficraft-file";
import { configsEqual, itemsEqual } from "./interaction";
import { errorMessage } from "./messages";

/** Minimum quiet period before the thumbnail is refreshed. */
export const THUMBNAIL_DELAY_MS = 2000;

export type DocumentStatus = "loading" | "missing" | "ready";

export interface EditorDocument {
  status: DocumentStatus;
  name: string;
  config: ProjectConfig;
  items: readonly CanvasItem[];
  /** True while a write is in flight. */
  saving: boolean;
  /** Applies `next` locally and sends the diff as one `applyOps` batch. */
  commitItems: (next: readonly CanvasItem[]) => void;
  rename: (name: string) => void;
  patchConfig: (patch: Partial<ProjectConfig>) => void;
  /**
   * Local, mutation-free config update for live slider feedback; the value
   * reaches the server through `patchConfig` when the gesture ends.
   */
  previewConfig: (patch: Partial<ProjectConfig>) => void;
}

export function useEditorDocument(
  projectId: Id<"projects"> | null,
  enabled: boolean,
): EditorDocument {
  const args = useMemo(
    () => (enabled && projectId ? { projectId } : ("skip" as const)),
    [enabled, projectId],
  );
  const doc = useQuery(api.projects.get, args);
  const applyOps = useMutation(api.projects.applyOps);
  const renameProject = useMutation(api.projects.rename);
  const updateConfig = useMutation(api.projects.updateConfig);
  const updateThumbnail = useMutation(api.projects.updateThumbnail);

  const [items, setItems] = useState<readonly CanvasItem[] | null>(null);
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  /** Items of the newest query result — the fallback when a write fails. */
  const serverItems = useRef<readonly CanvasItem[] | null>(null);
  /** Highest `updatedAt` acked by our own `applyOps` calls. */
  const ackUpdatedAt = useRef(0);
  const pendingRef = useRef(0);
  const itemsRef = useRef<readonly CanvasItem[] | null>(null);
  const configRef = useRef<ProjectConfig | null>(null);
  const docRef = useRef(doc);

  // Write-only caches for the callbacks below; synced after each commit.
  useEffect(() => {
    itemsRef.current = items;
    configRef.current = config;
  }, [config, items]);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    if (!doc) return;
    serverItems.current = doc.items;
    // A write is still in flight, or the echo is older than our last ack:
    // keep the optimistic overlay until the server caught up.
    if (pendingRef.current > 0 || doc.updatedAt < ackUpdatedAt.current) return;
    // A deployment can be older than the client: normalise here so the editor
    // only ever holds a complete `ProjectConfig`.
    const nextConfig = sanitizeProjectConfig(doc.config);
    setItems((prev) =>
      prev !== null && itemsEqual(prev, doc.items) ? prev : doc.items,
    );
    setConfig((prev) =>
      prev !== null && configsEqual(prev, nextConfig) ? prev : nextConfig,
    );
    setName((prev) => (prev === doc.name ? prev : doc.name));
  }, [doc, pending]);

  const commitItems = useCallback(
    (next: readonly CanvasItem[]) => {
      const current = itemsRef.current;
      if (!projectId || current === null) return;
      const ops = toOps(current, next);
      if (ops.length === 0) return;
      setItems(next);
      pendingRef.current += 1;
      setPending(pendingRef.current);
      applyOps({ projectId, ops })
        .then((result) => {
          ackUpdatedAt.current = Math.max(ackUpdatedAt.current, result.updatedAt);
        })
        .catch((error: unknown) => {
          toast.error(errorMessage(error));
          // Drop the rejected overlay: the server still has the old items.
          if (serverItems.current !== null) setItems(serverItems.current);
        })
        .finally(() => {
          pendingRef.current -= 1;
          setPending(pendingRef.current);
        });
    },
    [applyOps, projectId],
  );

  const rename = useCallback(
    (next: string) => {
      if (!projectId) return;
      setName(next);
      pendingRef.current += 1;
      setPending(pendingRef.current);
      renameProject({ projectId, name: next })
        .catch((error: unknown) => toast.error(errorMessage(error)))
        .finally(() => {
          pendingRef.current -= 1;
          setPending(pendingRef.current);
        });
    },
    [projectId, renameProject],
  );

  const patchConfig = useCallback(
    (patch: Partial<ProjectConfig>) => {
      if (!projectId) return;
      const current = configRef.current;
      if (current === null) return;
      setConfig({ ...current, ...patch });
      pendingRef.current += 1;
      setPending(pendingRef.current);
      updateConfig({ projectId, patch })
        .catch((error: unknown) => {
          toast.error(errorMessage(error));
          const latest = docRef.current;
          if (latest) setConfig(sanitizeProjectConfig(latest.config));
        })
        .finally(() => {
          pendingRef.current -= 1;
          setPending(pendingRef.current);
        });
    },
    [projectId, updateConfig],
  );

  const previewConfig = useCallback((patch: Partial<ProjectConfig>) => {
    setConfig((previous) => (previous === null ? previous : { ...previous, ...patch }));
  }, []);

  /* -------------------------------------------------------------- */
  /* Thumbnail: one write, at least 2 s after the last commit        */
  /* -------------------------------------------------------------- */

  const thumbnailTimer = useRef<number | null>(null);
  const lastThumbnail = useRef<string | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (!doc) return;
    if (!seeded.current) {
      // The dashboard already shows this thumbnail; do not rewrite it.
      lastThumbnail.current = doc.thumbnail;
      seeded.current = true;
    }
  }, [doc]);

  useEffect(() => {
    if (!projectId || items === null || config === null) return;
    if (thumbnailTimer.current !== null) {
      window.clearTimeout(thumbnailTimer.current);
    }
    thumbnailTimer.current = window.setTimeout(() => {
      thumbnailTimer.current = null;
      const svg = renderThumbnail(config, items);
      if (svg === lastThumbnail.current) return;
      lastThumbnail.current = svg;
      updateThumbnail({ projectId, thumbnail: svg }).catch((error: unknown) => {
        lastThumbnail.current = null;
        toast.error(errorMessage(error));
      });
    }, THUMBNAIL_DELAY_MS);
    return () => {
      if (thumbnailTimer.current !== null) {
        window.clearTimeout(thumbnailTimer.current);
        thumbnailTimer.current = null;
      }
    };
  }, [config, items, projectId, updateThumbnail]);

  const status: DocumentStatus = !enabled
    ? "loading"
    : doc === undefined
      ? "loading"
      : doc === null
        ? "missing"
        : "ready";

  return {
    status,
    name: name ?? "",
    config: config ?? DEFAULT_PROJECT_CONFIG,
    items: items ?? EMPTY_ITEMS,
    saving: pending > 0,
    commitItems,
    rename,
    patchConfig,
    previewConfig,
  };
}

const EMPTY_ITEMS: readonly CanvasItem[] = [];
