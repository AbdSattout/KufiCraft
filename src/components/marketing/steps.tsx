import { RATIO_PRESETS, ratioLabel } from "@/lib/canvas/model";
import { KufiSvg } from "./kufi/kufi-svg";
import { medallion } from "./kufi/compositions";
import { Reveal } from "./reveal";

type Step = {
  name: string;
  body: string;
  /** The same drawing, further along in each tile. */
  items: number | null;
  ratio: number;
  grid: boolean;
  tone: string;
  height: string;
};

const STEPS: Step[] = [
  {
    name: "ارسم على الشبكة",
    body: "انقر على الخلايا التي تريد أن ينزل فيها الحبر، خليّةً بعد خليّة.",
    items: 40,
    ratio: RATIO_PRESETS[0].ratio,
    grid: true,
    tone: "mk-steps__tile--first",
    height: "var(--mk-step-tile-1)",
  },
  {
    name: "اضبط النسبة والأشكال",
    body: "اختر نسبة الحبر من 1:1 إلى 1:5، وبدّل شكل الخلية بين الأشكال التسعة.",
    items: null,
    ratio: RATIO_PRESETS[1].ratio,
    grid: false,
    tone: "mk-steps__tile--second",
    height: "var(--mk-step-tile-2)",
  },
  {
    name: "صدّر أو شارك",
    body: "صدّر لوحتك بملف SVG أو صورة PNG، جاهزة للطباعة أو للنشر.",
    items: null,
    ratio: RATIO_PRESETS[2].ratio,
    grid: false,
    tone: "mk-steps__tile--third",
    height: "var(--mk-step-tile-3)",
  },
];

/**
 * Three stages of one drawing, carried by size: the tiles grow from the first
 * step to the last, and the medallion inside them thickens as the ink ratio
 * rises. Every tile is a piece of the editor's surface at real size, so the
 * tiles carry `data-ui`.
 */
export function Steps() {
  return (
    <section className="mk-steps">
      <div className="mk-steps__list">
        <Reveal className="mk-steps__heading">
          <h2 className="mk-display">كيف يعمل</h2>
        </Reveal>

        {STEPS.map((step, index) => (
          <div key={step.name} className="mk-steps__stage">
            <Reveal
              step={index}
              className={`mk-steps__tile ${step.tone}`}
            >
              <div data-ui="" className="mk-steps__drawing">
                <KufiSvg
                  piece={medallion}
                  items={
                    step.items === null
                      ? undefined
                      : medallion.items.slice(0, step.items)
                  }
                  ratio={step.ratio}
                  grid={step.grid}
                  label={`${step.name}: الميدالية بنسبة حبر ${ratioLabel(step.ratio)}`}
                  className="h-full"
                />
              </div>
            </Reveal>
            <Reveal step={index + 1} className="mk-steps__note">
              <p className="mk-lead font-medium">{step.name}</p>
              <p className="mk-body mk-steps__note-body">{step.body}</p>
            </Reveal>
          </div>
        ))}
      </div>
    </section>
  );
}
