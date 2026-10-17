import type { Metadata } from "next";
import { Noto_Kufi_Arabic, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { SignInDialogProvider } from "@/components/auth/sign-in-dialog";
import { Toaster } from "@/components/ui/sonner";

const kufi = Noto_Kufi_Arabic({
  subsets: ["arabic"],
  variable: "--font-kufi-arabic",
  display: "swap",
});

const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "KufiCraft — مربع الكوفي",
    template: "%s | KufiCraft",
  },
  description:
    "صمّم لوحات الخط الكوفي المربع على شبكة مربعة أو دائرية، بنِسب قابلة للتخصيص، وحفظ تلقائي ومزامنة فورية.",
  keywords: [
    "KufiCraft",
    "الكوفي المربع",
    "الخط الكوفي",
    "الخط العربي",
    "تصميم",
    "محرر",
  ],
  applicationName: "KufiCraft",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={cn("font-sans antialiased", kufi.variable, plex.variable)}
    >
      <body>
        <ConvexClientProvider>
          {/* Every page can open the passkey dialog: the landing's CTAs, the
              header, and the guards that send a visitor home. */}
          <SignInDialogProvider>{children}</SignInDialogProvider>
          <Toaster position="top-center" dir="rtl" richColors />
        </ConvexClientProvider>
      </body>
    </html>
  );
}
