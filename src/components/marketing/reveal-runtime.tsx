"use client";

import { useEffect } from "react";

/**
 * The page's entrance stagger: every `[data-reveal]` part is shown once, the
 * first time it enters the viewport. The hidden state is applied by CSS only
 * while the document carries `mk-js` (set before paint by the layout's inline
 * script), so a page without script renders its content plainly.
 */
export function RevealRuntime() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-shown", "");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.04 },
    );
    for (const part of document.querySelectorAll("[data-reveal]")) {
      observer.observe(part);
    }
    return () => {
      observer.disconnect();
    };
  }, []);

  return null;
}
