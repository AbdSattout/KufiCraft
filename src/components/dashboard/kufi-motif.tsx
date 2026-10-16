/**
 * Hand-authored square-kufi motif: a single coiled line (the classic kufic
 * maze), drawn with `currentColor` so callers pick the colour via tokens.
 */
export function KufiMotif({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 90 90"
      aria-hidden="true"
      shapeRendering="crispEdges"
      fill="currentColor"
      className={className}
    >
      {/* outer ring, opened at one corner so the line coils inward */}
      <rect x="0" y="0" width="90" height="10" />
      <rect x="80" y="10" width="10" height="70" />
      <rect x="0" y="80" width="90" height="10" />
      <rect x="0" y="20" width="10" height="60" />
      {/* inner coil */}
      <rect x="10" y="20" width="60" height="10" />
      <rect x="60" y="30" width="10" height="10" />
      <rect x="20" y="40" width="30" height="10" />
      <rect x="60" y="40" width="10" height="10" />
      <rect x="20" y="50" width="10" height="10" />
      <rect x="60" y="50" width="10" height="10" />
      <rect x="20" y="60" width="50" height="10" />
    </svg>
  );
}
