import Link from "next/link";

const REPO = "https://github.com/AbdSattout/KufiCraft";

/**
 * The close is a single quiet line on the ink ground the closing section
 * already set: what this is, the links, and the year.
 */
export function SiteFooter() {
  return (
    <footer className="mk-footer">
      <div className="mk-footer__line">
        <p className="mk-small">KufiCraft، محرّر الكوفي المربع مفتوح المصدر</p>
        <nav className="mk-footer__links" aria-label="روابط التذييل">
          <a href={REPO} target="_blank" rel="noreferrer" className="mk-link">
            GitHub
          </a>
          <Link href="/app" className="mk-link">
            المحرر
          </Link>
          <Link href="/signup" className="mk-link">
            إنشاء حساب
          </Link>
        </nav>
        <p className="mk-small mk-footer__meta">
          2026 · واجهة عربية بالكامل
        </p>
      </div>
    </footer>
  );
}
