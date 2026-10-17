import type { Metadata } from "next";
import { Suspense } from "react";
import { EditorLoading, EditorScreen } from "@/components/editor/editor-screen";

/**
 * `/<projectId>` — the KufiCraft editor. Boards are `/‹id›`, not `/app/‹id›`:
 * the boards list is the root, so a board is one segment under it.
 *
 * The screen is a client component and reads the route parameter with
 * `useParams`; with Cache Components that suspends during prerendering, so
 * the boundary here supplies the editor's skeleton as the static shell.
 */

export const metadata: Metadata = {
  title: "المحرّر",
  robots: { index: false },
};

export default function Page() {
  return (
    <Suspense fallback={<EditorLoading />}>
      <EditorScreen />
    </Suspense>
  );
}
