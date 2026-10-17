import { SignInButton } from "@/components/auth/sign-in-dialog";
import { RatioCycle } from "./kufi/ratio-cycle";
import { Reveal } from "./reveal";

/**
 * The page closes on the tool's first step: one cell, redrawn while the ink
 * ratio moves from the default to the ends of its range. The figure sits in the same inverted
 * field the footer continues on, so the ink ground runs to the page's end.
 */
export function Closing() {
  return (
    <section className="mk-close">
      <div className="mk-close__grid">
        <div className="mk-close__text">
          <Reveal>
            <h2 className="mk-close__line">ابدأ بخليّة واحدة</h2>
          </Reveal>
          <Reveal step={1}>
            <p className="mk-body mk-close__lede">
              حسابك يحفظ لوحاتك ويزامنها على كل أجهزتك، من أول خلية.
            </p>
          </Reveal>
          <Reveal step={2} className="mk-close__action">
            <SignInButton className="h-11 px-5 text-base" variant="secondary">
              ابدأ الرسم
            </SignInButton>
          </Reveal>
        </div>

        <Reveal step={1} className="mk-close__figure">
          <div data-ui="" className="mk-close__frame">
            <RatioCycle className="h-full" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
