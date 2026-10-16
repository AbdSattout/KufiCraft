/**
 * Arabic formatting helpers for the dashboard. Numbers stay in Latin digits
 * (matching the rest of the app); the wording follows Arabic plural rules.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormatter = new Intl.DateTimeFormat("ar-u-nu-latn", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** 0 → بلا عناصر، 1 → عنصر واحد، 2 → عنصران، 3–10 → عناصر، 11+ → عنصرًا. */
export function formatItemCount(count: number): string {
  if (count <= 0) return "بلا عناصر";
  if (count === 1) return "عنصر واحد";
  if (count === 2) return "عنصران";
  if (count <= 10) return `${count} عناصر`;
  return `${count} عنصرًا`;
}

/** اليوم / أمس / قبل يومين / قبل N أيام / قبل N يومًا / التاريخ. */
export function formatUpdatedAt(updatedAt: number, now: number): string {
  const daysAgo = Math.round(
    (startOfDay(now) - startOfDay(updatedAt)) / DAY_MS,
  );

  if (daysAgo <= 0) return "اليوم";
  if (daysAgo === 1) return "أمس";
  if (daysAgo === 2) return "قبل يومين";
  if (daysAgo <= 10) return `قبل ${daysAgo} أيام`;
  if (daysAgo <= 30) return `قبل ${daysAgo} يومًا`;
  return dateFormatter.format(updatedAt);
}
