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
  savingRetrying: "تعذّر الاتصال — جارٍ إعادة المحاولة…",
  unsavedOffline: "غير محفوظ — ستتم إعادة المحاولة",
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
  exportFile: "ملف KufiCraft (.kuficraft)",
  itemsLimit: "تجاوزت اللوحة الحد الأقصى للعناصر",
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
  circularSectors: "قطاعات الدائرة",
  circularSectorsAngle: "زاوية كل قطاع",
  circularSectorsHint:
    "تغيير العدد يعيد تفسير العناصر المرسومة على القطاعات، مثل تغيير حجم الخلية.",
  inkColor: "لون الحبر",
  inkColorHint: "يُطبَّق على ما ترسمه من الآن؛ ما رسمته سابقًا يحتفظ بلونه.",
  selectionFillColor: "لون التحديد",
  selectionFillColorHint:
    "يُطبَّق على التحديد فقط؛ لا يغيّر لون الحبر للرسم الجديد.",
  paperColor: "لون الورقة",
  showGrid: "إظهار الشبكة",
  smartPoints: "اختيار النقاط الذكي",
  smartPointsHint:
    "للخط والقوس: يختار المنتصف المناسب تلقائيًا بدل الالتقاط الدقيق. مفعّل افتراضيًا على الهاتف والجهاز اللوحي، ومتوقف على الحاسوب، ويُحفظ في هذا المتصفح.",
  straightLinesAsSquares: "تقطيع الخطوط",
  straightLinesAsSquaresHint:
    "المقاطع المستقيمة تُقطَّع إلى مربع في كل خلية، بدل شريط واحد متصل.",
  boardOptions: "خيارات اللوحة",
  gridType: "نوع الشبكة",
  gridSquare: "مربعة",
  gridCircular: "دائرية",
  gridTypeHint: "المربعة خلايا، والدائرية حلقات من المركز وقطاعات بزاوية قابلة للضبط.",
  gridChangeTitle: "تغيير نوع الشبكة؟",
  gridChangeBody:
    "قد تظهر العناصر المرسومة مسبقًا بشكل مختلف بعد تغيير نوع الشبكة، وتختفي الخطوط والأقواس على الشبكة الدائرية مع بقائها محفوظة.",
  clearAll: "مسح الكل",
  clearAllTitle: "مسح كل العناصر؟",
  clearAllBody: "سيُحذف كل ما في اللوحة، ويمكنك التراجع عن ذلك فورًا.",
  confirm: "تأكيد",
  cancel: "إلغاء",
  rotate: "تدوير",
  rounding: "الاستدارة",
  roundingRadius: "نصف قطر الزاوية",
  roundingCorners: "الزوايا المستديرة",
  cornerTopRight: "الزاوية العليا اليمنى",
  cornerTopLeft: "الزاوية العليا اليسرى",
  cornerBottomRight: "الزاوية السفلى اليمنى",
  cornerBottomLeft: "الزاوية السفلى اليسرى",
  roundingHint: "نسبة من الضلع الأقصر للشكل؛ ٠٪ تعني زوايا قائمة.",
  strokeStyle: "أطراف الخط",
  strokeCap: "نهاية الخط",
  strokeCapButt: "مسطّحة",
  strokeCapRound: "دائرية",
  strokeCapSquare: "مربّعة",
  strokeJoin: "وصلة الخط",
  strokeJoinMiter: "حادّة",
  strokeJoinRound: "دائرية",
  strokeJoinBevel: "مشطوفة",
  borders: "الحدود",
  borderSides: "الجوانب",
  borderTop: "الحد الأعلى",
  borderRight: "الحد الأيمن",
  borderBottom: "الحد الأسفل",
  borderLeft: "الحد الأيسر",
  borderWidth: "سُمك الحد",
  borderColor: "لون الحدود",
  borderHint: "يُرسم الحد خارج الشكل، فلا يغطي الحبر.",
  recolourSelection: "تلوين بلون الحبر",
  deleteSelection: "حذف التحديد",
  duplicateSelection: "تكرار التحديد",
  arrange: "ترتيب",
  bringToFront: "تقديم إلى الأمام",
  bringForward: "تقديم خطوة",
  sendBackward: "إرسال خطوة للخلف",
  sendToBack: "إرسال إلى الخلف",
  arcDirection: "اتجاه القوس",
  arcClockwise: "مع عقارب الساعة",
  arcCounterclockwise: "عكس عقارب الساعة",
  arcClockwiseShort: "يمين",
  arcCounterclockwiseShort: "يسار",
  arcSize: "حجم القوس",
  arcQuarter: "ربع دائرة",
  arcHalf: "نصف دائرة",
  arcThreeQuarter: "ثلاثة أرباع",
  arcQuarterShort: "١/٤",
  arcHalfShort: "نصف",
  arcThreeQuarterShort: "٣/٤",
  handDoubleClick: "نقرة مزدوجة: توسيط اللوحة",
  ratioHint: "نسبة الحبر إلى الفراغ داخل كل خلية.",
  ratioEqualCell: "1:1 يعني أن الحبر والفراغ متساويان، ولكل جزء ربع الخلية.",
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
