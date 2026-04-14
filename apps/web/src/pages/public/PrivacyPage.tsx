import { usePublicLang } from '../../hooks/usePublicLang';
import PublicLayout from './PublicLayout';

type ListItem = string | { text: string; href: string };

type Item =
  | string
  | { list: ListItem[] }
  | { highlight: string }
  | { link: string; href: string; prefix?: string; suffix?: string };

interface DocSection {
  title: string;
  items: Item[];
}

interface PageContent {
  title: string;
  lastUpdated: string;
  sections: DocSection[];
}

const en: PageContent = {
  title: 'Privacy Policy',
  lastUpdated: 'Last Updated: February 2026',
  sections: [
    {
      title: '1. Introduction',
      items: [
        'Optive Ltd. ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our AI-powered voice agent platform ("Optive AI").',
      ],
    },
    {
      title: '2. Information We Collect',
      items: [
        'Account Information: Email address and name for authentication purposes.',
        'Google Calendar Data: When you connect your Google Calendar, we access:',
        { list: ['Calendar events (title, date, time, description)', 'Free/busy availability information', 'Calendar metadata'] },
        'Voice Call Data: Voice interactions processed by our AI agents for automated call handling and appointment scheduling.',
        'Usage Data: Service logs and analytics used to maintain and improve our platform.',
      ],
    },
    {
      title: '3. How We Use Your Information',
      items: [
        { list: [
          'To provide and maintain our AI voice agent services',
          'To schedule and manage appointments via Google Calendar integration',
          'To process and handle voice calls through AI agents',
          'To authenticate and secure your account',
          'To improve and optimize our platform',
        ]},
      ],
    },
    {
      title: '4. Data Storage and Security',
      items: [
        'Your data is stored on secure servers with encryption at rest and in transit. We implement industry-standard security measures including:',
        { list: [
          'SSL/TLS encryption for all data transfers',
          'Secure token storage for API credentials',
          'Regular security audits and monitoring',
          'Access controls and authentication requirements',
        ]},
      ],
    },
    {
      title: '5. Information Collected via Google API Services',
      items: [
        'When you connect your Google Calendar, we request access to the following Google API scope:',
        { highlight: 'https://www.googleapis.com/auth/calendar' },
        'This access enables Optive AI voice agents to:',
        { list: [
          'Read calendar availability (free/busy information) to avoid scheduling conflicts',
          'Create appointments on your behalf following voice interactions',
          'Update or reschedule existing appointments upon request',
          'Cancel appointments upon confirmed request',
        ]},
        'Google Calendar data is stored on secure, encrypted servers and is used exclusively for scheduling and appointment management. No Google user data is used for advertising, marketing, or any purpose unrelated to the core scheduling features of our platform.',
      ],
    },
    {
      title: '6. Sharing of Google User Data',
      items: [
        'We do not share, transfer, or disclose Google user data to any third party, except as strictly necessary to provide the scheduling functionality described in this policy (e.g., our hosting provider, located in Frankfurt, EU).',
        'We do not sell Google user data to any third party under any circumstances.',
        'We do not use Google User Data to train, retrain, or improve any machine learning or AI models, including third-party models.',
        'We do not allow humans to read your Google User Data unless we have obtained your explicit affirmative agreement, or it is strictly necessary for security or legal investigations.',
      ],
    },
    {
      title: '7. Third-Party Services',
      items: [
        'We integrate with the following third-party services:',
        { list: [
          'Google Calendar API — Calendar management and scheduling',
          'Telnyx — Voice call processing and telephony',
          'AI Services (Anthropic, Google, OpenAI) — Natural language processing',
        ]},
        'We do not sell, trade, or rent your personal information to third parties.',
      ],
    },
    {
      title: '8. Data Retention',
      items: [
        { link: 'myaccount.google.com/permissions', href: 'https://myaccount.google.com/permissions', prefix: 'We retain your data for as long as your account is active or as needed to provide services. Google Calendar tokens are stored securely and can be revoked at any time through your Google Account settings at ', suffix: '.' },
      ],
    },
    {
      title: '9. Your Rights',
      items: [
        'You have the right to:',
        { list: [
          'Access your personal data',
          'Request correction of inaccurate data',
          'Request deletion of your data',
          { text: 'Revoke Google Calendar access at any time via ', href: 'https://myaccount.google.com/permissions' },
          'Export your data',
        ]},
        'To exercise any of these rights, contact us at support@0ptive.com.',
      ],
    },
    {
      title: '10. Google API Services User Data Policy',
      items: [
        {
          highlight:
            "Our app's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.",
        },
        'Our privacy practices regarding Google User Data are fully described in Sections 5 and 6 of this policy.',
        {
          link: 'Google API Services User Data Policy',
          href: 'https://developers.google.com/terms/api-services-user-data-policy',
          prefix: 'Full policy available at: ',
        },
      ],
    },
    {
      title: '11. Contact Us',
      items: [
        'For questions about this Privacy Policy or to exercise your rights, please contact us:',
        { list: ['Email: support@0ptive.com', 'Phone: +972-52-300-6544'] },
      ],
    },
  ],
};

const he: PageContent = {
  title: 'מדיניות פרטיות',
  lastUpdated: 'עדכון אחרון: פברואר 2026',
  sections: [
    {
      title: '1. מבוא',
      items: [
        'Optive Ltd. ("אנו", "שלנו") מחויבת להגנה על פרטיותך. מדיניות פרטיות זו מסבירה כיצד אנו אוספים, משתמשים, מגלים ומגנים על המידע שלך בעת שימוש בפלטפורמת סוכני ה-Voice AI שלנו ("Optive AI").',
      ],
    },
    {
      title: '2. מידע שאנו אוספים',
      items: [
        'פרטי חשבון: כתובת אימייל ושם לצרכי אימות.',
        'נתוני Google Calendar: כאשר אתה מחבר את Google Calendar שלך, אנו ניגשים ל:',
        { list: ['אירועי יומן (כותרת, תאריך, שעה, תיאור)', 'מידע זמינות (פנוי/תפוס)', 'מטא-נתוני יומן'] },
        'נתוני שיחות קוליות: שיחות המעובדות על ידי סוכני ה-AI שלנו לטיפול אוטומטי בשיחות וקביעת פגישות.',
        'נתוני שימוש: לוגים וניתוחים לשיפור השירות.',
      ],
    },
    {
      title: '3. כיצד אנו משתמשים במידע שלך',
      items: [
        { list: [
          'לספק ולתחזק את שירותי סוכן ה-Voice AI שלנו',
          'לתזמן ולנהל פגישות דרך שילוב Google Calendar',
          'לעבד ולטפל בשיחות קוליות דרך סוכני AI',
          'לאמת ולאבטח את חשבונך',
          'לשפר ולייעל את הפלטפורמה שלנו',
        ]},
      ],
    },
    {
      title: '4. אחסון נתונים ואבטחה',
      items: [
        'הנתונים שלך מאוחסנים בשרתים מאובטחים עם הצפנה במנוחה ובמעבר. אנו מיישמים אמצעי אבטחה תקניים כולל:',
        { list: [
          'הצפנת SSL/TLS לכל העברות הנתונים',
          'אחסון אסימוני API מאובטח',
          'ביקורות אבטחה ומעקב קבועים',
          'בקרות גישה ודרישות אימות',
        ]},
      ],
    },
    {
      title: '5. מידע שנאסף דרך שירותי Google API',
      items: [
        'כאשר אתה מחבר את Google Calendar שלך, אנו מבקשים גישה לסקופ הבא:',
        { highlight: 'https://www.googleapis.com/auth/calendar' },
        'גישה זו מאפשרת לסוכני Optive AI לבצע:',
        { list: [
          'קריאת זמינות יומן (מידע פנוי/תפוס) למניעת התנגשויות תיאום',
          'יצירת פגישות בשמך בעקבות שיחות קוליות',
          'עדכון או שינוי מועד פגישות קיימות על פי בקשה',
          'ביטול פגישות על פי אישור',
        ]},
        'נתוני Google Calendar מאוחסנים בשרתים מאובטחים ומוצפנים ומשמשים אך ורק לפונקציונליות תיאום הפגישות המתוארת. לא נעשה שימוש בנתוני Google לפרסום, שיווק, או כל מטרה שאינה קשורה לתכונות התיאום המרכזיות.',
      ],
    },
    {
      title: '6. שיתוף נתוני Google עם צדדים שלישיים',
      items: [
        'אנו לא משתפים, מעבירים או מגלים נתוני Google לכל צד שלישי, אלא כנדרש בהחלט לצורך אספקת פונקציונליות התיאום המתוארת (למשל, ספק האחסון שלנו, הממוקם בפרנקפורט, האיחוד האירופי).',
        'אנו לא מוכרים נתוני Google לכל צד שלישי בשום נסיבות.',
        'אנו לא משתמשים ב-Google User Data לאימון, אימון מחדש, או שיפור מודלי למידת מכונה או AI כלשהם, כולל מודלי צד שלישי.',
        'אנו לא מאפשרים לבני אדם לקרוא את Google User Data שלך, אלא אם קיבלנו את הסכמתך המפורשת, או שהדבר נחוץ בהחלט לצרכי חקירות אבטחה או משפטיות.',
      ],
    },
    {
      title: '7. שירותי צד שלישי',
      items: [
        'אנו משתלבים עם שירותי הצד השלישי הבאים:',
        { list: [
          'Google Calendar API — ניהול יומן ותיאום',
          'Telnyx — עיבוד שיחות קוליות וטלפוניה',
          'שירותי AI (Anthropic, Google, OpenAI) — עיבוד שפה טבעית',
        ]},
        'אנו לא מוכרים, סוחרים, או משכירים את המידע האישי שלך לצדדים שלישיים.',
      ],
    },
    {
      title: '8. שמירת נתונים',
      items: [
        { link: 'myaccount.google.com/permissions', href: 'https://myaccount.google.com/permissions', prefix: 'אנו שומרים את הנתונים שלך כל עוד חשבונך פעיל או כנדרש לאספקת שירותים. אסימוני Google Calendar מאוחסנים בצורה מאובטחת וניתן לבטלם בכל עת דרך הגדרות חשבון Google שלך בכתובת ', suffix: '.' },
      ],
    },
    {
      title: '9. זכויותיך',
      items: [
        'יש לך הזכות ל:',
        { list: [
          'גישה לנתונים האישיים שלך',
          'בקשת תיקון נתונים לא מדויקים',
          'בקשת מחיקת הנתונים שלך',
          { text: 'ביטול גישת Google Calendar בכל עת דרך ', href: 'https://myaccount.google.com/permissions' },
          'יצוא הנתונים שלך',
        ]},
        'לממש זכויות אלה, פנה אלינו בכתובת support@0ptive.com.',
      ],
    },
    {
      title: '10. מדיניות נתוני משתמשי שירות Google API',
      items: [
        {
          highlight:
            "השימוש שלנו ואספקתנו לאפליקציה אחרת של מידע שהתקבל מ-Google APIs יעמוד במדיניות נתוני משתמשי שירות Google API, כולל דרישות השימוש המוגבל (Limited Use).",
        },
        'נוהגי הפרטיות שלנו בנוגע ל-Google User Data מתוארים במלואם בסעיפים 5 ו-6 של מדיניות זו.',
        {
          link: 'Google API Services User Data Policy',
          href: 'https://developers.google.com/terms/api-services-user-data-policy',
          prefix: 'המדיניות המלאה זמינה בכתובת: ',
        },
      ],
    },
    {
      title: '11. צור קשר',
      items: [
        'לשאלות בנוגע למדיניות פרטיות זו או למימוש זכויותיך, אנא פנה אלינו:',
        { list: ['אימייל: support@0ptive.com', 'טלפון: +972-52-300-6544'] },
      ],
    },
  ],
};

function renderListItem(li: ListItem, j: number) {
  if (typeof li === 'string') return <li key={j}>{li}</li>;
  return (
    <li key={j}>
      {li.text}
      <a href={li.href} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline hover:text-[var(--accent-hover)]">
        {li.href.replace('https://', '')}
      </a>
    </li>
  );
}

function renderItem(item: Item, i: number) {
  if (typeof item === 'string') {
    return <p key={i}>{item}</p>;
  }
  if ('list' in item) {
    return (
      <ul key={i} className="list-disc list-inside space-y-1 ps-2">
        {item.list.map((li, j) => renderListItem(li, j))}
      </ul>
    );
  }
  if ('highlight' in item) {
    return (
      <p key={i} className="border-s-2 border-[var(--accent)] ps-3 text-[var(--text-primary)] font-medium bg-[var(--accent-glow)] py-2 rounded-e-lg">
        {item.highlight}
      </p>
    );
  }
  if ('link' in item) {
    return (
      <p key={i}>
        {item.prefix}
        <a href={item.href} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline hover:text-[var(--accent-hover)]">
          {item.link}
        </a>
        {item.suffix}
      </p>
    );
  }
}

function Section({ section }: { section: DocSection }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-[var(--text-primary)] mb-3 pb-2 border-b border-[var(--border)]">
        {section.title}
      </h2>
      <div className="space-y-2.5 text-sm text-[var(--text-secondary)] leading-relaxed">
        {section.items.map((item, i) => renderItem(item, i))}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  const { lang, setLang, dir } = usePublicLang();
  const content = lang === 'en' ? en : he;

  return (
    <PublicLayout lang={lang} setLang={setLang} dir={dir}>
      <article className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">{content.title}</h1>
          <p className="text-[var(--text-muted)] text-sm">{content.lastUpdated}</p>
        </div>
        {content.sections.map((s, i) => (
          <Section key={i} section={s} />
        ))}
      </article>
    </PublicLayout>
  );
}
