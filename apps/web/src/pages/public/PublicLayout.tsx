import { Link } from 'react-router-dom';
import type { PublicLang } from '../../hooks/usePublicLang';

const LOGO_WHITE =
  'https://res.cloudinary.com/daowx6msw/image/upload/v1763910407/white_logoggfdsdfgdfsgds_bdqrww.png';

interface Props {
  lang: PublicLang;
  setLang: (l: PublicLang) => void;
  dir: string;
  children: React.ReactNode;
}

const nav = {
  en: { home: 'Home', privacy: 'Privacy Policy', terms: 'Terms of Service', contact: 'Contact', login: 'Sign In' },
  he: { home: 'דף הבית', privacy: 'פרטיות', terms: 'תנאי שימוש', contact: 'צור קשר', login: 'התחברות' },
};

export default function PublicLayout({ lang, setLang, dir, children }: Props) {
  const t = nav[lang];

  return (
    <div
      dir={dir}
      className="min-h-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]"
      style={{ textAlign: dir === 'rtl' ? 'right' : 'left' }}
    >
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg-primary)]/90 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/home">
            <img src={LOGO_WHITE} alt="Optive AI" className="h-8 select-none" draggable={false} />
          </Link>
          <div className="flex items-center gap-3">
            <nav className="hidden sm:flex items-center gap-1 text-sm">
              <Link to="/home" className="px-3 py-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">{t.home}</Link>
              <Link to="/privacy" className="px-3 py-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">{t.privacy}</Link>
              <Link to="/terms" className="px-3 py-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">{t.terms}</Link>
            </nav>
            <div className="flex items-center gap-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-0.5">
              {(['en', 'he'] as PublicLang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    lang === l
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <Link
              to="/login"
              className="text-sm px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-bright)] transition-colors"
            >
              {t.login}
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[var(--border)] bg-[var(--bg-card)]">
        <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[var(--text-muted)] text-sm">© 2026 Optive Ltd. All rights reserved.</p>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/home" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">{t.home}</Link>
            <Link to="/privacy" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">{t.privacy}</Link>
            <Link to="/terms" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">{t.terms}</Link>
            <a href="mailto:support@0ptive.com" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">{t.contact}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
