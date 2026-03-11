# ארכיטקטורת הפרויקט – Voice AI Platform

מסמך זה מתאר את מבנה הפרויקט, השכבות, התשתיות והקבצים המרכזיים – לצורך עבודה נוחה בפרודקשן ובפיתוח.

---

## 1. סקירה כללית

**מה המערכת עושה:** פלטפורמת סוכני קול (Voice AI): סוכנים מקושרים ל-Telnyx ולמודל Gemini, מטפלים בשיחות נכנסות ויוצאות, עם כלים (tools), תמלולים, ולוח שנה.

**סט্যাক:** Monorepo (pnpm), Backend: Node.js + Express + Prisma, Frontend: React + Vite, DB: PostgreSQL, Queue: Redis + BullMQ, טלפוניה: Telnyx, AI: Gemini Live API, תמלול: Deepgram.

---

## 2. מבנה הפרויקט (קבצים ותיקיות)

```
gglvoice/
├── apps/
│   ├── api/                    # Backend – Express, WebSocket, workers
│   │   └── src/
│   │       ├── index.ts        # כניסה, CORS, routes, Redis, WebSocket, worker
│   │       ├── lib/            # שירותי ליבה: redis, queue, logger, constants, audio, audio-config, phone
│   │       ├── middleware/     # auth, apikey, error-handler
│   │       ├── routes/         # auth, agents, calls, contacts, outbound, admin, calendar, webhooks, events
│   │       └── services/       # call (media-bridge, warmup, session, prompt-builder), providers (gemini), tools, telnyx, transcription, contact-context, calendar, events (pubsub, sse)
│   │       └── workers/        # outbound – jobs לחימום + חיוג שיחות יוצאות
│   │
│   └── web/                    # Frontend – React, Vite
│       └── src/
│           ├── App.tsx, main.tsx
│           ├── lib/            # api, cn, auth
│           ├── hooks/          # useAuth, useAgentEvents
│           ├── components/     # Layout, ui (Button, Card, Input, Toast, Toggle, Badge)
│           └── pages/          # Login, Agent (List, Detail, Calendar, OutboundCall, ContactDrawer, CallDetail), Admin
│
├── packages/
│   ├── db/                     # Prisma – schema, client, migrations
│   │   └── prisma/schema.prisma
│   └── shared/                 # קוד משותף (אם קיים)
│
├── k8s/                        # Kubernetes – deployment ל-API
├── .github/workflows/          # CI/CD – build Docker, push ל-GCP, deploy ל-GKE
├── Dockerfile                  # Multi-stage build ל-API בלבד
├── docker-compose.dev.yml      # Postgres + Redis לפיתוח
└── docs/
    └── ARCHITECTURE.md         # המסמך הזה
```

---

## 3. תשתיות (פרודקשן ופיתוח)

### 3.1 ענן (פרודקשן)

| רכיב | תשתית | הערות |
|------|--------|--------|
| **API** | GCP – GKE (Kubernetes) | Region: `me-west1`, image מ-Artifact Registry |
| **Image** | `me-west1-docker.pkg.dev/gen-lang-client-0546829339/voice-ai/voice-api` | נבנה ב-GitHub Actions, נדחף כ-`:latest` ו-`:sha` |
| **Cluster** | `voice-ai-cluster` | GKE באותו region |
| **דומיין API** | `https://voiceapi.0ptive.com` | מופיע ב-K8s כ-API_URL |
| **דומיין Frontend** | `https://voiceapp.0ptive.com` | מופיע כ-FRONTEND_URL; CORS גם ל-`*.vercel.app` |
| **DB** | PostgreSQL | דרך `DATABASE_URL` (לא בתוך repo – כנראה Cloud SQL או שירות מנוהל) |
| **Redis** | Redis | דרך `REDIS_URL` – תור BullMQ ו-PubSub (אירועים) |

### 3.2 פיתוח מקומי

- **DB:** Postgres 16 ב-`docker-compose.dev.yml` (פורט 5432, DB: `voice_db`).
- **Redis:** Redis 7 ב-`docker-compose.dev.yml` (פורט 6379).
- **הרצה:** `pnpm dev:api` / `pnpm dev:web`, או `pnpm dev` עם Docker Compose ל-DB+Redis.

---

## 4. מסד הנתונים (PostgreSQL + Prisma)

- **ספק:** PostgreSQL.
- **גישה:** Prisma ב-`packages/db`; ה-API תלוי ב-`@voice/db`.

### מודלים עיקריים

| מודל | תפקיד |
|------|--------|
| **User** | משתמשים (login), email, password, role |
| **Agent** | סוכן קול: name, phoneNumber, telnyxAppId, voice, basePrompt, openingMessage, modelConfig, activeHours, calendarConfig, businessHours |
| **Contact** | אנשי קשר: phone, name, email, notes, totalCalls, totalDurationSec, lastCallAt |
| **Call** | שיחה: agentId, contactId, direction (inbound/outbound), status, durationSec, startedAt, endedAt, context, recordingUrl |
| **Utterance** | משפט בתמלול: callId, speaker, text, startMs, endMs |
| **Appointment** | תור/אירוע: agentId, contactId, callId, googleEventId, startTime, endTime, status |

פקודות שימושיות: `pnpm db:generate`, `pnpm db:push`, `pnpm db:migrate`, `pnpm db:studio`.

---

## 5. שכבות וזרימת בקשות

### 5.1 Backend (apps/api)

```
[Client]
    │
    ▼
[CORS] → [express.json]
    │
    ▼
Routes (לפי path):
    /health, /voices          → ללא auth
    /auth/*                   → login/register
    /webhooks/*                → Telnyx (call.initiated, call.answered, call.hangup, media)
    / (outbound)               → הפעלת שיחה יוצאת (הוספת job)
    /agents/* (calendar)       → לוח שנה
    / (events)                 → SSE / אירועים
    /agents/*, /calls, /contacts, /admin  → authMiddleware → handlers
    │
    ▼
[errorHandler]
```

- **אימות:** `authMiddleware` (session/cookie) ל-routes של סוכנים, שיחות, אנשי קשר, אדמין.
- **Webhook של Telnyx:** לא עובר auth; מזהה לפי event type ומעדכן סטטוס שיחה ומפעיל media/stream.

### 5.2 שיחות וסטרימינג

- **נכנסות:** Telnyx שולח `call.initiated` → יצירת Call + Session, warmup, `answer` → `call.answered` → התחלת media stream ל-`/ws/media`.
- **יוצאות:** בקשה ל-API → הוספת job ל-`outbound-calls` → Worker: warmup (Gemini + trigger), המתנה 15s, חיוג Telnyx, יצירת Session. כשהלקוח עונה, Telnyx מפעיל stream לאותו `/ws/media`.
- **מדיה:** WebSocket `/ws/media` (attachWebSocket על ה-http.Server) – מקבל אירועי Telnyx (start, media, stop), מחבר session ל-provider (מחומם או fresh), מעביר אודיו ל-Gemini ומשדר אודיו מ-Gemini חזרה ל-Telnyx; Deepgram לתמלול צד לקוח.

### 5.3 Workers ו-Redis

- **BullMQ** על Redis: תור `outbound-calls`, worker ב-`workers/outbound.ts`.
- **Redis** משמש גם ל-health check (`/health`) ול-PubSub לאירועים (למשל לעדכוני UI ב-SSE).

---

## 6. קבצים ופונקציות מרכזיים

### 6.1 כניסה ותשתית

| קובץ | תפקיד |
|------|--------|
| `apps/api/src/index.ts` | יצירת Express + HTTP server, CORS, חיבור routes, Redis ping, initPubSub, registerBuiltinTools, startOutboundWorker, attachWebSocket, האזנה על PORT, graceful shutdown |

### 6.2 שיחות (call flow)

| קובץ | תפקיד מרכזי |
|------|-------------|
| `services/call/media-bridge.ts` | attachWebSocket – עליית WebSocket `/ws/media`, טיפול ב-events (start/media/stop), חיבור session ל-provider (claim מ-warmup או fresh), שליחת אודיו ל-Gemini וקבלת אודיו/תמלול, Deepgram, כלים (tools), clear על interrupt |
| `services/call/warmup.ts` | warmup(callId, agentId, contactPhone) – חימום Gemini + trigger; claim(callId) – לקיחת provider מוכן; expire(callId) – ניקוי לפי TTL |
| `services/call/session.ts` | createSession, getSession, getSessionByCallId, endSession (ניתוק provider, עדכון Call, שמירת Utterances, עדכון Contact) |
| `services/call/prompt-builder.ts` | בניית system prompt (כולל לוח שנה/תזמון) |

### 6.3 ספק AI (Gemini)

| קובץ | תפקיד |
|------|--------|
| `services/providers/gemini/gemini.provider.ts` | VoiceProvider: connect, sendAudio, startConversation, disconnect, updateCallbacks; אינטגרציה עם connection + state + mapper |
| `services/providers/gemini/gemini.connection.ts` | ניהול WebSocket ל-Gemini (חיבור, setup, keepalive) |
| `services/providers/gemini/gemini.state.ts` | state של שיחה (תמלול, discard audio וכו') |
| `services/providers/gemini/gemini.mapper.ts` | המרת הודעות Gemini ↔ פורמט פנימי (אודיו, תמלול, tool calls) |
| `services/providers/key-pool.ts` | רוטציית API keys ל-Gemini (rate limit) |
| `services/providers/types.ts` | ProviderConfig, ProviderEvents, VoiceProvider, ToolDefinition וכו' |

### 6.4 כלים (tools) וטלפוניה

| קובץ | תפקיד |
|------|--------|
| `services/tools/registry.ts` | רישום והרצת tools (getDefinitions, execute) |
| `services/tools/builtin.ts` | כלים מובנים: end_call, transfer_call, save_note, get_contact_info, update_contact_name |
| `services/tools/calendar.ts` | כלים ללוח שנה (אם קיים) |
| `services/telnyx.ts` | חיוג יוצא, מענה, ניתוק, התחלת media stream – קריאות ל-Telnyx API |

### 6.5 Workers ו-Routes רלוונטיים

| קובץ | תפקיד |
|------|--------|
| `workers/outbound.ts` | Worker ל-`outbound-calls`: validation סוכן, בניית prompt, warmup, המתנה 15s, חיוג, createSession |
| `routes/webhooks.ts` | POST /webhooks/telnyx – טיפול ב-call.initiated (נכנס), call.answered (התחלת stream), call.hangup (endSession) |
| `routes/outbound.ts` | הוספת job לשיחה יוצאת (outboundQueue.add) |
| `routes/agents.ts` | CRUD סוכנים + POST :id/outbound להפעלת שיחה יוצאת |

### 6.6 אודיו ותמלול

| קובץ | תפקיד |
|------|--------|
| `lib/audio.ts` | Downsampler 24k→16k (PCM) לאודיו יוצא ל-Telnyx |
| `lib/audio-config.ts` | הגדרות אודיו per-agent (אם קיים) |
| `lib/playout-buffer.ts` | באפר השמעה לאודיו יוצא (הפחתת קפיצות/ג’יטר) |
| `services/transcription/deepgram.ts` | Deepgram – חיבור live, שליחת אודיו, callback לתמלול סופי (לקוח) |

### 6.7 אירועים ו-SSE

| קובץ | תפקיד |
|------|--------|
| `services/events/pubsub.ts` | initPubSub, closePubSub – Redis PubSub לעדכונים בין processes |
| `services/events/sse.manager.ts` | ניהול חיבורי SSE ללקוחות (למשל עדכוני סוכן/שיחות) |
| `routes/events.ts` | endpoints ל-SSE / אירועים |

---

## 7. Frontend (apps/web) – בקצרה

- **React + Vite**, routing, auth (login, session).
- **דפים:** Login, רשימת סוכנים, פרטי סוכן (כולל לוח שנה, אנשי קשר, שיחות), אדמין, דיאלוג שיחה יוצאת, Drawer אנשי קשר, מודל פרטי שיחה.
- **תקשורת:** `lib/api.ts` מול ה-API, `useAgentEvents` לאירועים/SSE.
- **UI:** קומפוננטות ב-`components/ui`, Layout עם ניווט.

---

## 8. פריסה (Deploy) – תזכורת

1. **Push ל-main** → GitHub Actions: build Docker (מהשורש, Dockerfile בודד ל-API), push ל-`me-west1-docker.pkg.dev/.../voice-api`.
2. **GKE:** `kubectl set image` ל-deployment `voice-api`, rollout עם timeout.
3. **סודות:** `voice-api-secrets` (envFrom) – DATABASE_URL, REDIS_URL, GEMINI keys וכו'.
4. **חשיפה:** API על 3000, health ב-`/health` (readiness/liveness/startup).

---

## 9. איך להתחיל לעבוד על הפרויקט

1. **Clone, התקנת תלויות:** `pnpm install`
2. **DB + Redis:** `pnpm dev` (או להריץ רק `docker compose -f docker-compose.dev.yml up`) ולוודא `DATABASE_URL` ו-`REDIS_URL` מצביעים ל-Postgres ול-Redis המקומיים.
3. **סכמה:** `pnpm db:generate` ואם צריך `pnpm db:push` או `pnpm db:migrate`.
4. **הרצת API:** `pnpm dev:api` (פורט 3000).
5. **הרצת Web:** `pnpm dev:web` (בדרך כלל 5173).
6. **שינוי לוגיקת שיחות:** `services/call/` (media-bridge, warmup, session), `workers/outbound.ts`, `routes/webhooks.ts`.
7. **שינוי מודל/קול:** `services/providers/gemini/`, `services/providers/types.ts`.
8. **הוספת כלי חדש:** `services/tools/` – רישום ב-registry והגדרה ב-builtin (או קובץ נפרד).

---

*מסמך זה מתאר את הארכיטקטורה כפי שהיא היום; עדכונים codebase או בתשתית כדאי לשקף כאן.*  
