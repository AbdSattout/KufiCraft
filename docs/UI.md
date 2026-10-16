# KufiCraft — UI spec (routes, screens, design language)

## Routes

| route | access | screen |
| --- | --- | --- |
| `/` | public | landing (Arabic marketing page) |
| `/signin` | public | passkey sign-in (conditional UI) |
| `/signup` | public | passkey sign-up (name → passkey → in) |
| `/app` | auth | dashboard: “لوحاتي” |
| `/app/[projectId]` | auth | editor |

Route groups: `src/app/(marketing)/`, `src/app/(auth)/`, `src/app/(app)/`.
All copy is **Arabic**, `dir="rtl"` comes from the root layout. Latin route
slugs, Arabic UI text.

## Design language

* Palette comes from `src/app/globals.css` (oklch tokens): warm paper
  background, deep navy ink (`--primary`), saffron accent (`--accent`),
  subtle borders. Use tokens (`bg-card`, `text-muted-foreground`, …) — never
  hard-coded greys.
* Type: `font-heading` = Noto Kufi Arabic (display, geometric, kufic-adjacent),
  `font-sans` = IBM Plex Sans Arabic (body). Both wired in `layout.tsx`.
* Feel: gallery/museum of a craft — generous whitespace, thin borders, precise
  geometry, no gradients, no shadows beyond `shadow-sm`. Artwork is the hero.
* Icons: `lucide-react`. Buttons/inputs/dialogs come from `src/components/ui/*`
  (shadcn, RTL-enabled) — do not invent parallel primitives.
* **These primitives are Base UI based (`@base-ui/react`), not Radix.** Compose
  with the `render` prop — `<Button render={<Link href="/app" />}>لوحاتي</Button>` —
  menu items take `onClick`, and `asChild` does **not** exist.
* Motion: 150–200 ms ease-out, `tw-animate-css` utilities; nothing bouncy.

## Dashboard (`/app`)

* Grid of project cards (responsive: 1/2/3/4 columns). Each card shows the
  stored SVG thumbnail (render `project.thumbnail` with `dangerouslySetInnerHTML`
  inside a fixed aspect wrapper, `pointer-events-none`), name, item count and a
  relative “آخر تعديل” time (Arabic).
* Card actions (dropdown + keyboard): فتح، إعادة تسمية، نسخ، **تصدير الملف**
  (`.kuficraft`, see `docs/FORMAT.md`)، حذف (confirm dialog). Rename is an inline
  dialog with the name pre-filled.
* **Import**: an `استيراد ملف` button in the dashboard header **and** drag-and-drop
  of `.kuficraft` files anywhere on the page (with a visible drop overlay while
  dragging). Import always creates a new project and opens its editor; validation
  errors surface as Arabic toasts (`docs/FORMAT.md` defines the rules).
* “لوحة جديدة” opens a dialog: الاسم, نوع الشبكة (مربعة/دائرية), نسبة الحبر
  (slider 25–75% with a live mini preview of one cell), then creates via
  `api.projects.create` and navigates to the editor.
* Empty state: illustrated with a small SVG kufi motif + CTA.
* Loading: skeletons in the card grid shape. All queries via Convex hooks
  (`useQuery(api.projects.list)`), so additions/renames/removals appear live.

## Editor (`/app/[projectId]`)

Layout (RTL): top bar (project name inline-edit, save state “محفوظ تلقائيًا”,
undo/redo, export menu, back to dashboard) + right toolbar (RTL: the
primary/right side holds tools) + canvas center + bottom-left zoom/status.

Tools (`src/components/editor/*` state machine):

| tool | behaviour |
| --- | --- |
| قلم (pen) | click = one tile; drag = stroke → tiles, auto-merged to a line when straight & `mergeLines` |
| ممحاة (eraser) | click = remove one item; drag = remove along the path |
| قوس (arch) | press on anchor A, drag to anchor B on the same row/column → arch (bulge up/down toggle) |
| تحديد (select) | click = select (shift-click extends), drag hollow box = marquee; Delete removes selection; arrow-cmd? (skip) |

Shape palette (applies to the next drawn tiles and to the current selection):
square, circle, triangle, quadrant, semicircle, hexagon, arc, hamza1, hamza2
(+ rotation button cycling `r`, + “شكل” reset to square).

Settings panel: نسبة الحبر slider (25–75%, live re-render), حجم الخلية
(`base`), لون الحبر (color input + swatch row), لون الورقة (background),
إظهار الشبكة (toggle), دمج الخطوط (toggle), نوع الشبكة (square/circular —
switching warns that existing items may look odd), مسح الكل (confirm).

Editing ops on selection: move (drag, items keep relative offsets; anchors snap
to grid), recolour (choose colour → patch `c`), reshape (shape + rotation),
delete, duplicate (optional).

Persistence: every completed gesture → one `api.projects.applyOps` call with a
`clientMutationId`-free batch; cursor local state only; project fetched with
`useQuery(api.projects.get, { projectId })` on server values, with an
optimistic local overlay for in-flight ops; undo/redo = local stack of item
batches (≤ 50 entries) replayed as `replace` ops.

Exports (from the top bar menu `تصدير`): SVG (string from `renderSvg`), PNG
(canvas → `toBlob`), **ملف KufiCraft (`.kuficraft`)** via
`src/lib/kuficraft-file.ts` (`docs/FORMAT.md`), and share via `updateThumbnail`
after each committed gesture (throttled to ≥ 2 s).

Settings persistence (localStorage, per browser, no server round-trip):

* `kuficraft.editor-prefs.v1` — tool, active shape, rotation, arch bulge, zoom,
  showGrid, mergeLines, colour swatches history (last ≤ 8 ink colours).
  Loaded synchronously when the editor mounts and applied to the toolbar so the
  app “opens the way you left it”. Project `config` stays authoritative for
  rendering; UI prefs only decide the toolbar defaults and tool behaviour.
* `kuficraft.last-config.v1` — the last committed project config, used as the
  default in the dashboard’s «لوحة جديدة» dialog and for new projects.
* Both keys are versioned and validated on read (corrupt/stale values fall back
  to model defaults, never throw).

Keyboard: `Delete`/`Backspace` remove, `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo,
digits `1…9` pick a shape, `E` eraser, `P` pen, `A` arch, `V` select.

## Landing (`/`)

Marketing page for a craft tool: hero with **live kufi artwork rendered by the
canvas engine** (static SVG string, no interaction), one-line value prop,
“كيف يعمل” 3 steps, feature grid (شبكة مربعة ودائرية، نسب قابلة للتخصيص، دمج
تلقائي، تصدير SVG/PNG), gallery strip, footer with GitHub link and a CTA to
`/signup` + `/app`. Follow the `design-taste-frontend` skill: researched
composition, no generic template look, real typography scale, Arabic-first
layout (numbers/Latin inline as needed).

## Shared pieces

* `src/components/site-header.tsx` — logo/wordmark, links, user menu
  (name, sign-out) when signed in, or “تسجيل الدخول”/“إنشاء حساب” when not.
* `src/components/canvas/canvas-preview.tsx` — read-only SVG renderer:
  `<CanvasPreview config items />` (used by editor, cards’ previews and the
  create dialog); it must call the engine, never hand-render paths itself.
* Toasts: `sonner` (`toast.error(error.data ?? message)`).
* Every interactive element needs an Arabic accessible label (`aria-label`).

## Quality bar

* No layout shift on first paint; no `any`; no unused imports.
* `bunx tsc --noEmit` + `bun run lint` green; `bun run build` green for the
  owner of a route group before merging.
* Mobile: dashboard and editor must both be usable at 375 px width (editor
  toolbar collapses to an icon rail + sheet).
