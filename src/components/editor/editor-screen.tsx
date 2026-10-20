"use client";

/**
 * KufiCraft — editor screen (`/<projectId>`).
 *
 * Owns the whole page: the signed-out redirect, the invalid / loading /
 * missing states, and the editor layout itself — top bar, tool rail (RTL:
 * vertical on the primary edge, horizontal above nothing on mobile), canvas
 * and the settings column, which collapses into a bottom sheet on phones
 * (docs/UI.md §Editor, quality bar).
 *
 * The Convex document never crosses this file: everything comes from the
 * controller in `use-editor.ts`, and selection keys are resolved to items
 * once, here, so the memoised canvas layers receive stable arrays.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRequireAuth } from "@/components/auth/require-auth";
import { SessionUnavailable } from "@/components/auth/session-unavailable";
import { Separator } from "@/components/ui/separator";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { CanvasItem } from "@/lib/canvas/model";
import { visibleItems } from "@/lib/canvas/items";
import { MESSAGES } from "./messages";
import { useEditor } from "./use-editor";
import type { EditorController } from "./use-editor";
import { CanvasStage } from "./canvas-stage";
import { EditorTopBar } from "./editor-top-bar";
import { ToolRail } from "./editor-tool-rail";
import { ShapePanel } from "./editor-shape-panel";
import { SettingsPanel } from "./editor-settings-panel";

const EMPTY_ITEMS: readonly CanvasItem[] = [];
const RAIL_PLACEHOLDERS = [0, 1, 2, 3, 4, 5];
const PANEL_PLACEHOLDERS = [0, 1, 2];

/** Resolves selection keys to items, keeping the empty case referentially stable. */
function resolveItems(
  byKey: ReadonlyMap<string, CanvasItem>,
  keys: readonly string[],
): readonly CanvasItem[] {
  if (keys.length === 0) return EMPTY_ITEMS;
  const resolved: CanvasItem[] = [];
  for (const key of keys) {
    const item = byKey.get(key);
    if (item) resolved.push(item);
  }
  return resolved;
}

/** Both panels, shared by the desktop column and the mobile sheet. */
function Panels({ editor }: { editor: EditorController }) {
  return (
    <>
      {/* What you draw with, then the board it is drawn on. */}
      <ShapePanel
        style={editor.panelStyle}
        inkColor={editor.config.ink}
        inkSwatches={editor.inkSwatches}
        selectionCount={editor.selection.length}
        selectShape={editor.selectShape}
        rotateShape={editor.rotateShape}
        setRounding={editor.setRounding}
        previewRounding={editor.previewRounding}
        setBorder={editor.setBorder}
        previewBorderWidth={editor.previewBorderWidth}
        setStrokeCap={editor.setStrokeCap}
        setStrokeJoin={editor.setStrokeJoin}
        recolourSelection={editor.recolourSelection}
        duplicateSelection={editor.duplicateSelection}
        deleteSelection={editor.deleteSelection}
        arrange={editor.arrange}
        canArrange={editor.canArrange}
      />
      <Separator />
      <SettingsPanel
        config={editor.config}
        inkSwatches={editor.inkSwatches}
        itemsCount={editor.items.length}
        fillColor={editor.fillColor}
        selectionCount={editor.selection.length}
        setFillColor={editor.setFillColor}
        setShowGrid={editor.setShowGrid}
        patchConfig={editor.patchConfig}
        previewConfig={editor.previewConfig}
        clearAll={editor.clearAll}
      />
    </>
  );
}

/** Skeleton shell: also the route's Suspense fallback (`useParams` suspends). */
export function EditorLoading() {
  return (
    <div
      className="fixed inset-x-0 top-0 flex h-dvh flex-col overflow-hidden bg-background"
      aria-busy="true"
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-2 sm:px-3">
        <Skeleton className="size-7 rounded-lg" />
        <Skeleton className="h-7 w-40" />
        <div className="ms-auto flex items-center gap-1">
          <Skeleton className="size-7 rounded-lg" />
          <Skeleton className="size-7 rounded-lg" />
          <Skeleton className="size-7 rounded-lg" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="hidden w-16 shrink-0 flex-col gap-1.5 border-e border-border/70 p-1.5 md:flex">
          {RAIL_PLACEHOLDERS.map((index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-5">
          <Skeleton className="aspect-square w-full max-w-[min(100%,calc(100svh-14rem))] rounded-sm" />
        </div>
        <div className="hidden w-72 shrink-0 flex-col gap-4 border-s border-border/70 p-4 md:flex">
          {PANEL_PLACEHOLDERS.map((index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      </div>

      <span role="status" aria-live="polite" className="sr-only">
        {MESSAGES.loading}
      </span>
    </div>
  );
}

function Redirecting() {
  return (
    <div className="grid h-dvh place-items-center bg-background p-6">
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner aria-hidden />
        {MESSAGES.redirecting}
      </p>
    </div>
  );
}

function StateScreen({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="grid h-dvh place-items-center bg-background p-6">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestion />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/" />}
          >
            <ArrowRight />
            {MESSAGES.backToDashboard}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

export function EditorScreen() {
  const params = useParams<{ projectId?: string | string[] }>();
  const gate = useRequireAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const routeParam = params.projectId;
  const projectId =
    typeof routeParam === "string" ? routeParam : (routeParam?.[0] ?? null);

  // The document is a Convex query, so it waits for a token too — `gate.ready`
  // rather than merely a session.
  const editor = useEditor(projectId, gate.ready);

  const itemByKey = useMemo(() => {
    const map = new Map<string, CanvasItem>();
    // Only what the board shows: a circular board hides its line/arc items
    // (`docs/CANVAS.md` §3), so a ring or an erase preview can never resolve
    // one, whatever a stale key says.
    for (const item of visibleItems(editor.config.gridType, editor.items)) {
      map.set(item.key, item);
    }
    return map;
  }, [editor.config.gridType, editor.items]);

  const selectionItems = useMemo(
    () => resolveItems(itemByKey, editor.selection),
    [itemByKey, editor.selection],
  );
  const eraseItems = useMemo(
    () => resolveItems(itemByKey, editor.previewKeys),
    [itemByKey, editor.previewKeys],
  );

  if (gate.reconnecting && editor.status === "loading") {
    // Nothing to keep on screen yet: say, quietly, what is happening. Once a
    // document is open the editor stays exactly as it is and the top bar's
    // indicator carries the state (docs/AUTH.md § Transient failures).
    return (
      <div className="grid h-dvh place-items-center bg-background p-6">
        <SessionUnavailable onRetry={gate.retry} />
      </div>
    );
  }
  if (gate.signedOut) return <Redirecting />;

  if (editor.status === "invalid") {
    return (
      <StateScreen
        title={MESSAGES.invalidLink}
        description={MESSAGES.invalidLinkBody}
      />
    );
  }
  if (editor.status === "loading") return <EditorLoading />;
  if (editor.status === "missing") {
    return (
      <StateScreen
        title={MESSAGES.missingTitle}
        description={MESSAGES.missingBody}
      />
    );
  }

  const panels = <Panels editor={editor} />;

  return (
    // The editor is an app shell: fixed to the viewport, not merely 100dvh
    // tall. Taking it out of the document flow leaves the page with no scroll
    // range at all — no empty band under the shell when a browser rounds dvh,
    // when a mobile toolbar moves, or when a scroller below reaches its end.
    <div className="fixed inset-x-0 top-0 flex h-dvh flex-col overflow-hidden bg-background">
      <EditorTopBar
        name={editor.name}
        rename={editor.rename}
        save={editor.save}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        undo={editor.undo}
        redo={editor.redo}
        exportSvg={editor.exportSvg}
        exportPng={editor.exportPng}
        exportFile={editor.exportFile}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        <ToolRail
          orientation="vertical"
          tool={editor.tool}
          setTool={editor.setTool}
          gridType={editor.config.gridType}
          arc={editor.arc}
          setArcDirection={editor.setArcDirection}
          setArcSize={editor.setArcSize}
          onCentreView={editor.centreView}
          className="hidden md:flex"
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CanvasStage
            config={editor.config}
            items={editor.items}
            selectionItems={selectionItems}
            previewItems={editor.previewItems}
            eraseItems={eraseItems}
            marquee={editor.marquee}
            marker={editor.previewMarker}
            dot={editor.previewDot}
            previewMode={editor.previewMode}
            tool={editor.tool}
            zoom={editor.zoom}
            setZoom={editor.setZoom}
            surfaceRef={editor.surfaceRef}
            viewportRef={editor.viewportRef}
            onCentreView={editor.centreView}
            onPointerDown={editor.onPointerDown}
            onPointerMove={editor.onPointerMove}
            onPointerUp={editor.onPointerUp}
            onPointerCancel={editor.onPointerCancel}
          />
          <ToolRail
            orientation="horizontal"
            tool={editor.tool}
            setTool={editor.setTool}
            gridType={editor.config.gridType}
            arc={editor.arc}
            setArcDirection={editor.setArcDirection}
            setArcSize={editor.setArcSize}
            onCentreView={editor.centreView}
            className="md:hidden"
          />
        </main>

        <aside
          aria-label={MESSAGES.settings}
          className="hidden min-h-0 w-72 shrink-0 flex-col border-s border-border/70 bg-background md:flex"
        >
          {/* The rail is the fixed-height sidebar; only its content scrolls,
              and `overscroll-contain` keeps the wheel from chaining to the
              page when the panel reaches its end. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="flex flex-col gap-5 p-4">{panels}</div>
          </div>
        </aside>
      </div>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="bottom" className="max-h-[85svh]">
          <SheetHeader>
            <SheetTitle>{MESSAGES.settings}</SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-6">
            {panels}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
