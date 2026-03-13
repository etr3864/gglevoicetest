# ארכיטקטורת הפרויקט – Voice AI Platform

מסמך זה מתאר את מבנה הפרויקט, השכבות, התשתיות והקבצים המרכזיים.

---

## 1. סקירה כללית

פלטפורמת סוכני קול (Voice AI): סוכנים מקושרים ל-Telnyx ולמודל Gemini Live API, מטפלים בשיחות נכנסות ויוצאות, עם כלים (tools), תמלולים, הקלטות, ולוח שנה.

**Stack:** Monorepo (pnpm), Backend: Node.js + Express + Prisma, Frontend: React + Vite, DB: PostgreSQL, Queue: Redis + BullMQ, טלפוניה: Telnyx, AI: Gemini Live API (Vertex AI), תמלול: Deepgram, אחסון הקלטות: Google Cloud Storage.

---

## 2. מבנה הפרויקט

```
gglvoice/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── index.ts                  # כניסה: Express, routes, Redis, WS, workers, crons
│   │       ├── lib/
│   │       │   ├── audio-config.ts       # הגדרות אודיו, buildAnswerParams, buildDialStreamParams
│   │       │   ├── constants.ts          # GEMINI_MODEL, DEFAULT_VOICE
│   │       │   ├── logger.ts
│   │       │   ├── phone.ts              # normalizePhone
│   │       │   ├── queue.ts              # outboundQueue, recordingQueue (BullMQ)
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
│   │       │   └── webhooks.ts           # Telnyx webhooks
│   │       ├── services/
│   │       │   ├── call/
│   │       │   │   ├── media-bridge.ts   # WebSocket /ws/media, audio pipeline
│   │       │   │   ├── session.ts        # Redis session lifecycle
│   │       │   │   ├── warmup.ts         # Gemini pre-warm
│   │       │   │   └── prompt-builder.ts # בניית system prompt
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
│   │       │   ├── telnyx.ts             # Telnyx API calls
│   │       │   ├── tools/
│   │       │   │   ├── registry.ts
│   │       │   │   ├── builtin.ts        # end_call, save_note, get_contact_info, etc.
│   │       │   │   └── calendar.ts
│   │       │   ├── transcription/
│   │       │   │   └── deepgram.ts
│   │       │   └── calendar/
│   │       └── workers/
│   │           └── outbound.ts           # outbound call job processor
│   │
│   └── web/
│       └── src/
│           ├── hooks/                    # useAuth, useAgentEvents
│           ├── components/               # Layout, ui (Button, Card, Badge, etc.)
│           └── pages/
│               └── Agent/
│                   ├── AgentDetailPage.tsx
│                   ├── CallDetailModal.tsx  # תמלול + audio player
│                   └── ...
│
├── packages/
│   └── db/                              # Prisma schema + client + migrations
│       └── prisma/schema.prisma
│
├── k8s/deployment.yaml                  # GKE deployment (init container: migrate)
├── .github/workflows/deploy.yml         # CI/CD: build → push → deploy
└── docs/ARCHITECTURE.md
```

---

## 3. תשתיות

| רכיב | תשתית |
|------|--------|
| **API** | GCP GKE – `me-west1`, image ב-Artifact Registry |
| **דומיין API** | `https://voiceapi.0ptive.com` |
| **דומיין Frontend** | `https://voiceapp.0ptive.com` |
| **DB** | PostgreSQL (Cloud SQL) |
| **Redis** | Redis – BullMQ queues + PubSub + sessions |
| **GCS** | `voice-ai-recordings-gen-lang-0546829339` – אחסון הקלטות |
| **Service Account** | `vertex-voice-sa` – הרשאות `aiplatform.user` + `storage.objectAdmin` |

**פיתוח מקומי:** `docker-compose.dev.yml` – Postgres 16 + Redis 7.

---

## 4. מסד הנתונים

| מודל | שדות מרכזיים |
|------|--------------|
| **User** | email, password, role |
| **Agent** | phoneNumber, telnyxAppId, voice, basePrompt, openingMessage, modelConfig, businessHours, calendarConfig, userId |
| **Contact** | phone, name, gender, notes, totalCalls, totalDurationSec, lastCallAt |
| **Call** | agentId, contactId, direction, status, durationSec, context (JSON), callControlId, telnyxRecordingId, recordingUrl, recordingStatus, recordingDurationSec |
| **Utterance** | callId, speaker, text, startMs, endMs |
| **Appointment** | agentId, contactId, callId, googleEventId, startTime, endTime, status |

**Statuses של Call:** `queued → calling → ringing → in_call → completed / failed`

**Migrations:** `initContainer` ב-K8s מריץ `prisma migrate deploy` לפני כל deploy.

---

## 5. Flow שיחות

### 5.1 שיחה יוצאת

```
POST /agents/:id/outbound
  → יצירת Call (status=queued)
  → outboundQueue.add('dial', { callId, agentId, phone, context })

outbound Worker:
  → validateAgent
  → markCalling (status=calling)
  → warmup(callId, agentId, phone, context)   ← async, לא חוסם
  → createOutboundCall (Telnyx API)
  → Promise.all([createSession, prisma.update callControlId])  ← במקביל למנוע race

Telnyx Webhooks:
  call.initiated  → log
  call.ringing    → status=ringing
  call.answered   → status=in_call, startStream, startRecording
  call.hangup     → endSession
  call.recording.saved → handleRecordingWebhook → recordingQueue
```

### 5.2 שיחה נכנסת

```
call.initiated (direction=incoming)
  → handleIncomingCall
  → יצירת Call + Contact (upsert)
  → createSession
  → warmup
  → answerCall (Telnyx API, כולל stream params)

call.answered → startStream + startRecording
call.hangup   → endSession
```

### 5.3 Media Pipeline

```
Telnyx WS /ws/media
  [start]  → handleStreamStart → resolveConnection (warm/cold)
  [media]  → PCM chunk → audioWorkerPool (downsample 24k→16k)
                       → Deepgram (תמלול לקוח)
             ↓
           GeminiProvider.sendAudio (רק אחרי interruptRef.enabled=true)
             ↓
           Gemini → audio PCM 24k → Telnyx WS (שמע לטלפון)
                  → transcript → Deepgram agent transcriber
  [stop]   → teardown
```

### 5.4 Warm Path vs Cold Path

| | Warm | Cold |
|-|-|-|
| **מתי** | warmup הספיק לסיים לפני call.answered | warmup לא הספיק |
| **איך** | `claim(callId)` מחזיר provider מחומם + greeting audio preloaded | `connectProvider(session)` בונה provider חדש |
| **greeting** | מנגן greeting preloaded מיד בלי latency | Gemini מחבר ו-startConversation |
| **context** | מוזרק ב-buildProviderConfig | מוזרק ב-connectProvider דרך session.callContext |

---

## 6. Gemini Reconnect (Transparent)

Gemini Live API סוגר session אחרי ~10-15 דקות (`code 1000`). המערכת מטפלת בזה שקטית:

```
GeminiProvider.handleClose(code=1000):
  → אם isCallActive() == true (בודק activeConnections map בזיכרון)
     → reset reconnectAttempts = 0
     → attemptReconnect()
        → openConnection(isReconnect=true)
        → inject history (getMergedHistory)
        → drain audio buffer
  → אם השיחה כבר נסגרה → onClose() → teardown

קריסות (code ≠ 1000): עד 3 ניסיונות (MAX_CRASH_RECONNECTS)
Reset counter: אחרי session יציב של >60 שניות
```

**Scale:** isCallActive בודק `activeConnections` שהוא in-memory על אותו pod — Telnyx WS תמיד sticky לפוד שאליו חובר.

---

## 7. הקלטות

```
call.recording.saved webhook
  → handleRecordingWebhook
  → recordingQueue.add (BullMQ)

recording Worker:
  → downloadFromTelnyx (pre-signed S3 URL, ללא Authorization header)
  → uploadToGCS (path: recordings/{userId}/{agentId}/{YYYY-MM}/{callId}.mp3)
  → prisma.call.update (recordingUrl, recordingStatus=ready, recordingDurationSec)
  → publishCallEvent (עדכון UI)

Orphan cron (כל דקה):
  → מחפש calls שהסתיימו >2 דקות ו-recordingStatus=pending
  → מוסיף ל-recordingQueue

GCS Lifecycle:
  → 30 ימים: NEARLINE
  → 90 ימים: Delete
```

**Frontend:** `CallDetailModal` — audio player עם slider (seek רק על mouseUp), כפתור download.

**API:** `GET /recordings/:callId/url` → signed URL (15 דקות תוקף).

---

## 8. הקשר סוכן לפני שיחה

`buildContactContext(phone)` בונה section לפרומפט:
- שם, מגדר, טלפון, סה"כ שיחות, תאריך שיחה אחרונה, הערות
- עד 3 שיחות אחרונות עם תמלול (מקסימום 30 utterances, 1500 תווים לשיחה)
- עד 10 פגישות עתידיות
- שעות עסקים + זמן נוכחי

`call.context` (JSON) — שדה חופשי שמועבר ב-API של שיחה יוצאת, מוזרק לפרומפט תחת `--- Call Context ---`.

---

## 9. SSE ועדכוני UI בזמן אמת

```
publishCallEvent(agentId, eventName, data)
  → Redis PUBLISH channel:agent:{agentId}

SSE Manager מקשיב:
  → דוחף ל-clients המחוברים לאותו agentId

Frontend (useAgentEvents):
  → EventSource על /events/agents/:id
  → עדכון React Query cache בזמן אמת
```

---

## 10. Deploy

1. Push ל-`main` → GitHub Actions: `docker build` → push ל-Artifact Registry
2. `kubectl set image deployment/voice-api` + rollout
3. Init container: `prisma migrate deploy` לפני כל pod חדש
4. סודות: `voice-api-secrets` (envFrom) — DATABASE_URL, REDIS_URL, TELNYX_API_KEY, GEMINI keys, GCP credentials, GCS_BUCKET

---

## 11. נקודות קריטיות לתחזוקה

- **AMD מכובה** — `answering_machine_detection: 'disabled'` (Telnyx AMD לא עובד על מספרים ישראליים).
- **interruptRef** — גייטינג של מיקרופון הלקוח בזמן greeting. `enabled=false` עד שה-greeting נגמר.
- **Redis TTL** — sessions ו-transcripts: 2 שעות. warmup entries: 60 שניות.
- **race condition** — `createSession` ו-`prisma.update` רצים במקביל (`Promise.all`) כדי שה-session יהיה מוכן לפני `call.answered` webhook.
- **buildAnswerParams** משמש גם ל-`streaming_start` (לא `buildDialStreamParams`) — לשמור על אחידות.
