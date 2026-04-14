import { Link } from 'react-router-dom';
import { usePublicLang } from '../../hooks/usePublicLang';
import PublicLayout from './PublicLayout';

const TENTACLE =
  'https://res.cloudinary.com/daowx6msw/image/upload/v1763893433/ChatGPT_Image_Nov_23_2025_12_23_46_PM_tqfwov.png';

interface Content {
  hero: { headline: string; sub: string; cta: string; ctaSub: string };
  features: { title: string; items: { icon: string; title: string; desc: string }[] };
  howItWorks: { title: string; steps: { num: string; title: string; desc: string }[] };
  googleSection: { title: string; body: string; badge: string };
  cta: { title: string; sub: string; button: string };
}

const en: Content = {
  hero: {
    headline: 'AI Voice Agents for Your Business',
    sub: 'Optive AI handles inbound and outbound calls, books appointments directly into Google Calendar, and lets your team focus on what matters.',
    cta: 'Get Started',
    ctaSub: 'Already have an account?',
  },
  features: {
    title: 'Everything You Need',
    items: [
      { icon: '📞', title: '24/7 Call Handling', desc: 'Your AI agent answers every call, day or night, with a natural human-like voice.' },
      { icon: '📅', title: 'Google Calendar Integration', desc: 'Appointments are booked, rescheduled, and canceled directly in your calendar — zero manual work.' },
      { icon: '🧠', title: 'Smart Conversations', desc: 'Powered by the latest LLMs, the agent understands context, answers questions, and handles objections.' },
      { icon: '📊', title: 'Analytics & Insights', desc: 'Track call volume, booking rates, and agent performance from a clean, real-time dashboard.' },
      { icon: '🔒', title: 'Secure & Compliant', desc: 'All data is encrypted in transit and at rest. Google API access adheres to Limited Use requirements.' },
      { icon: '🌐', title: 'Multi-Language', desc: 'Agents communicate fluently in Hebrew, English, and more — matching your customers\' language.' },
    ],
  },
  howItWorks: {
    title: 'How It Works',
    steps: [
      { num: '01', title: 'A customer calls', desc: 'Your AI agent picks up instantly, identifies the caller\'s intent, and responds naturally.' },
      { num: '02', title: 'The agent schedules', desc: 'It checks your Google Calendar for availability and books the appointment in real time.' },
      { num: '03', title: 'You stay informed', desc: 'The dashboard shows every call, booking, and outcome — searchable and filterable.' },
    ],
  },
  googleSection: {
    title: 'Google Calendar — Secure Integration',
    body: 'Optive AI connects to your Google Calendar via official Google APIs. We request only the minimum required permissions and adhere strictly to the Google API Services User Data Policy, including Limited Use requirements. Your calendar data is never sold or used to train AI models.',
    badge: 'Google API Services User Data Policy compliant',
  },
  cta: {
    title: 'Ready to automate your calls?',
    sub: 'Join businesses already using Optive AI to schedule more and work less.',
    button: 'Sign In to Your Account',
  },
};

const he: Content = {
  hero: {
    headline: 'סוכני Voice AI לעסק שלך',
    sub: 'Optive AI מטפל בשיחות נכנסות ויוצאות, מזמין פגישות ישירות ב-Google Calendar, ומאפשר לצוות שלך להתמקד במה שחשוב.',
    cta: 'התחל עכשיו',
    ctaSub: 'כבר יש לך חשבון?',
  },
  features: {
    title: 'כל מה שאתה צריך',
    items: [
      { icon: '📞', title: 'מענה 24/7', desc: 'סוכן ה-AI שלך עונה לכל שיחה, בכל שעה, בקול טבעי ואנושי.' },
      { icon: '📅', title: 'שילוב Google Calendar', desc: 'פגישות נקבעות, משוהות ומבוטלות ישירות ביומן שלך — ללא עבודה ידנית.' },
      { icon: '🧠', title: 'שיחות חכמות', desc: 'מבוסס על מודלי השפה המתקדמים ביותר, הסוכן מבין הקשר, עונה על שאלות ומתמודד עם התנגדויות.' },
      { icon: '📊', title: 'ניתוחים ותובנות', desc: 'עקוב אחר נפח שיחות, שיעורי הזמנה וביצועי הסוכן מדשבורד נקי ובזמן אמת.' },
      { icon: '🔒', title: 'מאובטח ותואם', desc: 'כל הנתונים מוצפנים במעבר ובמנוחה. גישת Google API עומדת בדרישות Limited Use.' },
      { icon: '🌐', title: 'רב-לשוני', desc: 'הסוכנים מתקשרים בשוטף בעברית, אנגלית ועוד — בשפת הלקוחות שלך.' },
    ],
  },
  howItWorks: {
    title: 'איך זה עובד',
    steps: [
      { num: '01', title: 'לקוח מתקשר', desc: 'סוכן ה-AI שלך עונה מיידית, מזהה את כוונת המתקשר ומגיב בצורה טבעית.' },
      { num: '02', title: 'הסוכן מזמין פגישה', desc: 'הוא בודק את Google Calendar שלך לזמינות ומזמין את הפגישה בזמן אמת.' },
      { num: '03', title: 'אתה נשאר מעודכן', desc: 'הדשבורד מציג כל שיחה, הזמנה ותוצאה — עם אפשרות חיפוש וסינון.' },
    ],
  },
  googleSection: {
    title: 'Google Calendar — שילוב מאובטח',
    body: 'Optive AI מתחבר ל-Google Calendar שלך דרך ממשקי API רשמיים של Google. אנו מבקשים רק את ההרשאות המינימליות הנדרשות ועומדים בקפדנות במדיניות נתוני משתמשי שירות Google API, כולל דרישות שימוש מוגבל. נתוני היומן שלך לעולם אינם נמכרים או משמשים לאימון מודלי AI.',
    badge: 'עומד במדיניות נתוני משתמשי שירות Google API',
  },
  cta: {
    title: 'מוכן לאוטומציה של השיחות שלך?',
    sub: 'הצטרף לעסקים שכבר משתמשים ב-Optive AI לתזמון יותר ועבודה פחות.',
    button: 'התחבר לחשבון שלך',
  },
};

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 hover:border-[var(--border-bright)] transition-colors">
      <div className="text-2xl mb-3">{icon}</div>
      <h3 className="font-semibold text-[var(--text-primary)] mb-1.5 text-sm">{title}</h3>
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{desc}</p>
    </div>
  );
}

function Step({ num, title, desc, isLast }: { num: string; title: string; desc: string; isLast: boolean }) {
  return (
    <div className="flex gap-5">
      <div className="flex flex-col items-center">
        <div className="w-10 h-10 rounded-full bg-[var(--accent)]/15 border border-[var(--accent)]/30 flex items-center justify-center text-[var(--accent)] font-bold text-sm flex-shrink-0">
          {num}
        </div>
        {!isLast && <div className="w-px flex-1 bg-[var(--border)] mt-2" />}
      </div>
      <div className="pb-8">
        <h3 className="font-semibold text-[var(--text-primary)] mb-1 text-sm">{title}</h3>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { lang, setLang, dir } = usePublicLang();
  const t = lang === 'en' ? en : he;

  return (
    <PublicLayout lang={lang} setLang={setLang} dir={dir}>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[var(--border)]">
        <img
          src={TENTACLE}
          alt=""
          aria-hidden
          className="absolute bottom-0 end-0 w-[500px] opacity-[0.07] select-none pointer-events-none"
          style={{ filter: 'sepia(1) saturate(4) hue-rotate(220deg) brightness(0.6)' }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,rgba(139,92,246,0.1)_0%,transparent_65%)]" />
        <div className="relative max-w-4xl mx-auto px-6 py-20 sm:py-28">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-[var(--accent)] text-xs font-medium mb-6">
              Optive AI
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold text-[var(--text-primary)] leading-tight mb-5">
              {t.hero.headline}
            </h1>
            <p className="text-[var(--text-secondary)] text-lg leading-relaxed mb-8">
              {t.hero.sub}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link
                to="/login"
                className="px-6 py-3 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium transition-colors shadow-[0_0_24px_rgba(139,92,246,0.3)]"
              >
                {t.hero.cta}
              </Link>
              <span className="text-[var(--text-muted)] text-sm">
                {t.hero.ctaSub}{' '}
                <Link to="/login" className="text-[var(--accent)] hover:underline">
                  {lang === 'en' ? 'Sign in' : 'התחבר'}
                </Link>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-10 text-center">{t.features.title}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {t.features.items.map((f, i) => (
            <FeatureCard key={i} {...f} />
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-[var(--border)] bg-[var(--bg-secondary)]/50">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-10 text-center">{t.howItWorks.title}</h2>
          <div className="max-w-md mx-auto">
            {t.howItWorks.steps.map((step, i) => (
              <Step key={i} {...step} isLast={i === t.howItWorks.steps.length - 1} />
            ))}
          </div>
        </div>
      </section>

      {/* Google compliance section */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-8 sm:p-10">
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">{t.googleSection.title}</h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-5">{t.googleSection.body}</p>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-[var(--accent)] text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
            {t.googleSection.badge}
          </div>
          <div className="mt-5 flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
            <Link to="/privacy" className="hover:text-[var(--text-secondary)] transition-colors underline">
              {lang === 'en' ? 'Privacy Policy' : 'מדיניות פרטיות'}
            </Link>
            <Link to="/terms" className="hover:text-[var(--text-secondary)] transition-colors underline">
              {lang === 'en' ? 'Terms of Service' : 'תנאי שימוש'}
            </Link>
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--text-secondary)] transition-colors underline"
            >
              Google API Services User Data Policy
            </a>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--border)] bg-[var(--bg-secondary)]/50">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-3">{t.cta.title}</h2>
          <p className="text-[var(--text-secondary)] mb-8">{t.cta.sub}</p>
          <Link
            to="/login"
            className="inline-flex px-8 py-3 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium transition-colors shadow-[0_0_24px_rgba(139,92,246,0.3)]"
          >
            {t.cta.button}
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
