/**
 * KufiCraft — editor copy and error surfacing.
 *
 * Convex throws `ConvexError` with ready-to-show Arabic messages
 * (docs/BACKEND.md §Limits & conventions); everything else degrades to a
 * generic Arabic sentence instead of leaking an English stack message.
 */

import { ConvexError } from "convex/values";

export const MESSAGES = {
  editorLabel: "المحرّر",
  canvasLabel: "لوحة الرسم",
  backToDashboard: "لوحاتي",
  backToDashboardHint: "العودة إلى قائمة اللوحات",
  untitled: "لوحة بلا عنوان",
  savedAutomatically: "محفوظ تلقائيًا",
  saving: "جارٍ الحفظ…",
  missingTitle: "اللوحة غير موجودة",
  missingBody: "قد تكون اللوحة محذوفة أو لا تملك صلاحية الوصول إليها.",
  invalidLink: "الرابط غير صالح",
  invalidLinkBody: "قد يكون الرابط ناقصًا أو منسوخًا بشكل خاطئ.",
  loading: "جارٍ تحميل اللوحة…",
  redirecting: "جارٍ التحويل إلى تسجيل الدخول…",
  undo: "تراجع",
  redo: "إعادة",
  export: "تصدير",
  exportSvg: "تصدير SVG",
  exportPng: "تصدير PNG",
  settings: "الإعدادات",
  tools: "الأدوات",
  shapes: "الأشكال",
  selection: "التحديد",
  itemsCount: "عنصر",
  selectedCount: "محدَّد",
  zoom: "التكبير",
  zoomIn: "تكبير",
  zoomOut: "تصغير",
  zoomReset: "إعادة التكبير إلى ١٠٠٪",
  inkRatio: "نسبة الحبر",
  cellSize: "حجم الخلية",
  inkColor: "لون الحبر",
  paperColor: "لون الورقة",
  showGrid: "إظهار الشبكة",
  mergeLines: "دمج الخطوط",
  gridType: "نوع الشبكة",
  gridSquare: "مربعة",
  gridCircular: "دائرية",
  gridChangeTitle: "تغيير نوع الشبكة؟",
  gridChangeBody:
    "قد تظهر العناصر المرسومة مسبقًا بشكل مختلف بعد تغيير نوع الشبكة.",
  clearAll: "مسح الكل",
  clearAllTitle: "مسح كل العناصر؟",
  clearAllBody: "سيُحذف كل ما في اللوحة، ويمكنك التراجع عن ذلك فورًا.",
  confirm: "تأكيد",
  cancel: "إلغاء",
  drawColor: "لون الرسم",
  drawColorHint: "يُطبَّق على العناصر الجديدة",
  applyToSelection: "تطبيق على التحديد",
  rotate: "تدوير",
  resetShape: "إرجاع إلى المربع",
  deleteSelection: "حذف التحديد",
  duplicateSelection: "تكرار التحديد",
  bulgeUp: "قوس علوية",
  bulgeDown: "قوس سفلية",
  deleteKeyHint: "حذف",
  toolRailLabel: "شريط الأدوات",
  closePanel: "إغلاق",
  openSettings: "فتح الإعدادات",
  renameLabel: "اسم اللوحة",
  renameHint: "اضغط للتعديل",
  showAllTools: "كل الإعدادات",
} as const;

export const DEFAULT_ERROR = "تعذّر إتمام العملية";

/** Arabic message of a thrown value (Convex errors already are Arabic). */
export function errorMessage(error: unknown, fallback = DEFAULT_ERROR): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (typeof data === "string" && data.trim().length > 0) return data;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}
