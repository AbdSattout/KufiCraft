import { cn } from "@/lib/utils";
import { KufiSvg } from "./kufi/kufi-svg";
import {
  board,
  circularSample,
  lattice,
  mergedRun,
  ratioCells,
  shapeSet,
  squareSample,
} from "./kufi/compositions";
import { Reveal } from "./reveal";

type FigureKind = "grids" | "ratios" | "merged" | "shapes" | "sync" | "export";

type Capability = {
  title: string;
  body: string;
  figure: FigureKind;
  /** Which cell edge the drawing is anchored to; the other edge crops it. */
  dock: "start" | "end";
  figureFirst: boolean;
};

const CAPABILITIES: Capability[] = [
  {
    title: "شبكة مربعة ودائرية",
    body: "ارسم على شبكة الخلايا المربعة، أو بدّل إلى الشبكة الدائرية بمناطقها وحلقاتها.",
    figure: "grids",
    dock: "end",
    figureFirst: false,
  },
  {
    title: "نسبة حبر قابلة للتخصيص",
    body: "حرّك النسبة بين 25% و75% فتتغيّر سماكة الحبر في اللوحة كلها دفعةً واحدة.",
    figure: "ratios",
    dock: "start",
    figureFirst: true,
  },
  {
    title: "دمج الخطوط تلقائيًا",
    body: "مدّ الخط عبر خلايا متجاورة فيندمج في شريط واحد متّصل يملأ ما بينها.",
    figure: "merged",
    dock: "end",
    figureFirst: false,
  },
  {
    title: "تسعة أشكال",
    body: "مربّع، دائرة، مثلّث، ربع دائرة، نصف دائرة، سدّاسي، قوس، وهمزتان.",
    figure: "shapes",
    dock: "start",
    figureFirst: true,
  },
  {
    title: "مزامنة فورية",
    body: "كل تعديل يُحفظ ويظهر على كل أجهزتك في اللحظة نفسها، بلا زرّ حفظ.",
    figure: "sync",
    dock: "end",
    figureFirst: false,
  },
  {
    title: "تصدير SVG و PNG",
    body: "صدّر لوحتك بملف متجهي جاهز للطباعة، أو صورة PNG للعرض والنشر.",
    figure: "export",
    dock: "start",
    figureFirst: true,
  },
];

function Figure({ kind, dock }: { kind: FigureKind; dock: "start" | "end" }) {
  return (
    <div
      className={cn(
        "mk-cap__drawing",
        `mk-cap__drawing--${dock}`,
        kind === "grids" && "mk-cap__drawing--pair",
      )}
    >
      {kind === "grids" ? (
        <>
          <KufiSvg
            piece={squareSample}
            label="عيّنة شبكة مربعة"
            className="h-full w-1/2"
          />
          <KufiSvg
            piece={circularSample}
            label="عيّنة شبكة دائرية"
            className="h-full w-1/2"
          />
        </>
      ) : null}
      {kind === "ratios"
        ? ratioCells([0.25, 0.5, 0.75]).map((cell) => (
            <KufiSvg key={cell.id} piece={cell} label={cell.note} className="h-full w-1/3" />
          ))
        : null}
      {kind === "merged" ? <KufiSvg piece={mergedRun} fit="slice" className="h-full w-full" /> : null}
      {kind === "shapes" ? <KufiSvg piece={shapeSet} fit="slice" className="h-full w-full" /> : null}
      {kind === "sync" ? <KufiSvg piece={board} fit="slice" className="h-full w-full" /> : null}
      {kind === "export" ? <KufiSvg piece={lattice} fit="slice" className="h-full w-full" /> : null}
    </div>
  );
}

/**
 * The six capabilities, as the dealt blueprint draws them: filled cells in a
 * three-column checkerboard, each carrying its own drawing of the drawing
 * surface, cropped by the cell edge. The drawings are hand-authored paths from
 * `kufi/geometry.ts`, not screenshots.
 */
export function Capabilities() {
  return (
    <section className="mk-caps">
      <Reveal className="mk-caps__head">
        <h2 className="mk-display">قدرات المحرر</h2>
      </Reveal>
      <div className="mk-caps__grid">
        {CAPABILITIES.map((capability, index) => (
          <Reveal
            key={capability.title}
            step={index}
            className={cn(
              "mk-cap__cell",
              capability.figureFirst && "mk-cap__cell--figure-first",
            )}
          >
            <div className="mk-cap__figure">
              <Figure kind={capability.figure} dock={capability.dock} />
            </div>
            <div className="mk-cap__text">
              <h3 className="mk-lead font-medium text-foreground">
                {capability.title}
              </h3>
              <p className="mk-body mk-cap__body">{capability.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
