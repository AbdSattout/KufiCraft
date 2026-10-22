import type { Metadata } from "next";
import { Suspense } from "react";
import { EditorLoading, EditorScreen } from "@/components/editor/editor-screen";

/**
 * `/<projectId>` — the KufiCraft editor. Boards are `/‹id›`, not `/app/‹id›`:
 * the boards list is the root, so a board is one segment under it.
 *
 * The screen is a client component, so the route parameter is resolved on the
 * server and passed down as a prop. `params` is a promise under Cache
 * Components, and awaiting it inside the boundary keeps the skeleton as the
 * static shell.
 */

export const metadata: Metadata = {
  title: "المحرّر",
  robots: { index: false },
};

export default function Page({ params }: PageProps<"/[projectId]">) {
  return (
    <Suspense fallback={<EditorLoading />}>
      <EditorRoute params={params} />
    </Suspense>
  );
}

/** Awaits the route parameter inside the boundary; the shell renders first. */
async function EditorRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <EditorScreen projectId={projectId} />;
}
