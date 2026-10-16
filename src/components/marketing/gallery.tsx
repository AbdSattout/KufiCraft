import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { KufiSvg } from "./kufi/kufi-svg";
import { arcade, nested, ornament, rosette } from "./kufi/compositions";
import { Reveal } from "./reveal";

/**
 * Four finished drawings at one height: three on the square grid and one on
 * the circular grid, the rosette lifted above the row. Each frame is a whole
 * view of the export, so no frame is cropped — the row is what it is.
 */
const GALLERY = [rosette, nested, ornament, arcade];

export function Gallery() {
  const [lifted, ...rest] = GALLERY;
  return (
    <section className="mk-gallery">
      <div className="mk-gallery__head">
        <Reveal>
          <h2 className="mk-lead font-medium">من اللوحات</h2>
        </Reveal>
        <Reveal step={1} className="mk-gallery__link-row">
          <Link href="/app" className="mk-link mk-small group">
            افتح لوحاتك
            <ArrowLeft
              aria-hidden
              className="size-3.5 transition-transform group-hover:-translate-x-1"
            />
          </Link>
        </Reveal>
        <Reveal step={2}>
          <p className="mk-small mk-gallery__note">
            كل لوحة هنا مرسومة على شبكة واحدة، وتُصدَّر كما تراها بالضبط.
          </p>
        </Reveal>
      </div>

      <div className="mk-gallery__run">
        <Reveal className="mk-gallery__item mk-gallery__item--lifted">
          <div className="mk-gallery__plate">
            <KufiSvg piece={lifted} label={`${lifted.name}، ${lifted.note}`} className="h-full" />
          </div>
          <div className="mk-gallery__caption">
            <span className="font-medium text-foreground">{lifted.name}</span>
            <span className="mk-gallery__fact">{lifted.note}</span>
          </div>
        </Reveal>

        <div className="mk-gallery__strip">
          {rest.map((piece, index) => (
            <Reveal key={piece.id} step={index + 1} className="mk-gallery__item">
              <div className="mk-gallery__plate">
                <KufiSvg piece={piece} label={`${piece.name}، ${piece.note}`} className="h-full" />
              </div>
              <div className="mk-gallery__caption">
                <span className="font-medium text-foreground">{piece.name}</span>
                <span className="mk-gallery__fact">{piece.note}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
