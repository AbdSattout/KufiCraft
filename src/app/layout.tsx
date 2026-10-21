import type { Metadata } from "next";
import { Noto_Kufi_Arabic, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { SignInDialogProvider } from "@/components/auth/sign-in-dialog";
import { DirectionProvider } from "@/components/ui/direction";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

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
        {/* Base UI takes its direction from this provider, not from the `dir`
            attribute: without it the editor's sliders and arrow-key groups move
            the opposite way to the order the reader sees. */}
        <DirectionProvider direction="rtl">
          <ConvexClientProvider>
            {/* One delay group for every tooltip: the editor's shortcut hints
                are the current users, and moving along a rail keeps them
                instant once one is open (src/components/editor/shortcut-tooltip.tsx). */}
            <TooltipProvider delay={300}>
              {/* Every page can open the passkey dialog: the landing's CTAs, the
                  header, and the guards that send a visitor home. */}
              <SignInDialogProvider>{children}</SignInDialogProvider>
            </TooltipProvider>
            <Toaster position="top-center" dir="rtl" richColors />
          </ConvexClientProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
