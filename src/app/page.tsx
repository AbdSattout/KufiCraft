import type { Metadata } from "next";
import { BoardsScreen } from "@/components/dashboard/boards-screen";

/**
 * `/` — the boards, and the app's home. A visitor **with** a session gets this
 * page; without one, `src/proxy.ts` rewrites `/` to the landing (`/welcome`) so
 * the marketing page keeps `/` as its address.
 */

export const metadata: Metadata = {
  title: "لوحاتي",
};

export default function HomePage() {
  return <BoardsScreen />;
}
