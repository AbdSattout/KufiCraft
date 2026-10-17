import type { Metadata } from "next";
import { Hero } from "@/components/marketing/hero";
import { Steps } from "@/components/marketing/steps";
import { Capabilities } from "@/components/marketing/capabilities";
import { Gallery } from "@/components/marketing/gallery";
import { Closing } from "@/components/marketing/closing";
import { SiteFooter } from "@/components/marketing/site-footer";

/**
 * `/welcome` — the landing. Anonymous visitors see it at `/` (the proxy rewrites
 * them there without touching the address bar), which is why the canonical URL
 * stays `/` even though this route also answers to its own path.
 */

export const metadata: Metadata = {
  title: { absolute: "KufiCraft — محرّر الكوفي المربع" },
  description:
    "ارسم لوحات الكوفي المربع على شبكة مربعة أو دائرية، واضبط نسبة الحبر، وبدّل بين عشرة أشكال، ثم صدّرها SVG أو PNG مع مزامنة فورية.",
  alternates: { canonical: "/" },
};

export default function LandingPage() {
  return (
    <>
      <main>
        <Hero />
        <Steps />
        <Capabilities />
        <Gallery />
        <Closing />
      </main>
      <SiteFooter />
    </>
  );
}
