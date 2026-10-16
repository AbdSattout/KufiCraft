import { SiteHeader } from "@/components/site-header";
import { RevealRuntime } from "@/components/marketing/reveal-runtime";
import "./marketing.css";

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <div
      // The flag below is added to this wrapper by the script, before the
      // sections are parsed, so the browser paints them in their hidden state
      // rather than showing them once and hiding them again.
      suppressHydrationWarning
      className="mk-page min-h-[100svh] bg-background"
    >
      <script
        // The entrance stagger hides each part only while this class is on the
        // section wrapper, and the script runs before the wrapper's content is
        // parsed. Without script the class never arrives and every part stays
        // visible.
        dangerouslySetInnerHTML={{
          __html:
            "document.currentScript.parentElement.classList.add('mk-js')",
        }}
      />
      <RevealRuntime />
      <SiteHeader />
      {children}
    </div>
  );
}
