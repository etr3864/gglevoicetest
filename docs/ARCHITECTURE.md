# ארכיטקטורת הפרויקט – Voice AI Platform

מסמך זה מתאר את מבנה הפרויקט, השכבות, התשתיות והקבצים המרכזיים.

---

## 1. סקירה כללית

פלטפורמת סוכני קול (Voice AI): סוכנים מקושרים ל-Telnyx ולמודל Gemini Live API, מטפלים בשיחות נכנסות ויוצאות, עם כלים (tools), תמלולים, הקלטות, לוח שנה ומנגנון תזכורות אוטומטיות.

**Stack:** Monorepo (pnpm), Backend: Node.js + Express + Prisma, Frontend: React + Vite, DB: PostgreSQL, Queue: Redis + BullMQ, טלפוניה: Telnyx, AI: Gemini Live API (Vertex AI), תמלול: Deepgram, אחסון הקלטות: Google Cloud Storage.

---

## 2. מבנה הפרויקט

```
gglvoice/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── index.ts                  # כניסה: Express, routes, Redis, WS, workers
│   │       ├── lib/
│   │       │   ├── audio-config.ts       # buildAnswerParams, buildDialStreamParams
│   │       │   ├── constants.ts          # GEMINI_MODEL, DEFAULT_VOICE
│   │       │   ├── date.ts               # TIMEZONE + כל פונקציות תאריך/שעה (Israel)
│   │       │   ├── logger.ts
│   │       │   ├── phone.ts              # normalizePhone
│   │       │   ├── queue.ts              # outboundQueue, recordingQueue, reminderQueue (BullMQ)
│   │       │   └── redis.ts
│   │       ├── middleware/               # auth, apikey, error-handler
│   │       ├── routes/
│   │       │   ├── agents.ts             # CRUD + POST :id/outbound
│   │       │   ├── auth.ts
│   │       │   ├── calls.ts              # GET calls, utterances, DELETE
│   │       │   ├── contacts.ts
│   │       │   ├── events.ts             # SSE endpoint
│   │       │   ├── outbound.ts           # POST שיחה יוצאת
│   │       │   ├── recordings.ts         # GET signed URL + download
│   │       │   ├── reminders.ts          # GET list, POST trigger, POST cancel
│   │       │   └── webhooks.ts           # Telnyx webhooks
│   │       ├── services/
│   │       │   ├── call/
│   │       │   │   ├── media-bridge.ts   # WebSocket /ws/media, audio pipeline
│   │       │   │   ├── session.ts        # Redis session lifecycle + reminder post-processing
│   │       │   │   ├── warmup.ts         # Gemini pre-warm + __systemPrompt/__openingMessage overrides
│   │       │   │   └── prompt-builder.ts # בניית system prompt + scheduling context
│   │       │   ├── calendar/
│   │       │   │   ├── google.ts         # Google Calendar API (freeBusy, createEvent, etc.)
│   │       │   │   └── appointment-webhook.service.ts  # webhook notifications לפגישות
│   │       │   ├── contact-context.ts    # בניית הקשר איש קשר לפרומפט
│   │       │   ├── events/
│   │       │   │   ├── pubsub.ts         # Redis PubSub
│   │       │   │   └── sse.manager.ts    # SSE connections
│   │       │   ├── providers/
│   │       │   │   ├── gemini/
│   │       │   │   │   ├── gemini.provider.ts   # VoiceProvider + reconnect
│   │       │   │   │   ├── gemini.connection.ts # WebSocket ל-Vertex AI
│   │       │   │   │   ├── gemini.state.ts      # היסטוריה + audio buffer
│   │       │   │   │   └── gemini.mapper.ts     # בניית payloads
│   │       │   │   ├── key-pool.ts       # רוטציית API keys
│   │       │   │   └── types.ts          # ProviderConfig, VoiceProvider, etc.
│   │       │   ├── recording/
│   │       │   │   ├── recording.service.ts  # handleRecordingWebhook
│   │       │   │   ├── recording.worker.ts   # BullMQ worker: download + GCS upload
│   │       │   │   ├── recording.gcs.ts      # GCS upload, signed URL
│   │       │   │   └── recording.cron.ts     # orphan scanner
│   │       │   ├── reminders/
│   │       │   │   └── reminder.service.ts   # createRemindersForAppointment, cancel, reschedule, handleReminderCallEnded, runSafetyScan
│   │       │   ├── telnyx.ts             # Telnyx API calls
│   │       │   └── tools/
│   │       │       ├── registry.ts
│   │       │       ├── builtin.ts        # end_call, save_note, get_contact_info, etc.
│   │       │       └── calendar.ts       # book/reschedule/cancel appointment tools + reminder hooks
│   │       └── workers/
│   │           ├── outbound.ts           # outbound call job processor
│   │           ├── reminder.worker.ts    # reminder-calls queue processor
│   │           └── webhook.worker.ts     # Telnyx webhook job processor
│   │
│   └── web/
│       └── src/
│           ├── hooks/                    # useAuth, useAgentEvents
│           ├── components/               # Layout, ui (Button, Card, Badge, Toggle, etc.)
│           └── pages/
│               └── Agent/
│                   ├── AgentDetailPage.tsx  # טאבים: prompt, calls, contacts, calendar, reminders, summaries, settings
│                   ├── RemindersTab.tsx     # הגדרות תזכורות + רשימת ScheduledReminders
│                   ├── CalendarTab.tsx
│                   ├── CallDetailModal.tsx  # תמלול + audio player
│                   └── ...
│
├── packages/
│   ├── db/                              # Prisma schema + client + migrations
│   │   └── prisma/schema.prisma
│   └── shared/                          # TypeScript interfaces משותפים
│       └── src/types/
│           └── agent.ts                 # CalendarConfig, ReminderConfig, ReminderRule, BusinessHours
│
├── Dockerfile                           # multi-stage: deps → builder → runner (Alpine + tzdata)
├── k8s/deployment.yaml                  # GKE deployment (TZ=Asia/Jerusalem, init container: migrate)
├── vercel.json                          # Vercel: build @voice/shared + @voice/web
├── .github/workflows/deploy.yml         # CI/CD: build → push → GKE deploy (API בלבד)
└── docs/ARCHITECTURE.md
```

---

## 3. תשתיות

| רכיב | תשתית |
|------|--------|
| **API** | GCP GKE – `us-central1`, image ב-Artifact Registry (`me-west1`) |
| **דומיין API** | `https://voiceapi.0ptive.com` |
| **Frontend** | Vercel – deploy אוטומטי על push ל-`main` |
| **דומיין Frontend** | `https://voiceapp.0ptive.com` |
| **DB** | PostgreSQL (Cloud SQL) |
| **Redis** | Redis – BullMQ queues + PubSub + sessions |
| **GCS** | `voice-ai-recordings-gen-lang-0546829339` – אחסון הקלטות |
| **Service Account** | `vertex-voice-sa` – הרשאות `aiplatform.user` + `storage.objectAdmin` |

**Timezone:** `TZ=Asia/Jerusalem` מוגדר ב-`k8s/deployment.yaml` וב-Dockerfile. כל פורמוט תאריך/שעה מרוכז ב-`lib/date.ts`.

**פיתוח מקומי:** `docker-compose.dev.yml` – Postgres 16 + Redis 7.

---

## 4. מסד הנתונים

| מודל | שדות מרכזיים |
|------|--------------|
| **User** | email, password, role |
| **Agent** | phoneNumber, telnyxAppId, voice, basePrompt, openingMessage, inboundSystemPrompt, inboundOpeningMessage, modelConfig, businessHours, calendarConfig (JSON), userId |
| **Contact** | phone, name, gender, notes, totalCalls, totalDurationSec, lastCallAt |
| **Call** | agentId, contactId, direction, status, callType (`regular`/`reminder`), durationSec, context (JSON), callControlId, telnyxRecordingId, recordingUrl, recordingStatus |
| **Utterance** | callId, speaker, text, startMs, endMs |
| **Appointment** | agentId, contactId, callId, phone, title, duration, googleEventId, startTime, endTime, status (`scheduled`/`cancelled`) |
| **ScheduledReminder** | appointmentId, agentId, contactId, callId, ruleIndex, scheduledFor, status, contentType, resolvedContent, attempts, bullmqJobId |

**Statuses של Call:** `queued → calling → ringing → in_call → completed / failed / no_answer`

**Statuses של ScheduledReminder:** `PENDING → CALLING → COMPLETED / NO_ANSWER / FAILED / CANCELLED`

**Migrations:** init container ב-K8s מריץ `prisma migrate deploy` לפני כל pod חדש.

---

## 5. Flow שיחות

### 5.1 שיחה יוצאת רגילה

```
POST /agents/:id/outbound
  → יצירת Call (status=queued, callType=regular)
  → outboundQueue.add('dial', { callId, agentId, phone, context })

outbound Worker:
  → validateAgent
  → markCalling (status=calling)
  → warmup(callId, agentId, phone, context)   ← async, לא חוסם
  → createOutboundCall (Telnyx API)
  → Promise.all([createSession, prisma.update callControlId])

Telnyx Webhooks:
  call.initiated  → log
  call.ringing    → status=ringing
  call.answered   → status=in_call, startStream, startRecording
  call.hangup     → endSession → summary job
  call.recording.saved → handleRecordingWebhook → recordingQueue
```

### 5.2 שיחה נכנסת

```
call.initiated (direction=incoming)
  → handleIncomingCall
  → יצירת Call + Contact (upsert)
  → createSession → warmup → answerCall

call.answered → startStream + startRecording
call.hangup   → endSession → summary job
```

### 5.3 שיחת תזכורת

```
reminderQueue delayed job fires (reminderId)
  → executeReminder:
      → שליפת ScheduledReminder + Appointment + Agent + Contact
      → validation: status=PENDING, appointment=scheduled, attempts < retryAttempts
      → status=CALLING, attempts++
      → buildCallContext:
          template mode: { __openingMessage: resolvedContent }
          ai mode:       { __systemPrompt: buildReminderPrompt(aiPrompt, appointment, contact) }
      → יצירת Call (callType=reminder)
      → outboundQueue.add('dial', { callId, ..., callContext })

call.hangup → endSession:
  → callType=reminder? → handleReminderCallEnded (skip summary)
      → answered  → ScheduledReminder.status=COMPLETED
      → no_answer → attempts < retryAttempts?
                      → reminderQueue.add delayed job (retryDelayMinutes)
                    else → status=NO_ANSWER
```

### 5.4 Media Pipeline

```
Telnyx WS /ws/media
  [start]  → handleStreamStart → resolveConnection (warm/cold)
  [media]  → PCM chunk → audioWorkerPool (downsample 24k→16k)
                       → Deepgram (תמלול לקוח)
             ↓
           GeminiProvider.sendAudio (רק אחרי interruptRef.enabled=true)
             ↓
           Gemini → audio PCM 24k → Telnyx WS
                  → transcript → Deepgram agent transcriber
  [stop]   → teardown
```

### 5.5 Warm Path vs Cold Path

| | Warm | Cold |
|-|-|-|
| **מתי** | warmup הספיק לסיים לפני call.answered | warmup לא הספיק |
| **איך** | `claim(callId)` מחזיר provider מחומם | `connectProvider(session)` בונה provider חדש |
| **greeting** | מנגן greeting preloaded מיד | Gemini מחבר ו-startConversation |
| **context** | מוזרק ב-buildProviderConfig | מוזרק ב-connectProvider דרך session.callContext |

**תזכורות:** `warmup.ts` בודק `callContext.__systemPrompt` ו-`callContext.__openingMessage` ואם קיימים — מחליף את ה-prompt/opening של ה-agent.

---

## 6. מנגנון תזכורות פגישות

### הגדרות ב-Agent (`calendarConfig.reminders`)

```json
{
  "enabled": true,
  "retryAttempts": 2,
  "retryDelayMinutes": 5,
  "rules": [
    {
      "minutesBefore": 60,
      "contentType": "template",
      "template": "שלום {customer_name}, תזכורת לפגישה שלך \"{title}\" בתאריך {date} בשעה {time}.",
      "aiPrompt": null
    }
  ]
}
```

### יצירת תזכורות (`createRemindersForAppointment`)

- נקרא אחרי `bookAppointment` מ-`calendar.ts`
- לכל rule: מחשב `scheduledFor = startTime - minutesBefore`, מדלג אם עבר
- `template` mode: interpolation של משתנים (`{customer_name}`, `{date}`, `{time}`, `{day}`, `{duration}`, `{agent_name}`) + שמירת `resolvedContent`
- יוצר `ScheduledReminder` (status=PENDING) + BullMQ delayed job עם jitter קטן
- Unique constraint על `(appointmentId, ruleIndex)` מונע כפילויות

### ביטול / הזזת פגישה

- `cancelRemindersForAppointment`: מוחק jobs מ-BullMQ + status=CANCELLED
- `rescheduleReminders`: ביטול קיימים + יצירה מחדש עם הזמנים החדשים

### Safety Net

BullMQ repeatable job (כל שעה) — סורק `ScheduledReminder WHERE status=PENDING AND scheduledFor < NOW()-5min` ומוסיף jobs מיידיים. מכסה Redis crash שבו delayed jobs אבדו.

---

## 7. Gemini Reconnect (Transparent)

Gemini Live API סוגר session אחרי ~10-15 דקות (`code 1000`):

```
GeminiProvider.handleClose(code=1000):
  → isCallActive() == true → attemptReconnect()
      → openConnection(isReconnect=true)
      → inject history (getMergedHistory)
      → drain audio buffer
  → השיחה נסגרה → onClose() → teardown

קריסות (code ≠ 1000): עד 3 ניסיונות (MAX_CRASH_RECONNECTS)
Reset counter: אחרי session יציב של >60 שניות
```

**Scale:** `isCallActive` בודק `activeConnections` שהוא in-memory — Telnyx WS תמיד sticky לפוד שאליו חובר.

---

## 8. הקלטות

```
call.recording.saved webhook → recordingQueue (BullMQ)

recording Worker:
  → downloadFromTelnyx (pre-signed S3 URL)
  → uploadToGCS (recordings/{userId}/{agentId}/{YYYY-MM}/{callId}.mp3)
  → prisma.call.update (recordingUrl, recordingStatus=ready, recordingDurationSec)
  → publishCallEvent

Orphan cron (כל דקה):
  → calls שהסתיימו >2 דקות ו-recordingStatus=pending → recordingQueue

GCS Lifecycle: 30 ימים → NEARLINE, 90 ימים → Delete
```

**API:** `GET /recordings/:callId/url` → signed URL (15 דקות תוקף).

---

## 9. הקשר סוכן לפני שיחה

`buildContactContext(phone)` בונה section לפרומפט:
- שם, מגדר, טלפון, סה"כ שיחות, תאריך שיחה אחרונה, הערות
- עד 3 שיחות אחרונות (30 utterances, 1500 תווים לשיחה)
- עד 10 פגישות עתידיות עם ID (לביטול/הזזה)

`call.context` (JSON) — שדה חופשי שמועבר ב-API, מוזרק לפרומפט תחת `--- Call Context ---`.

---

## 10. SSE ועדכוני UI בזמן אמת

```
publishCallEvent(agentId, eventName, data) → Redis PUBLISH channel:agent:{agentId}
SSE Manager → דוחף ל-clients המחוברים לאותו agentId
Frontend (useAgentEvents) → EventSource /events/agents/:id → עדכון React Query cache
```

---

## 11. Deploy

**API (GKE):**
1. Push ל-`main` → GitHub Actions: `docker build` → push ל-Artifact Registry
2. `kubectl set image deployment/voice-api` + rollout
3. Init container: `prisma migrate deploy` לפני כל pod חדש
4. סודות: `voice-api-secrets` — DATABASE_URL, REDIS_URL, TELNYX_API_KEY, GEMINI keys, GCP credentials

**Frontend (Vercel):**
- Deploy אוטומטי על push ל-`main`
- Build command: `pnpm --filter @voice/shared build && pnpm --filter @voice/web build`

---

## 12. נקודות קריטיות לתחזוקה

- **AMD מכובה** — `answering_machine_detection: 'disabled'` (Telnyx AMD לא עובד על מספרים ישראליים).
- **interruptRef** — גייטינג מיקרופון הלקוח בזמן greeting. `enabled=false` עד שה-greeting נגמר.
- **Redis TTL** — sessions ו-transcripts: 2 שעות. warmup entries: 60 שניות.
- **race condition** — `createSession` ו-`prisma.update` רצים במקביל (`Promise.all`) כדי שה-session יהיה מוכן לפני `call.answered` webhook.
- **Timezone** — `TZ=Asia/Jerusalem` ב-K8s + `tzdata` ב-Dockerfile (Alpine חסר timezone data כברירת מחדל). כל פורמוט דרך `lib/date.ts` בלבד.
- **callType** — שיחות תזכורת (`callType=reminder`) לא מופיעות ברשימת שיחות רגילות ולא מייצרות summary job.
- **Thundering Herd** — כל reminder job מקבל jitter אקראי עד 30 שניות לפני הפעלה ב-outbound queue.
