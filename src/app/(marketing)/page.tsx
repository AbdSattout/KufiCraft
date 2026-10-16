import type { Metadata } from "next";
import { Hero } from "@/components/marketing/hero";
import { Steps } from "@/components/marketing/steps";
import { Capabilities } from "@/components/marketing/capabilities";
import { Gallery } from "@/components/marketing/gallery";
import { Closing } from "@/components/marketing/closing";
import { SiteFooter } from "@/components/marketing/site-footer";

export const metadata: Metadata = {
  title: { absolute: "KufiCraft — محرّر الكوفي المربع" },
  description:
    "ارسم لوحات الكوفي المربع على شبكة مربعة أو دائرية، واضبط نسبة الحبر، وبدّل بين تسعة أشكال، ثم صدّرها SVG أو PNG مع مزامنة فورية.",
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
