import type { CSSProperties, ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  /** Position in the section's stagger — one 70ms step per part. */
  step?: number;
  className?: string;
};

/**
 * Marks one part of a section for the entrance stagger. The runtime in the
 * marketing layout adds `data-shown` when the part comes into view; without
 * script the CSS keeps it visible, so the page never hides its own content.
 */
export function Reveal({ children, step = 0, className }: RevealProps) {
  return (
    <div
      data-reveal=""
      // The runtime may mark this part as shown before its boundary hydrates,
      // so the attribute this element never renders is expected.
      suppressHydrationWarning
      className={className}
      style={{ "--mk-stagger": step } as CSSProperties}
    >
      {children}
    </div>
  );
}
