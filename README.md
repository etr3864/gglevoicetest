# Voice AI Platform

מונורפו (pnpm) של פלטפורמת סוכני קול: שיחות נכנסות ויוצאות דרך Telnyx, סוכן AI ב-Gemini Live API (Vertex AI), תמלול Deepgram, PostgreSQL (Prisma), Redis + BullMQ, אחסון הקלטות ב-GCS, ודשבורד React (Vite).

---

## תוכן עניינים

1. [למי מיועד המסמך](#למי-מיועד-המסמך)
2. [מה המערכת עושה — תמונה מלאה](#מה-המערכת-עושה--תמונה-מלאה)
3. [אזהרות והנחות לפני התקנה](#אזהרות-והנחות-לפני-התקנה)
4. [משתני סביבה](#משתני-סביבה)
5. [הרצה מקומית — צעד אחר צעד](#הרצה-מקומית--צעד-אחר-צעד)
6. [מבנה המונורפו (מפורט)](#מבנה-המונורפו-מפורט)
7. [חבילות ותלויות בין פרויקטים](#חבילות-ותלויות-בין-פרויקטים)
8. [זרימות שיחה](#זרימות-שיחה)
9. [Pipeline מדיה (תקציר)](#pipeline-מדיה-תקציר)
10. [מסד נתונים — מודלים עיקריים](#מסד-נתונים--מודלים-עיקריים)
11. [תורים (BullMQ) ו-Workers](#תורים-bullmq-ו-workers)
12. [Routes ב-API](#routes-ב-api)
13. [אימות והרשאות](#אימות-והרשאות)
14. [מפת קבצים לפי תחום](#מפת-קבצים-לפי-תחום)
15. [Frontend (`@voice/web`)](#frontend-voiceweb)
16. [בדיקות בריאות ו-Scaling](#בדיקות-בריאות-ו-scaling)
17. [Deploy ו-CI](#deploy-ו-ci)
18. [מושגים נוספים — שלמות התמונה](#מושגים-נוספים--שלמות-התמונה)
19. [מסמכי עומק](#מסמכי-עומק)
20. [איתור תקלות](#איתור-תקלות)
21. [תחזוקת README](#תחזוקת-readme)

---

## למי מיועד המסמך

| קורא | מה לקרוא |
|------|-----------|
| **מגלה** | [מה המערכת עושה](#מה-המערכת-עושה--תמונה-מלאה), [מבנה המונורפו](#מבנה-המונורפו-מפורט) |
| **מתקין** | [אזהרות](#אזהרות-והנחות-לפני-התקנה), [משתני סביבה](#משתני-סביבה), [הרצה מקומית](#הרצה-מקומית--צעד-אחר-צעד) |
| **מתחזק / מפתח פיצ'ר** | [מושגים נוספים](#מושגים-נוספים--שלמות-התמונה), [תורים ו-Workers](#תורים-bullmq-ו-workers), [מפת קבצים](#מפת-קבצים-לפי-תחום), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

---

## מה המערכת עושה — תמונה מלאה

### למה בנויים כל הרכיבים

- **PostgreSQL + Prisma:** משתמשים, סוכנים, אנשי קשר, שיחות, תמלילים, פגישות, תזכורות, מסמכי ידע, פריטי מדיה, שימוש בעלות ועוד — מקור האמת לנתונים עסקיים.
- **Redis:**  
  - Session של שיחה פעילה (מטא-דאטה + transcript buffer).  
  - BullMQ — תורים לעבודות רקע.  
  - Pub/Sub — שידור אירועים לכל הפודים; ה-SSE מחבר ללקוחות בדשבורד.
- **Telnyx:** SIP, Webhooks לחיי מחזור השיחה, WebSocket למדיה דו-כיוונית (`/ws/media`).
- **Gemini Live API (Vertex):** דיבור בזמן אמת, כלי (function calling), תמלילי קלט/פלט.
- **Deepgram:** תמלול זרם אודיו (לקוח; ואופציונלי לסוכן).
- **GCS:** קבצי MP3 של הקלטות אחרי עיבוד worker.

### מודל מנטלי של שיחה

1. אירוע Telnyx (או job יוצא) יוצר/מעדכן רשומת `Call` ו-session ב-Redis.  
2. **Warmup** (אופציונלי): חיבור מוקדם ל-Gemini ובניית `ProviderConfig` כדי לקצר latency לפני שהלקוח עונה.  
3. WebSocket מדיה: Telnyx שולח PCM → downsample לקלט Gemini → Gemini מחזיר PCM → חזרה ל-Telnyx.  
4. סיום: ניתוק, שמירת תמלילים, עדכון סטטיסטיקות איש קשר, תור לסיכום/Hooks לפי הגדרות.

לתרשימים מלאים (כולל warm/cold path, reconnect ל-Gemini, תזכורות) — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## אזהרות והנחות לפני התקנה

| נושא | פירוט |
|------|--------|
| **גרסאות** | Node.js ≥ 20, pnpm ≥ 9 (`package.json` → `engines`). |
| **אזור זמן** | `TZ=Asia/Jerusalem` ל-API (גם ב-Docker/K8s). לוגיקת תאריכים ב-`apps/api/src/lib/date.ts`. בלי זה — שעות פגישות ותזכורות שגויות. |
| **Vertex AI / Gemini** | מפתחות ב-`GEMINI_API_KEYS` (מאגר מפתחות בקוד). בפרודקשן נדרשות הרשאות GCP (למשל Service Account עם `aiplatform.user`). |
| **Telnyx** | Webhooks חייבים URL ציבורי. אימות חתימה בקוד: `TELNYX_WEBHOOK_PUBLIC_KEY` (PEM או base64) — ראו `telnyx-signature.ts`. אם ב-`.env.example` מופיע שם אחר, יש להתאים ל-`.env`. |
| **Redis** | חובה ל-session, תורים ו-Pub/Sub. |
| **GKE** | WebSocket דורש **session affinity** (sticky) לפוד — אחרת session לא יגיע לאותו פוד. |
| **מגבלת שיחות לפוד** | `MAX_SESSIONS_PER_POD` (ברירת מחדל 25) משפיע על `/health/ready`. |

---

## משתני סביבה

### מקור: `.env.example` (מקומי)

| משתנה | תפקיד |
|--------|--------|
| `DATABASE_URL` | PostgreSQL |
| `REDIS_URL` | Redis (תורים + session + Pub/Sub) |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | טוקני התחברות |
| `TELNYX_API_KEY` | REST Telnyx |
| `TELNYX_WEBHOOK_PUBLIC_KEY` | מפתח ציבורי Ed25519 לאימות webhooks Telnyx |
| `GEMINI_API_KEYS` | רשימה מופרדת בפסיקים — רוטציה ב-`key-pool` |
| `DEEPGRAM_API_KEY` | תמלול |
| `ENCRYPTION_KEY` / `WHATSAPP_CONFIG_KEY` | הצפנת הגדרות (hex 64 תווים) |
| `NGROK_AUTHTOKEN` | אופציונלי לפיתוח עם ngrok |
| `API_URL` | בסיס URL ל-stream Telnyx (חובה בפרודקשן לחייג יוצא) |
| `FRONTEND_URL` | CORS + לינקים |
| `PORT` | ברירת מחדל 3000 ל-API |

### נפוץ בפרודקשן (לא תמיד ב-example)

| משתנה | תפקיד |
|--------|--------|
| `GOOGLE_APPLICATION_CREDENTIALS` | נתיב ל-JSON של Service Account (Vertex) |
| `MAX_SESSIONS_PER_POD` | מכסת שיחות מקבילות לפוד |
| `ALLOWED_ORIGINS` | מקורות CORS נוספים (מופרדים בפסיק) |

טבלה מקוצרת נוספת: [ARCHITECTURE.md](ARCHITECTURE.md) (אנגלית).

---

## הרצה מקומית — צעד אחר צעד

1. `git clone` והתקנה: `pnpm install`

2. `cp .env.example .env` — מלא לפחות DB, Redis, JWT, ומפתחות לשירותים שבהם תשתמש.

3. הרמת תשתית: `pnpm dev`  
   → Postgres 16 ו-Redis 7 (`docker-compose.dev.yml`, פורטים 5432 ו-6379).

4. מיגרציות: `pnpm db:migrate` (או `pnpm db:push` לפיתוח מהיר בלבד).

5. API:  
   ```bash
   export TZ=Asia/Jerusalem
   pnpm dev:api
   ```  
   בדיקה: `curl http://localhost:3000/health`

6. Web (אופציונלי): `pnpm dev:web` — וודא ש-`FRONTEND_URL` ב-`.env` תואם לפורט של Vite (למשל 5173).

**בדיקת image Docker:** [scripts/docker-test.sh](scripts/docker-test.sh) — מריץ קונטיינר, דורש Redis/Postgres זמינים ב-host.

---

## מבנה המונורפו (מפורט)

```
gglvoice/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── index.ts              # Express, health, workers, WebSocket
│   │       ├── routes/               # REST + webhooks
│   │       ├── services/             # לוגיקה עסקית (call, providers, tools, …)
│   │       ├── workers/              # BullMQ processors
│   │       ├── middleware/
│   │       └── lib/                  # אודיו, תאריך, תורים, לוגר, …
│   └── web/
│       └── src/
│           ├── App.tsx, main.tsx
│           ├── pages/                # Login, Dashboard, Agent/*, Admin, Users
│           ├── components/
│           └── hooks/                # useAuth, useAgentEvents (SSE)
├── packages/
│   ├── db/
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── migrations/
│   └── shared/
│       └── src/types/                # טיפוסים משותפים (סוכן, יומן, …)
├── docs/ARCHITECTURE.md              # ארכיטקטורה מלאה בעברית
├── ARCHITECTURE.md                   # סקירה באנגלית
├── k8s/                              # deployment ל-GKE
├── Dockerfile
├── docker-compose.dev.yml
├── vercel.json                       # בניית @voice/web ב-Vercel
├── .github/workflows/                # CI/CD
└── scripts/docker-test.sh
```

---

## חבילות ותלויות בין פרויקטים

| חבילה | תוכן | צריכה |
|--------|------|--------|
| `@voice/db` | Prisma Client + schema | `@voice/api` |
| `@voice/shared` | טיפוסים וקבועים משותפים | `@voice/api`, `@voice/web` |
| `@voice/api` | Backend | db, shared |
| `@voice/web` | Frontend | shared |

בנייה מלאה: `pnpm build` (root).

---

## זרימות שיחה

### שיחה יוצאת (רגילה)

- `POST` ליצירת שיחה יוצאת (ראו routes של agents/outbound) → רשומת `Call` (`queued`) → תור `outbound-calls`.  
- Worker: אימות סוכן, `warmup` (אסינכרוני), `createOutboundCall` ב-Telnyx, עדכון session + `callControlId`.  
- Webhooks: `ringing` → `in_call` → בסיום `hangup` → `endSession` + תור סיכום (אם מופעל).

### שיחה נכנסת

- `call.initiated` → יצירת Call + Contact, session, warmup, `answerCall`.  
- `call.answered` → התחלת stream והקלטה.

### שיחת תזכורת

- Job מתוזמן מ-`reminder-calls` → הקשר מיוחד (`__openingMessage` / `__systemPrompt`) → אותו תור יוצא.  
- בסיום: לוגיקה ב-`reminder.service` — בלי סיכום שיחה רגיל לעיתים.

פירוט: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) סעיפים 5.1–5.3.

---

## Pipeline מדיה (תקציר)

- **כניסה:** PCM מ-Telnyx (למשל 24kHz) → downsample לקלט Gemini (ראו `audio-config.ts`).  
- **יציאה:** אודיו מהמודל → gain/עיבוד → חזרה ל-Telnyx.  
- **גייטינג:** אודיו מהלקוח ל-Gemini מופעל אחרי סיום ברכה/הגדרות `interruptRef` (מניעת הפרעה מוקדמת).  
- **תמלול:** Deepgram לזרם הלקוח; תמליל סוכן אופציונלי.

תרשים מלא: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §5.4.

---

## מסד נתונים — מודלים עיקריים

| מודל | תפקיד קצר |
|------|------------|
| **User** | משתמשי מערכת, היררכיה (הורה-ילדים), הרשאות |
| **Agent** | סוכן קול: prompts, קול, Telnyx, יומן, WhatsApp, מדיה, ידע, `modelConfig` |
| **Contact** | לקוח לפי טלפון, שדות דמוגרפיים, הערות, סטטיסטיקות שיחות |
| **Call** | שיחה אחת: כיוון, סטטוס, סוג (`regular` / `reminder`), הקלטה, הקשר JSON |
| **Utterance** | משפט בתמליל שיחה |
| **Appointment** | פגישה מקושרת ל-Google Calendar + DB מקומי |
| **ScheduledReminder** | תזכורת לפגישה + קישור ל-BullMQ |
| **Knowledge*** / **Media*** | מסמכים, embeddings, פריטי מדיה — לפי schema |

**סטטוסי Call (טיפוסי):** `queued` → `calling` → `ringing` → `in_call` → `completed` / `failed` / `no_answer`.

סכימה מלאה: `packages/db/prisma/schema.prisma`.

---

## תורים (BullMQ) ו-Workers

שמות התורים (מ-`apps/api/src/lib/queue.ts`):

| תור | שם Redis queue |
|-----|----------------|
| שיחות יוצאות | `outbound-calls` |
| הקלטות | `recordings` |
| סיכומי שיחות | `call-summaries` |
| Webhooks כלליים | `webhook-delivery` |
| Webhooks פגישות | `appointment-webhooks` |
| תזכורות | `reminder-calls` |
| שליחת WhatsApp | `whatsapp-send` |
| עיבוד ידע | `knowledge-processing` |
| עיבוד מדיה | `media-processing` |

**Workers** (מופעלים מ-`index.ts`):

| קובץ | תפקיד |
|------|--------|
| `workers/outbound.ts` | חיוג יוצא |
| `services/recording/recording.worker.ts` | הורדת הקלטה מ-Telnyx → GCS |
| `workers/summary.worker.ts` | סיכום שיחה (אם מופעל) |
| `workers/webhook.worker.ts` | משלוח webhooks ליעדים חיצוניים |
| `workers/appointment-webhook.worker.ts` | webhooks לפגישות |
| `workers/reminder.worker.ts` | ביצוע תזכורות מתוזמנות |
| `workers/whatsapp-send.worker.ts` | תור שליחת הודעות |
| `workers/knowledge.worker.ts` | עיבוד מסמכי ידע |
| `workers/media.worker.ts` | עיבוד קבצי מדיה |

**Cron jobs:** `recording.cron.ts`, `knowledge.cron.ts`, `media.cron.ts` — סריקות יתומות / תחזוקה.

---

## Routes ב-API

מרכיב ה-mount ב-`index.ts` (סדר משפיע על התאמת נתיבים):

| קידומת / נתיב | תוכן |
|---------------|------|
| `GET /health`, `/health/live`, `/health/ready` | ליבה / readiness |
| `GET /voices` | רשימת קולות זמינים |
| `/auth` | התחברות / רענון טוקן |
| `/` (חלק מ-outbound) | שיחות יוצאות לפי הגדרות ב-`routes/outbound.ts` |
| `/webhooks` | Telnyx, WhatsApp Meta, וכו' |
| `/agents` + ילדים | סוכנים, יומן, תזכורות — חלק עם `authMiddleware` |
| `/` (events) | SSE לאירועי סוכן |
| `/agents` (מאובטח) | CRUD סוכנים, outbound, … |
| `/` (מאובטח) | שיחות, אנשי קשר, WhatsApp |
| `/recordings` | הקלטות (חלק ללא auth לפי implementation) |
| `/admin` | Super admin בלבד |
| `/dashboard`, `/dashboard/super-admin`, `/dashboard/pricing` | דשבורד עלויות וסטטיסטיקות |
| `/agents/:agentId/knowledge` | ידע |
| `/agents/:agentId/media` | מדיה |

לפרטי נתיבים מדויקים — קרא את הקבצים תחת `apps/api/src/routes/`.

---

## אימות והרשאות

- **JWT:** `middleware/auth.ts` — מגן על רוב נתיבי ה-API למשתמשים מחוברים.  
- **Super Admin:** `requireSuperAdmin` לנתיבי `/admin` וכו'.  
- **API Key לסוכן:** `middleware/apikey.ts` — לפי שימוש ב-routes (מפתח בישות Agent).  
- **Webhooks:** גוף גולמי + חתימה — לא עובר JWT רגיל.

---

## מפת קבצים לפי תחום

### שיחה ו-AI

| קובץ | תיאור |
|------|--------|
| `services/call/media-bridge.ts` | WebSocket `/ws/media`, מפת `activeConnections` |
| `services/call/session.ts` | Redis session, `endSession`, utterances |
| `services/call/warmup.ts` | חימום Gemini, `buildProviderConfig` |
| `services/call/prompt-builder.ts` | פרומפט מערכת, יומן, WhatsApp, מדיה |
| `services/contact-context.ts` | היסטוריית איש קשר לפרומפט |
| `services/providers/gemini/*` | חיבור Vertex, מצב, mapper, reconnect |
| `services/tools/*` | רישום כלים: calendar, builtin, whatsapp, knowledge, media |
| `services/transcription/deepgram.ts` | תמלול |

### טלפוניה ואינטגרציות

| קובץ | תיאור |
|------|--------|
| `services/telnyx.ts` | answer, hangup, חיוג יוצא, הקלטות |
| `lib/telnyx-signature.ts` | אימות חתימת webhook |
| `lib/audio-config.ts` | קבועים, downsample, פרמטרי stream ל-Telnyx |

### יומן, תזכורות, הקלטות

| קובץ | תיאור |
|------|--------|
| `services/calendar/google.ts` | Google Calendar API |
| `services/reminders/reminder.service.ts` | תזכורות, retry, safety scan |
| `services/recording/*` | webhook הקלטה, worker, GCS, cron |

### WhatsApp, ידע, מדיה

| קובץ | תיאור |
|------|--------|
| `services/whatsapp/*` | ספקים (Meta, Wasender, …), שליחה, rate limit |
| `services/knowledge/*` | embeddings, מסמכים, טבלאות, עיבוד |
| `services/media/*` | ספריית מדיה, GCS, ניתוח |

### אירועים בזמן אמת

| קובץ | תיאור |
|------|--------|
| `services/events/pubsub.ts` | Redis Pub/Sub |
| `services/events/sse.manager.ts` | SSE לדשבורד |
| `routes/events.ts` | חיבור EventSource |

---

## Frontend (`@voice/web`)

- **ניווט:** `App.tsx` — דפים: Login, Dashboard, רשימת סוכנים, פרטי סוכן (טאבים).  
- **סוכן:** `pages/Agent/` — Prompt, Calls, Contacts, Calendar, Reminders, Summaries, Settings, WhatsApp, Knowledge, Media.  
- **דשבורד עלויות:** `pages/Dashboard/`, כולל Super Admin.  
- **API:** `lib/api.ts` — בסיס URL ממשתני סביבה של Vite.  
- **אירועים חיים:** `hooks/useAgentEvents.ts` — SSE לעדכון רשימות שיחות וכו'.

בניית פרודקשן: `vercel.json` — בונה `@voice/shared` ואז `@voice/web`.

---

## בדיקות בריאות ו-Scaling

- **`GET /health` / `/health/live`:** תמיד 200 אם התהליך חי.  
- **`GET /health/ready`:** 503 אם:  
  - draining (SIGTERM לפני כיבוי),  
  - `activeConnections` ≥ `MAX_SESSIONS_PER_POD`,  
  - Redis לא זמין.  

פרודקשן: מספר פודים אופקי; affinity ל-WebSocket; סעיף Scaling ב-[ARCHITECTURE.md](ARCHITECTURE.md).

---

## Deploy ו-CI

- **API:** Docker image → Artifact Registry → GKE (`kubectl` / GitHub Actions). Init container מריץ `prisma migrate deploy`.  
- **Web:** Push ל-`main` → Vercel (ראו `vercel.json`).  
- **סודות ב-K8s:** לרוב Secret עם `DATABASE_URL`, `REDIS_URL`, מפתחות וכו'.

פרטים ודומיינים לדוגמה בפרויקט: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §3 ו-§11.

---

## מושגים נוספים — שלמות התמונה

הסעיף הזה מכסה נושאים שלא תמיד בולטים בקריאה ראשונה של ה-README, אבל חיוניים כדי להבין איך כל חלק במערכת מתחבר.

### כלי Gemini (Function Calling)

הסוכן מקבל הגדרות כלים מ-`services/tools/` (רישום ב-`registerBuiltinTools` וכו'). בין הכלים הנפוצים:

| קבוצה | כלים (דוגמאות) |
|--------|-----------------|
| אנשי קשר | `save_contact`, `update_contact`, `get_contact_info`, `save_note` |
| יומן | `check_availability`, `book_appointment`, `get_contact_appointments`, `reschedule_appointment`, `cancel_appointment` |
| תקשורת | `send_whatsapp`, `send_media` |
| ידע | `search_knowledge`, `query_table` |
| שיחה | `end_call`, `transfer_call` |

המיפוי ל-Gemini (כולל `scheduling: SILENT` לכלי רקע) ב-`gemini.mapper.ts` / `gemini.provider.ts`. שינוי התנהגות סוכן = לעיתים שינוי ב-**תיאור הכלי** או ברשימת ה-SILENT.

### הקשר שיחה (`call.context`) ודריסות פרומפט

- **`call.context`** (JSON בשדה השיחה): מוזרק ל-system prompt תחת `--- Call Context ---` (מפתחות שמתחילים ב-`__` מסוננים החוצה מהטקסט הציבורי).
- **דריסות פנימיות:** `__systemPrompt` / `__openingMessage` — משמשים למשל **שיחות תזכורת** (תבנית מול מצב AI). מטופלים ב-`warmup.ts` / `buildProviderConfig`.
- **`buildContactContext`:** לא תלוי בכלי — מושך מ-DB לפי טלפון ומוסיף היסטוריה ותורים לפרומפט לפני השיחה.

### שני סוגי Webhooks *יוצאים* מהמערכת

אל תבלבל בין:

| סוג | שדות ב-Agent (דוגמה) | תור / שירות |
|-----|----------------------|-------------|
| **סיכום שיחה** | `webhookUrl`, `webhookSecret` | `webhook-delivery` אחרי סיכום |
| **אירועי פגישה** | `appointmentWebhookUrl`, `appointmentWebhookSecret` | `appointment-webhooks` |

שניהם עוברים workers נפרדים — ראו `webhook.worker.ts` לעומת `appointment-webhook.worker.ts`.

### משתמשים והיררכיה

- **User** כולל `parentId` — היררכיה ארגונית (הורה־ילדים).
- **Super Admin** — נתיבי `/admin` ודשבורד super-admin; שאר המשתמשים רואים סוכנים לפי שיוך (`userId` על Agent).

### מיקום `.env` ו-Frontend

- ה-API טוען `.env` מ**שורש המונורפו**: ב-`index.ts` מוגדר `dotenv.config({ path: '../../.env' })` ביחס ל-`apps/api` — הקובץ צריך לשבת ב-`gglvoice/.env`, לא רק בתוך `apps/api`.
- ה-Web משתמש ב-**`VITE_API_URL`** (אופציונלי): ראו `apps/web/src/lib/api.ts`. אם ריק, הבסיס הוא `window.location.origin` או `/` — חשוב כשה-API וה-UI על דומיינים שונים.

### Telnyx: AMD וחיוג

- **Answering Machine Detection** מכוון ל-`disabled` בחיוג יוצא — לפי המסמכים הפנימיים, AMD של Telnyx לא אמין על מספרים ישראליים.
- פרמטרי stream (כתובת WebSocket, codec, bidirectional) מרוכזים ב-`audio-config.ts` / `telnyx.ts`.

### Gemini: שיחות ארוכות ו-Reconnect

- סשן Live עלול להיסגר אחרי כ-10–15 דקות; `GeminiProvider` מבצע **reconnect** עם היסטוריה ו-buffer אודיו כשהשיחה עדיין פעילה.
- פירוט: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §7.

### WhatsApp: ספקים והצפנה

- שדה `whatsappProvider` על הסוכן בוחר מימוש (למשל Meta / Wasender) דרך `factory`.
- `whatsappConfig` נשמר **מוצפן** (`WHATSAPP_CONFIG_KEY` + `config-crypto.ts`). בלי מפתח עקבי — לא ניתן לפענח הגדרות קיימות.

### ידע (RAG) ומדיה — שרשרת עיבוד (רעיון)

1. **העלאה** דרך API (נתיבי `knowledge` / `media` תחת `/agents/:agentId/...`).
2. **תור** `knowledge-processing` או `media-processing`.
3. **Worker:** חילוץ טקסט / דחיסה / embeddings / ניתוח תמונה לפי סוג.
4. **שימוש בשיחה:** כלים `search_knowledge`, `query_table`, `send_media` + קטעים ב-`prompt-builder` / warmup.

למגבלות טוקנים ו-cron-ים — `knowledge.cron.ts`, `media.cron.ts`.

### עלויות, שימוש ודשבורד

- נתוני שימוש (Telnyx, Gemini, Deepgram, WhatsApp וכו') נאגרים לפי סוכן/חודש (`usage` ב-DB — ראו schema).
- נתיבי `/dashboard` ו-`/dashboard/pricing` + `services/dashboard/` — תמחור וסיכומים לניהול.

### בדיקות אוטומטיות

- אין כרגע חבילת E2E מתועדת במונורפו; **`pnpm lint`** מריץ `tsc --noEmit` על החבילות. בדיקות אינטגרציה לשיחה אמיתית דורשות Telnyx + מפתחות חיים.

---

## מסמכי עומק

| מסמך | תוכן |
|------|------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | ארכיטקטורה מלאה בעברית: DB, flows, תזכורות, media, SSE, reconnect Gemini, deploy |
| [ARCHITECTURE.md](ARCHITECTURE.md) | סקירה באנגלית + טבלת env |

---

## איתור תקלות

1. **API לא עולה:** Redis זמין? `DATABASE_URL` תקין? הרץ מיגרציות.  
2. **Ready 503:** Redis, מכסת שיחות, או draining.  
3. **שיחה בלי אודיו / ניתוק:** לוגים `bridge`, `gemini:provider`; Telnyx `stream_url` ו-`API_URL`.  
4. **Webhooks לא מגיעים:** URL ציבורי, חתימה, firewall.  
5. **תזכורות לא יורות:** תור `reminder-calls`, safety scan, הגדרות `calendarConfig.reminders`.  

רשימת "נקודות קריטיות" נוספת: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §12.

---

## תחזוקת README

כשמוסיפים **worker**, **תור**, **route** או **מודול שירות** — עדכן את הטבלאות הרלוונטיות בקובץ זה כדי שמפתח חדש לא יפספס נקודת כניסה.
