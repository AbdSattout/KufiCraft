# KufiCraft — UI spec (routes, screens, design language)

## Routes

| route | access | screen |
| --- | --- | --- |
| `/` | public | landing (Arabic marketing page) |
| `/signin` | public | passkey sign-in (conditional UI) |
| `/signup` | public | passkey sign-up (name → passkey → in) |
| `/app` | auth | dashboard: “لوحاتي” |
| `/app/[projectId]` | auth | editor |

Route groups: `src/app/(marketing)/` (landing) and `src/app/(auth)/`
(`/signin`, `/signup`). The authenticated screens live in a plain
`src/app/app/` folder — no route group, so the folder name and the URL agree.
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
  (five preset buttons `1:1`…`1:5` with a live mini preview of one cell — `1:1`
  is the space-less cell where the ink fills the whole cell), then
  creates via
  `api.projects.create` and navigates to the editor.
* Empty state: illustrated with a small SVG kufi motif + CTA.
* Loading: skeletons in the card grid shape. All queries via Convex hooks
  (`useQuery(api.projects.list)`), so additions/renames/removals appear live.

## Editor (`/app/[projectId]`)

Layout (RTL): top bar (project name inline-edit, save state “محفوظ تلقائيًا”,
undo/redo, export menu, back to dashboard) + right toolbar (RTL: the
primary/right side holds tools) + canvas center + bottom-left zoom/status.

Tools are **one class each in a registry** (`src/components/editor/tools.ts`,
`REGISTRY`); the rail, the shortcuts and the dispatcher all read the registry —
see `docs/CANVAS.md` §6 for the contract.

| tool | key | behaviour |
| --- | --- | --- |
| تحديد (select) | `V` | click selects (shift toggles), drag on an item moves the selection, drag on empty space marquee-selects |
| قلم (pen) | `P` | press/drag colours the cells the pointer is moved over — one fragment per pointer position, nothing drawn in between, nothing merged |
| خط (line) | `L` | click sequence: click A, click B… commits an open run; click the last point again to end it, click the first one to close it; a drag works too |
| ممحاة (eraser) | `E` | click/drag removes whatever the pointer touches (the swept items ring as a ghost) |
| قوس (arc) | `A` | press-drag-release A→B, or click A then click B; the armed start cell stays highlighted until it commits, and clicking A again cancels |

The line and arc tools are **persistent**: their click sequence survives
pointer-up. While one is armed the overlay shows a filled highlight (no border)
on the start cell. The arc reveals its own controls next to it in the rail:
اتجاه القوس (مع عقارب الساعة / عكس عقارب الساعة) and حجم القوس (نصف دائرة /
ثلاثة أرباع).

Shape palette (applies to the next drawn tiles and to the current selection):
square, circle, triangle, quarter circle, semicircle, pentagon, curve, hamza1,
hamza2, comb — ten glyphs, each drawn by the same `KufiShape` that paints the
canvas fragment, so the palette icon **respects the current rotation**
(`tileIconPath`) (+ rotation button cycling quarter turns, + “إعادة الشكل”,
which appears only once shape/rotation differ from the plain square).
With something selected the same section reveals the selection actions
(«التحديد»: recolour with the ink colour, duplicate, delete) — with nothing
selected they are absent, not disabled.

Sidebar, top to bottom: الأشكال (palette + selection), لون الحبر, لون الورقة,
then the board — نسبة الحبر as the five presets `1:1`…`1:5` (live re-render; the
`1:1` hint explains that the ink fills the whole cell and the grid shows no inner
edges), حجم الخلية (`base`), نوع الشبكة (square/circular — switching warns that
existing items may look odd; the hint explains what each type is), خيارات اللوحة
(إظهار الشبكة — two families: cell borders plus the stronger inner ink edges —
and الخط المستقيم مربّعات) — and مسح الكل at the end (confirm).

خيارات اللوحة is the line tool's shape: **الخط المستقيم مربّعات** (default on)
draws a run with no diagonal segment as one square per cell — the reference
app's straight line; off, that run is a single solid `line` bar. It never
affects what is already drawn.

There is exactly **one** colour control for drawing: لون الحبر is the project's
ink *and* the pen's colour. لون الورقة next to it is the board's background.
A second “لون الرسم” picker was removed on purpose: the pen paints with the
project ink, and a per-item colour change happens through «تلوين بلون الحبر» on
a selection.

Editing ops on selection: move (drag, items keep relative offsets; anchors snap
to grid), recolour (the selection takes the current ink colour → set the item’s
own `color`), reshape (shape + rotation), delete, duplicate (`Ctrl+D`). A
fragment keeps the colour it was drawn with: changing لون الحبر never repaints
existing items.

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

* `kuficraft.editor-prefs.v1` — tool, active shape, rotation, arc direction and
  size, zoom, colour swatches history (last ≤ 8 ink colours).
  Loaded synchronously when the editor mounts and applied to the toolbar so the
  app “opens the way you left it”. Project `config` stays authoritative for
  rendering; UI prefs only decide the toolbar defaults and tool behaviour.
* `kuficraft.last-config.v1` — the last committed project config, used as the
  default in the dashboard’s «لوحة جديدة» dialog and for new projects. The
  document settings — grid, the straight-lines-as-squares flag and the ink ratio
  — are remembered here rather than in the prefs, because they belong to the
  project.
* Both keys are versioned and validated on read (corrupt/stale values fall back
  to model defaults, never throw).

Keyboard: `Delete`/`Backspace` remove, `Ctrl+Z` / `Ctrl+Shift+Z` (`Ctrl+Y`)
undo/redo, `Ctrl+D` duplicate, `R` rotate the active shape, `Escape`/`Enter`
cancel a click sequence, digits `1…9` pick a shape, `V` select, `P` pen, `L`
line, `E` eraser, `A` arc. The tool keys come from the tool classes and the
shape digits from the shape registry (`SHAPE_ORDER`), so the map cannot drift
from the UI.

## Landing (`/`)

Marketing page for a craft tool: hero with **live kufi artwork rendered by the
canvas engine** (static SVG string, no interaction), one-line value prop,
“كيف يعمل” 3 steps, feature grid (شبكة مربعة ودائرية، نسب قابلة للتخصيص، حفظ
تلقائي ومزامنة فورية، تصدير SVG/PNG), gallery strip, footer with GitHub link and
a CTA to `/signup` + `/app`. Follow the `design-taste-frontend` skill: researched
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
