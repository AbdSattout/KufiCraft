import { SiteHeader } from "@/components/site-header";

/**
 * Shell for the account screens (`/signin`, `/signup`): the shared site header
 * plus a narrow centered column so the passkey cards stay around the fold.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
