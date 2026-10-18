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
 * A write the server *rejects* while the client is between tokens is the one
 * case that needs care (docs/AUTH.md § Transient failures). Convex's client
 * replays mutations that were never acknowledged, but a rejected one is gone:
 * the change would be dropped from the screen and would never reach the
 * server. So a transient rejection *holds* the change — it stays in the
 * overlay and in the queue, the indicator keeps saying it is not saved — and
 * the document is offered again as one `replace` once Convex holds a token.
 * That retry is deliberately document-shaped and order-safe: a replayed
 * *diff* can be stale by the time auth comes back, a `replace` converged with
 * whatever the server had.
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
import {
  isTransientSaveError,
  RESYNC_RETRY_MS,
  SAVE_TICK_MS,
  saveStateOf,
  type SaveState,
} from "@/lib/save-state";
import { configsEqual, itemsEqual } from "./interaction";
import { errorMessage } from "./messages";

/** Minimum quiet period before the thumbnail is refreshed. */
export const THUMBNAIL_DELAY_MS = 2000;

export type DocumentStatus = "loading" | "missing" | "ready";

export interface EditorDocument {
  status: DocumentStatus;
  /** This project's document has been read at least once. */
  loaded: boolean;
  name: string;
  config: ProjectConfig;
  items: readonly CanvasItem[];
  /** The top bar's single save/connection indicator. */
  save: SaveState;
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

/** Writes the server has not acknowledged: in flight, or held after a rejection. */
interface WriteQueue {
  inFlight: number;
  held: number;
  /** When the oldest pending write was made, or null when nothing is pending. */
  since: number | null;
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
  const [queue, setQueue] = useState<WriteQueue>({
    inFlight: 0,
    held: 0,
    since: null,
  });
  const [loadedFor, setLoadedFor] = useState<Id<"projects"> | null>(null);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  /** Items of the newest query result — the fallback when a write fails. */
  const serverItems = useRef<readonly CanvasItem[] | null>(null);
  /** Highest `updatedAt` acked by our own `applyOps` calls. */
  const ackUpdatedAt = useRef(0);
  /** The queue as the callbacks see it, without waiting for a render. */
  const queueRef = useRef<WriteQueue>(queue);
  const itemsRef = useRef<readonly CanvasItem[] | null>(null);
  const configRef = useRef<ProjectConfig | null>(null);
  const nameRef = useRef<string | null>(null);
  const docRef = useRef(doc);
  /** The board `loadedFor` already names; a ref so it is announced once. */
  const loadedForRef = useRef<Id<"projects"> | null>(null);
  /** Whether the indicator's clock is already running below. */
  const tickingRef = useRef(false);

  // Write-only caches for the callbacks below; synced after each commit.
  useEffect(() => {
    itemsRef.current = items;
    configRef.current = config;
    nameRef.current = name;
  }, [config, items, name]);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  const publishQueue = useCallback(() => {
    const current = queueRef.current;
    if (current.inFlight + current.held === 0) current.since = null;
    setQueue({ ...current });
  }, []);

  const beginWrite = useCallback(() => {
    const current = queueRef.current;
    if (current.inFlight + current.held === 0) current.since = Date.now();
    current.inFlight += 1;
    publishQueue();
  }, [publishQueue]);

  /** Ends one write: `held` keeps it (and the overlay) for the resync. */
  const endWrite = useCallback(
    (outcome: "acked" | "rejected" | "held") => {
      const current = queueRef.current;
      current.inFlight = Math.max(0, current.inFlight - 1);
      if (outcome === "held") current.held += 1;
      publishQueue();
    },
    [publishQueue],
  );

  const releaseHeld = useCallback(() => {
    queueRef.current.held = 0;
    publishQueue();
  }, [publishQueue]);

  /**
   * One place for a write's failure, so all three writers agree: a transient
   * rejection is held quietly, anything else is the server's verdict and is
   * surfaced the way it always was.
   */
  const failWrite = useCallback(
    (error: unknown, revert?: () => void) => {
      if (isTransientSaveError(error)) {
        endWrite("held");
        return;
      }
      toast.error(errorMessage(error));
      revert?.();
      endWrite("rejected");
    },
    [endWrite],
  );

  useEffect(() => {
    if (!doc) return;
    serverItems.current = doc.items;
    // Announced once per board — the ref makes that a decision the effect can
    // take without asking React again.
    if (projectId !== null && loadedForRef.current !== projectId) {
      loadedForRef.current = projectId;
      setLoadedFor(projectId);
    }
    // A write is still in flight, or the echo is older than our last ack:
    // keep the optimistic overlay until the server caught up.
    if (queueRef.current.inFlight + queueRef.current.held > 0) return;
    if (doc.updatedAt < ackUpdatedAt.current) return;
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
  }, [doc, projectId, queue]);

  const commitItems = useCallback(
    (next: readonly CanvasItem[]) => {
      const current = itemsRef.current;
      if (!projectId || current === null) return;
      const ops = toOps(current, next);
      if (ops.length === 0) return;
      setItems(next);
      beginWrite();
      applyOps({ projectId, ops })
        .then((result) => {
          ackUpdatedAt.current = Math.max(ackUpdatedAt.current, result.updatedAt);
          endWrite("acked");
        })
        .catch((error: unknown) => {
          failWrite(error, () => {
            // Drop the rejected overlay: the server still has the old items.
            if (serverItems.current !== null) setItems(serverItems.current);
          });
        });
    },
    [applyOps, beginWrite, endWrite, failWrite, projectId],
  );

  const rename = useCallback(
    (next: string) => {
      if (!projectId) return;
      setName(next);
      beginWrite();
      renameProject({ projectId, name: next })
        .then(() => endWrite("acked"))
        .catch((error: unknown) => {
          // The echo restores the server's name; nothing to revert here.
          failWrite(error);
        });
    },
    [beginWrite, endWrite, failWrite, projectId, renameProject],
  );

  const patchConfig = useCallback(
    (patch: Partial<ProjectConfig>) => {
      if (!projectId) return;
      const current = configRef.current;
      if (current === null) return;
      setConfig({ ...current, ...patch });
      beginWrite();
      updateConfig({ projectId, patch })
        .then(() => endWrite("acked"))
        .catch((error: unknown) => {
          failWrite(error, () => {
            const latest = docRef.current;
            if (latest) setConfig(sanitizeProjectConfig(latest.config));
          });
        });
    },
    [beginWrite, endWrite, failWrite, projectId, updateConfig],
  );

  const previewConfig = useCallback((patch: Partial<ProjectConfig>) => {
    setConfig((previous) => (previous === null ? previous : { ...previous, ...patch }));
  }, []);

  /* -------------------------------------------------------------- */
  /* Held writes: sent again as one document-shaped `replace`        */
  /* -------------------------------------------------------------- */

  const lastResync = useRef(0);

  const resync = useCallback(() => {
    const target = projectId;
    const server = docRef.current;
    const currentItems = itemsRef.current;
    const currentConfig = configRef.current;
    const currentName = nameRef.current;
    if (!target || !server || currentItems === null) return;

    const writes: Array<Promise<unknown>> = [];
    if (!itemsEqual(currentItems, server.items)) {
      writes.push(
        applyOps({
          projectId: target,
          ops: [{ type: "replace", items: [...currentItems] }],
        }),
      );
    }
    if (
      currentConfig !== null &&
      !configsEqual(currentConfig, sanitizeProjectConfig(server.config))
    ) {
      writes.push(updateConfig({ projectId: target, patch: currentConfig }));
    }
    if (currentName !== null && currentName !== server.name) {
      writes.push(renameProject({ projectId: target, name: currentName }));
    }
    if (writes.length === 0) {
      // The echo already carries everything: nothing to hold on to.
      releaseHeld();
      return;
    }
    Promise.all(writes)
      .then(() => {
        releaseHeld();
      })
      .catch((error: unknown) => {
        // Still down: stay held, the tick below will offer it again. A real
        // verdict (the item cap, a deleted board) falls back to the server.
        if (isTransientSaveError(error)) return;
        toast.error(errorMessage(error));
        setItems(server.items);
        setConfig(sanitizeProjectConfig(server.config));
        setName(server.name);
        releaseHeld();
      });
  }, [applyOps, projectId, releaseHeld, renameProject, updateConfig]);

  useEffect(() => {
    if (!enabled || projectId === null || queue.held === 0) return;
    if (now - lastResync.current < RESYNC_RETRY_MS) return;
    lastResync.current = now;
    resync();
  }, [doc, enabled, now, projectId, queue.held, resync]);

  /* -------------------------------------------------------------- */
  /* The indicator's clock and its offline hint                      */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    const pending = queue.inFlight + queue.held > 0;
    // Ref-guarded so a re-run while something is still pending neither restarts
    // the clock nor costs a render.
    if (pending === tickingRef.current) return;
    tickingRef.current = pending;
    setNow(Date.now());
    if (!pending) return;
    const timer = window.setInterval(() => setNow(Date.now()), SAVE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [queue.inFlight, queue.held]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const save = saveStateOf({
    pending: queue.inFlight + queue.held,
    since: queue.since,
    held: queue.held,
    online,
    now,
  });

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
        // A thumbnail is a nicety: no toast, and the next commit retries it.
        if (isTransientSaveError(error)) return;
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

  /**
   * Reading, not writing: a document that was read once keeps its screen while
   * the gate is closed. That is the “keep the current screen” rule — a hiccup
   * must not throw the board away and show a spinner, and the indicator carries
   * the state instead.
   */
  const loaded = projectId !== null && loadedFor === projectId;

  const status: DocumentStatus = (() => {
    // The server said the board is gone, whatever we had locally.
    if (doc === null) return "missing";
    // No answer (yet): hold the screen when there is a document on it — a
    // hiccup must not throw the canvas away for a spinner.
    if (doc === undefined) return loaded ? "ready" : "loading";
    return "ready";
  })();

  return {
    status,
    loaded,
    name: name ?? "",
    config: config ?? DEFAULT_PROJECT_CONFIG,
    items: items ?? EMPTY_ITEMS,
    save,
    commitItems,
    rename,
    patchConfig,
    previewConfig,
  };
}

const EMPTY_ITEMS: readonly CanvasItem[] = [];
