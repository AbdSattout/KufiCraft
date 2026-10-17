import { ArrowLeft } from "lucide-react";
import { SignInButton, SignInLink } from "@/components/auth/sign-in-dialog";
import { RatioInstrument } from "./kufi/instrument";
import { Reveal } from "./reveal";

/**
 * First screen: the claim on the start edge, the editor's own instrument —
 * a drawing on the cell grid plus the ink-ratio control that redraws it — on
 * the other side. The instrument carries `data-ui`: it is a fragment of the
 * editor, shown at real size.
 */
export function Hero() {
  return (
    <section className="mk-hero">
      <div className="mk-hero__grid">
        <div className="mk-hero__text">
          <Reveal>
            <h1 className="mk-hero__line">الكوفي المربع، خليّة خليّة</h1>
          </Reveal>
          <Reveal step={1}>
            <p className="mk-body mk-hero__lede">
              ارسم لوحة الكوفي المربع على شبكة مربعة أو دائرية، واضبط نسبة
              الحبر، ثم صدّرها SVG أو PNG.
            </p>
          </Reveal>
          <Reveal step={2} className="mk-hero__actions">
            <SignInButton className="h-11 px-5 text-base">
              ابدأ الرسم
            </SignInButton>
            <SignInLink className="mk-link mk-body">
              افتح المحرر
              <ArrowLeft
                aria-hidden
                className="size-4 transition-transform group-hover:-translate-x-1"
              />
            </SignInLink>
          </Reveal>
        </div>

        <Reveal step={1} className="mk-hero__stage">
          <RatioInstrument />
        </Reveal>
      </div>
    </section>
  );
}
