import { usePublicLang } from '../../hooks/usePublicLang';
import PublicLayout from './PublicLayout';

type Item =
  | string
  | { list: string[] }
  | { highlight: string };

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
  title: 'Terms of Service',
  lastUpdated: 'Last Updated: February 2026',
  sections: [
    {
      title: '1. Acceptance of Terms',
      items: [
        'By accessing or using the Optive AI platform operated by Optive Ltd. ("the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the Service.',
      ],
    },
    {
      title: '2. Description of Service',
      items: [
        'Optive AI is an AI-powered platform that enables automated voice call handling and integrates with Google Calendar for scheduling and appointment management. The Service uses artificial intelligence to process and respond to voice interactions on behalf of the authorized business user.',
      ],
    },
    {
      title: '3. User Accounts',
      items: [
        { list: [
          'You must provide accurate and complete information when creating an account',
          'You are responsible for maintaining the security of your account credentials',
          'You must notify us immediately of any unauthorized access',
          'One account per user; account sharing is prohibited',
        ]},
      ],
    },
    {
      title: '4. Acceptable Use',
      items: [
        'You agree NOT to use the Service to:',
        { list: [
          'Conduct spam, unsolicited calls, or harassment',
          'Violate any applicable laws or regulations',
          'Infringe on intellectual property rights',
          'Distribute malware or harmful content',
          'Impersonate others or misrepresent your identity',
        ]},
      ],
    },
    {
      title: '5. Google Calendar Integration',
      items: [
        'By connecting your calendar, you explicitly authorize the Optive AI agent to act as your representative in reading and writing to your Google Calendar based on customer interactions.',
        'When you connect your Google Calendar, you authorize Optive AI to access and manage calendar events on your behalf. This includes reading availability, creating, updating, and canceling appointments as directed through voice interactions.',
        'You can revoke this access at any time through your Google Account settings at myaccount.google.com/permissions. We comply with Google\'s API Services User Data Policy.',
        { highlight: 'We do not use Google User Data to train, retrain, or improve any machine learning or AI models, including third-party models.' },
        { highlight: "Our app's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements." },
      ],
    },
    {
      title: '6. AI-Generated Content',
      items: [
        'Our Service uses AI to manage automated voice responses and scheduling decisions. While we strive for accuracy, AI-generated responses may contain errors. You are responsible for reviewing and verifying automated scheduling decisions before they impact critical operations.',
        'The AI agent acts on behalf of the authorized user. You remain responsible for the accuracy of information communicated to your customers.',
      ],
    },
    {
      title: '7. Intellectual Property',
      items: [
        'The Service, including its design, features, and content, is owned by Optive Ltd. and protected by applicable intellectual property laws. You retain ownership of your data and content.',
      ],
    },
    {
      title: '8. Limitation of Liability',
      items: [
        { highlight: 'THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. WE ARE NOT LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES ARISING FROM YOUR USE OF THE SERVICE.' },
      ],
    },
    {
      title: '9. Termination',
      items: [
        'We reserve the right to suspend or terminate your account for violations of these Terms. Upon termination, your right to use the Service ceases immediately. You may also delete your account at any time by contacting support@0ptive.com.',
      ],
    },
    {
      title: '10. Changes to Terms',
      items: [
        'We may update these Terms from time to time. Continued use of the Service after changes constitutes acceptance of the updated Terms.',
      ],
    },
    {
      title: '11. Governing Law',
      items: [
        'These Terms are governed by the laws of the State of Israel. Any disputes shall be resolved in the competent courts of Israel.',
      ],
    },
    {
      title: '12. Contact',
      items: [
        'For questions about these Terms, please contact us:',
        { list: ['Email: support@0ptive.com', 'Phone: +972-52-300-6544'] },
      ],
    },
  ],
};

const he: PageContent = {
  title: 'תנאי שימוש',
  lastUpdated: 'עדכון אחרון: פברואר 2026',
  sections: [
    {
      title: '1. קבלת התנאים',
      items: [
        'על ידי גישה לפלטפורמת Optive AI המופעלת על ידי Optive Ltd. ("השירות") או השימוש בה, אתה מסכים לתנאי שימוש אלה. אם אינך מסכים לתנאים אלה, אל תשתמש בשירות.',
      ],
    },
    {
      title: '2. תיאור השירות',
      items: [
        'Optive AI היא פלטפורמה מבוססת AI המאפשרת טיפול אוטומטי בשיחות קוליות ומשתלבת עם Google Calendar לתזמון וניהול פגישות. השירות משתמש בבינה מלאכותית לעיבוד ומענה לאינטראקציות קוליות בשם משתמש העסקי המורשה.',
      ],
    },
    {
      title: '3. חשבונות משתמשים',
      items: [
        { list: [
          'עליך לספק מידע מדויק ומלא בעת יצירת חשבון',
          'אתה אחראי לשמירה על אבטחת אישורי החשבון שלך',
          'עליך להודיע לנו מיידית על כל גישה לא מורשית',
          'חשבון אחד למשתמש; שיתוף חשבון אסור',
        ]},
      ],
    },
    {
      title: '4. שימוש מותר',
      items: [
        'אתה מסכים לא להשתמש בשירות כדי:',
        { list: [
          'לבצע ספאם, שיחות לא רצויות, או הטרדות',
          'להפר חוקים או תקנות חלים',
          'לפגוע בזכויות קניין רוחני',
          'להפיץ תוכנות זדוניות או תוכן מזיק',
          'להתחזות לאחרים או להציג מצג שווא',
        ]},
      ],
    },
    {
      title: '5. שילוב Google Calendar',
      items: [
        'על ידי חיבור היומן שלך, אתה מרשה במפורש לסוכן Optive AI לפעול כנציגך בקריאה וכתיבה ל-Google Calendar שלך בהתבסס על אינטראקציות עם לקוחות.',
        'כאשר אתה מחבר את Google Calendar שלך, אתה מרשה ל-Optive AI לגשת ולנהל אירועי יומן בשמך. זה כולל קריאת זמינות, יצירת, עדכון וביטול פגישות כפי שהונחה דרך אינטראקציות קוליות.',
        'תוכל לבטל גישה זו בכל עת דרך הגדרות חשבון Google שלך בכתובת myaccount.google.com/permissions. אנו עומדים במדיניות שירות API של Google.',
        { highlight: 'אנו לא משתמשים ב-Google User Data לאימון, אימון מחדש, או שיפור מודלי למידת מכונה או AI כלשהם, כולל מודלי צד שלישי.' },
        { highlight: 'השימוש שלנו ואספקתנו לאפליקציה אחרת של מידע שהתקבל מ-Google APIs יעמוד במדיניות נתוני משתמשי שירות Google API, כולל דרישות השימוש המוגבל (Limited Use).' },
      ],
    },
    {
      title: '6. תוכן שנוצר על ידי AI',
      items: [
        'השירות שלנו משתמש ב-AI לניהול תגובות קוליות אוטומטיות והחלטות תזמון. למרות שאנו שואפים לדיוק, תגובות שנוצרו על ידי AI עשויות להכיל שגיאות. אתה אחראי לבדיקת ואימות החלטות תזמון אוטומטיות לפני שהן משפיעות על פעולות קריטיות.',
        'סוכן ה-AI פועל בשם המשתמש המורשה. אתה נשאר אחראי לדיוק המידע שנמסר ללקוחותיך.',
      ],
    },
    {
      title: '7. קניין רוחני',
      items: [
        'השירות, כולל עיצובו, תכונותיו ותוכנו, הוא בבעלות Optive Ltd. ומוגן על ידי חוקי קניין רוחני. אתה שומר על בעלות הנתונים והתוכן שלך.',
      ],
    },
    {
      title: '8. הגבלת אחריות',
      items: [
        { highlight: 'השירות ניתן "כפי שהוא" ללא כל אחריות. אנו לא אחראים לנזקים עקיפים, מקריים, מיוחדים, או תוצאתיים הנובעים מהשימוש שלך בשירות.' },
      ],
    },
    {
      title: '9. סיום',
      items: [
        'אנו שומרים לעצמנו את הזכות להשעות או לסגור את חשבונך בגין הפרות של תנאים אלה. עם הסיום, זכותך להשתמש בשירות מסתיימת מיידית. תוכל גם למחוק את חשבונך בכל עת על ידי פנייה אל support@0ptive.com.',
      ],
    },
    {
      title: '10. שינויים בתנאים',
      items: [
        'אנו עשויים לעדכן תנאים אלה מעת לעת. המשך השימוש בשירות לאחר שינויים מהווה קבלה של התנאים המעודכנים.',
      ],
    },
    {
      title: '11. דין חל',
      items: [
        'תנאים אלה כפופים לדיני מדינת ישראל. כל מחלוקת תיפתר בבתי המשפט המוסמכים בישראל.',
      ],
    },
    {
      title: '12. צור קשר',
      items: [
        'לשאלות בנוגע לתנאים אלה, אנא פנה אלינו:',
        { list: ['אימייל: support@0ptive.com', 'טלפון: +972-52-300-6544'] },
      ],
    },
  ],
};

function renderItem(item: Item, i: number) {
  if (typeof item === 'string') return <p key={i}>{item}</p>;
  if ('list' in item) {
    return (
      <ul key={i} className="list-disc list-inside space-y-1 ps-2">
        {item.list.map((li, j) => <li key={j}>{li}</li>)}
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

export default function TermsPage() {
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
