import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "لوحاتي",
};

export default function AppLayout(props: LayoutProps<"/app">) {
  return <>{props.children}</>;
}
