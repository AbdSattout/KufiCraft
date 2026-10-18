# KufiCraft — UI spec (routes, screens, design language)

## Routes

| route | access | screen |
| --- | --- | --- |
| `/` | public | the **boards** for a visitor with a session; the landing for everyone else (served from `/welcome` by a rewrite, so `/` stays the landing's address) |
| `/welcome` | public | the landing's own route — what `/` is rewritten to, and a redirect back to `/`, so it is never the URL anyone sees |
| `/<projectId>` | auth | a board: the editor, one segment under the boards |
| `/account` | auth | “الحساب والأمان”: the account name (the passkey's) and sign out |

There is **no sign-in route**: the passkey ceremony is a dialog owned by the
landing (`src/components/auth/sign-in-dialog.tsx`), opened by every CTA and by
`/?signin=1`. `/signin` and `/signup` are redirects to that flag now, so the
addresses the sign-in card used to have still land somewhere real.

`/` is one URL, so it renders one of the two pages; the other needs an address
of its own to live at — the landing keeps its own route, and the proxy picks
between them. That route redirects to `/` and nothing links to it, so `/` is
the only address either page is ever reached by. (The alternative — the boards
at `/boards` — would put a board at `/boards/<id>`, and the boards are the
root.)

Route groups: `src/app/(marketing)/` (the landing, at `/welcome`) and
`src/app/(auth)/` (`/account`). The boards (`src/app/page.tsx`) and a board
(`src/app/[projectId]/page.tsx`) sit at the root, one segment apart.
All copy is **Arabic**, `dir="rtl"` comes from the root layout. Latin route
slugs, Arabic UI text.

Who sees what is decided **before rendering**, in `src/proxy.ts` (Next 16's
renamed middleware; it runs on the Node runtime). It only *reads* the Better
Auth session cookie — no validation round-trip — and the rules live in
`src/lib/route-guards.ts` with their tests:

* `/` with a session is the boards; without one it is **rewritten** to the
  landing, so the address bar keeps `/` (the landing's canonical URL) and both
  pages stay statically prerendered;
* the landing's own address redirects to `/` for everyone, so the landing is
  only ever reached at `/`;
* `/?signin=1` is the landing **whatever the cookie says**: it is the fallback
  the client guard navigates to, and a fallback that can bounce back to the
  boards is an endless loop;
* `/account` and a board (`/<id>`) without a session are redirected to
  `/?signin=1` — the landing with the dialog already open — instead of painting
  a skeleton and fixing it up on the client (the client guards stay as a safety
  net for a session that expires mid-visit);
* `/signin` and `/signup` are redirects for the addresses the sign-in card had
  before it became a dialog.

The wrinkle worth remembering: `/` is bounced on the cookie while the client
guard's own target is `/?signin=1`. A *stale* cookie — one the proxy still
believes in but the server no longer does — is exactly where those two can
disagree, which is why the flag wins over the cookie. For the same reason the
guard reads the **session** (`authClient.useSession`), not Convex's auth state:
a failed `/api/auth/convex/token` makes Convex report an anonymous client while
the cookie is perfectly valid, and a guard on that report throws a signed-in
visitor out of their editor. When the session request itself fails there is no
answer, so the screens show a retry (`SessionUnavailable`) instead of guessing.

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
  with the `render` prop — `<DropdownMenuItem render={<Link href="/account" />}>` —
  menu items take `onClick`, and `asChild` does **not** exist. Menu group parts
  belong inside a group: `DropdownMenuLabel` is a `Menu.GroupLabel` and throws
  `MenuGroupContext is missing` outside `DropdownMenuGroup`/`DropdownMenuRadioGroup`.
* Motion: 150–200 ms ease-out, `tw-animate-css` utilities; nothing bouncy.

## Account screens (`/account` and the sign-in dialog)

An account **is** its passkey: one account, one passkey, and the passkey's name
is the account's name (the model is documented in `docs/AUTH.md § Accounts`).

Signing in is a **dialog on the landing**: one button and nothing else — no
fields, no “حساب جديد” section, no conditional-UI input. `SignInDialogProvider`
(root layout) renders it once, and the CTAs (`SignInButton`, `SignInLink`)
open it, so no screen has a sign-in page to link to. The button runs the
passkey sign-in ceremony; if the browser has no passkey for this site (the only
reason to create one, and not something a WebAuthn call can report on its own),
the *same* button switches to creating the account's passkey after that attempt
comes back without a session. Opening the dialog by a click — which is what
carries transient activation into the passkey sheet — also runs the sign-in
ceremony once on its own, silently; a direct load or refresh has no activation,
so nothing opens and the button is the way in.

`/?signin=1` opens the dialog straight away: that is where the guards send an
anonymous visitor who wanted a session screen. The flag is read with
`useSyncExternalStore` (server snapshot: closed), so the statically prerendered
landing never contains an open dialog and hydration stays clean; dismissing a
dialog the URL asked for strips the flag.

`/account` (“الحساب والأمان”) is the only session screen: one row with the
account name (the passkey's) and a pencil that renames that same passkey, then
sign out. No add, no delete, no metadata — a second passkey would be a second
account's key and deleting the only one would lose the account. A visitor with a
live session never sees the dialog: it lives on the landing, and the boards are
where a signed-in visitor lands.

## Dashboard (`/`)

The home route, and the second half of it: the landing for a visitor without a
session (a rewrite), the boards for one with. That is why the header carries no
board link — it would point at the page you are already on.

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
  is the equal cell, half ink beside half space), then
  creates via
  `api.projects.create` and navigates to the editor.
* Empty state: illustrated with a small SVG kufi motif + CTA.
* Loading: skeletons in the card grid shape. All queries via Convex hooks
  (`useQuery(api.projects.list)`), so additions/renames/removals appear live.

## Editor (`/<projectId>`)

Layout (RTL): top bar (project name inline-edit, save state “محفوظ تلقائيًا”,
undo/redo, export menu, back to dashboard) + right toolbar (RTL: the
primary/right side holds tools) + canvas center + bottom-left zoom/status.

Tools are **one class each in a registry** (`src/components/editor/tools.ts`,
`REGISTRY`); the rail, the shortcuts and the dispatcher all read the registry —
see `docs/CANVAS.md` §6 for the contract.

| tool | key | behaviour |
| --- | --- | --- |
| تحديد (select) | `V` | click selects (shift toggles), drag on an item moves the selection, drag on empty space marquee-selects |
| قلم (pen) | `P` | press/drag colours the cells the pointer is moved over — one fragment per cell, a fast drag fills the cells it flew over, nothing merged |
| خط (line) | `L` | **square grid only** — click sequence: click A, click B… commits an open run; click the last point again to end it, click the first one to close it; a drag works too |
| ممحاة (eraser) | `E` | click/drag removes whatever the pointer touches — a fast drag sweeps the cells it flew over (the swept items ring as a ghost); items the grid hides are never touched |
| قوس (arc) | `A` | **square grid only** — press-drag-release A→B, or click A then click B; the armed start cell stays highlighted until it commits, and clicking A again cancels |
| يد (hand) | `H` | drags the *view*, not the board: press and drag to move around a board bigger than the pane, and double click (on the canvas or on the rail button) to put the middle of the board back in the middle |

The line and arc tools are **persistent**: their click sequence survives
pointer-up. While one is armed the overlay shows a filled highlight (no border)
on the start cell. The arc reveals its own controls next to it in the rail:
اتجاه القوس (مع عقارب الساعة / عكس عقارب الساعة) and حجم القوس (نصف دائرة /
ثلاثة أرباع).

The line and arc tools are also **square-grid only** (their classes declare
`creates: ["line"]` / `creates: ["arc"]`): the rail lists `toolsFor(gridType)`
and drops them on a circular board, `L` / `A` are inert there, and a tool that
was active when the grid changed falls back to the first tool of the rail with
its gesture cancelled. The items those tools drew earlier are **hidden on a
circular board, never deleted**: not drawn, not selectable, not erasable, not
exported, not in the thumbnail, and the status line counts what the board shows.
The document keeps them, so switching back to a square grid brings them back
untouched (`docs/CANVAS.md` §3).

Bigger boards scroll: the canvas sits in an `overflow-auto` pane, and the square
centres itself with `margin: auto` so its overflow always lands on the reachable
side (a `justify-center` canvas would hide its inline-start edge — in RTL, the
right one — from the scroll range for good). Each tool carries its own one-line
hint in the status bar, which is where the hand tool says what it does.

Shape palette (applies to the next drawn tiles and to the current selection):
square, circle, triangle, quarter circle, semicircle, pentagon, curve, hamza1,
hamza2, comb — ten glyphs, each drawn by the same `KufiShape` that paints the
canvas fragment, so the palette icon **respects the current rotation**
(`tileIconPath`), with a single rotation button that cycles quarter turns
(0° → 90° → 180° → 270° → 0°, `R` from the keyboard too). There is deliberately
**no “إعادة الشكل” button**: the cycle comes back around, and the palette
re-selects a shape, so a reset only ever saved a click. The style itself is the
user's, not the board's — see *Settings persistence*.
With something selected the same section reveals the selection actions
(«التحديد»: recolour with the ink colour, duplicate, delete) — with nothing
selected they are absent, not disabled.

Sidebar, top to bottom: الأشكال (palette + selection), لون الحبر, لون الورقة,
then the board — نسبة الحبر as the five presets `1:1`…`1:5` (live re-render; the
`1:1` hint explains that ink and space are equal there, and every preset shows
the inner edges of its ink squares), حجم الخلية (`base`), قطاعات الدائرة
(circular boards only: the angular division, its caption reading out the
resulting sector angle — ٣٦ قطاعًا is ١٠°), نوع الشبكة (square/circular —
switching warns that existing items may look different, and that lines and arcs
are hidden on a circular board while staying in the drawing; the hint explains
what each type is), خيارات اللوحة (إظهار الشبكة and الخط المستقيم مربّعات) — and
مسح الكل at the end (confirm).

قطاعات الدائرة is the document's own setting, not a preference: it is the
circular board's angular division (default 36 sectors of 10°, the historical
value). The control only appears while the grid is circular, and changing the
count **re-interprets** what is already drawn — like حجم الخلية, a sector keeps
its index, so the artwork rotates/stretches around the ring; the hint says so.

إظهار الشبكة is a **view guide, not artwork**: the construction grid's two
families (cell borders plus the stronger inner ink edges) are what you draw
*against*, so the switch is the user's preference — one setting, the same in
every board, remembered in `kuficraft.editor-prefs.v1`. It is never part of an
export, and the document's own `config.showGrid` is tolerated but no longer
rendered (docs/FORMAT.md).

In that same خيارات اللوحة section, **الخط المستقيم مربّعات** is the line
tool's shape: on (the default) it draws a run with no diagonal segment as one
square per cell — the reference app's straight line; off, that run is a single
solid `line` bar. It never affects what is already drawn.

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

Settings persistence (localStorage, per browser, no server round-trip) — and the
line it draws between the **user** and the **board**:

* `kuficraft.editor-prefs.v1` — the user's editor: tool, active shape, rotation,
  arc direction and size, zoom, the grid guide (إظهار الشبكة, default on) and
  the colour swatches history (last ≤ 8 ink colours). Loaded synchronously when
  the editor mounts and applied to the toolbar so the app “opens the way you
  left it”, and written as each change happens (never per project): the shape
  and rotation a designer set on one board are what the next board opens with.
  Zoom runs **0.1×–32×**, so a board far larger than the pane is viewable whole
  and a dense one (a `base` = 4 cell is ~3 px at 1×) is workable up close.
* `kuficraft.last-config.v1` — the last committed project config, used as the
  default in the dashboard’s «لوحة جديدة» dialog and for new projects. The
  artwork settings — ink ratio, cell size, grid type, circular sector count, ink
  and paper colour, the straight-lines-as-squares flag — are remembered here
  rather than in the prefs, because they belong to the project and stay the open
  project's while it is open (`config` is authoritative for rendering).
* The grid guide is the one **view** setting in the prefs: the editor draws the
  canvas from the preference even when a document carries its own
  `config.showGrid`. That document field is still written, exported and
  tolerated (docs/FORMAT.md) — nothing renders from it.
* Both keys are versioned and validated on read (corrupt/stale values fall back
  to model defaults, never throw).

Keyboard: `Delete`/`Backspace` remove, `Ctrl+Z` / `Ctrl+Shift+Z` (`Ctrl+Y`)
undo/redo, `Ctrl+D` duplicate, `R` rotate the active shape, `Escape`/`Enter`
cancel a click sequence, digits `1…9` pick a shape, `V` select, `P` pen, `L`
line, `E` eraser, `A` arc, `H` hand. The tool keys come from the tool classes
and the shape digits from the shape registry (`SHAPE_ORDER`), so the map cannot
drift from the UI; the grid decides which of them exist, so `L` and `A` do
nothing on a circular board.

## Landing (`/welcome`, served at `/`)

Marketing page for a craft tool: hero with **live kufi artwork rendered by the
canvas engine** (static SVG string, no interaction), one-line value prop,
“كيف يعمل” 3 steps, feature grid (شبكة مربعة ودائرية، نسب قابلة للتخصيص، حفظ
تلقائي ومزامنة فورية، تصدير SVG/PNG), gallery strip, footer with the GitHub
link and a CTA that opens the sign-in dialog (there is no separate sign-in or
sign-up route). A visitor **without** a session gets it at `/`; this route also
answers directly, and never redirects on the cookie, so nothing can bounce.
Follow the
`design-taste-frontend` skill: researched
composition, no generic template look, real typography scale, Arabic-first
layout (numbers/Latin inline as needed).

## Shared pieces

* `src/components/site-header.tsx` — wordmark (the boards are the home route, so
  there is no separate board link), the account menu (account & security,
  sign-out) when signed in — its button reads the passkey's name, because that
  *is* the account's name — or a single “تسجيل الدخول” that opens the sign-in
  dialog when not.
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
