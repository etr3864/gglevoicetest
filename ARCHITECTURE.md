# Architecture

## Overview

Voice AI platform — inbound and outbound calls with AI agents, Google Calendar integration, and appointment reminders.

**Stack:** Node.js (Express) · TypeScript · PostgreSQL (Prisma) · Redis · BullMQ · Telnyx · Gemini (Vertex AI) · Deepgram · GKE · Vercel (frontend)

---

## System Flow

### Inbound Call

1. Telnyx sends `call.initiated` webhook → `handleIncomingCall` in `routes/webhooks.ts`
2. Call record created in DB, session stored in Redis, warmup started (`warmup.ts`)
3. `answerCall` triggers Telnyx to open a WebSocket stream to `/ws/media`
4. `media-bridge.ts` receives the `start` event, retrieves session (with retry), calls `resolveConnection`
5. If warmup completed (warm path): reuses pre-built provider + preloaded greeting audio
6. If warmup not ready (cold path): connects Gemini provider synchronously
7. Call marked `in_call`, recording started, conversation begins

### Outbound Call

1. `outbound.worker.ts` dequeues a job from BullMQ, calls `createOutboundCall` in `services/telnyx.ts`
2. Telnyx dials the number with `stream_establish_before_call_originate: true` — WebSocket opens before the call is answered
3. WebSocket `start` event arrives in `media-bridge.ts` and resolves the session
4. Same path as inbound from step 4 onward

### Call End

1. WebSocket `stop` event or `ws.on('close')` triggers `teardown`
2. `teardown` is idempotent: `activeConnections.delete` acts as a guard — first caller wins, subsequent calls return early
3. Provider disconnected, transcribers closed, session deleted from Redis
4. `endSession` saves transcript to DB, enqueues summary job

---

## Core Files

### Entry & Routing
- **`apps/api/src/index.ts`** — Express server setup, WebSocket attachment, graceful shutdown (SIGTERM/SIGINT), liveness/readiness probes, BullMQ worker startup
- **`apps/api/src/routes/webhooks.ts`** — Telnyx webhook handler (call lifecycle events). Signature verified via Ed25519 (`TELNYX_WEBHOOK_PUBLIC_KEY`)
- **`apps/api/src/routes/outbound.ts`** — REST endpoint to initiate outbound calls

### Call Core
- **`apps/api/src/services/call/media-bridge.ts`** — WebSocket media stream handler. Receives audio from Telnyx, downsamples 24kHz→16kHz, sends to Gemini. Receives Gemini audio, applies gain, streams back to Telnyx. Manages `activeConnections` map (one entry per live call)
- **`apps/api/src/services/call/warmup.ts`** — Pre-connects to Gemini before call is answered to eliminate first-word latency. Exports `buildProviderConfig` (used by both warm and cold paths)
- **`apps/api/src/services/call/session.ts`** — Redis-backed call session store. Holds session metadata and transcript buffer during the call
- **`apps/api/src/services/call/prompt-builder.ts`** — Assembles the AI system prompt from agent config, business hours, and scheduling instructions

### AI Provider
- **`apps/api/src/services/providers/gemini/gemini.provider.ts`** — Gemini Live API client (BidiGenerateContent). Handles bidirectional audio, tool calls, transcripts, and VAD events
- **`apps/api/src/services/providers/types.ts`** — Shared types: `ProviderConfig`, `ProviderEvents`, `DEFAULT_MODEL_CONFIG` (VAD, turn coverage, sample rates)

### Audio
- **`apps/api/src/lib/audio-config.ts`** — Audio constants (sample rates, codecs), `downsample24kTo16k` (inline, stateful, 24kHz→16kHz with carry buffer), `buildDialStreamParams`, `diagnoseChunk`, `applyGain`

### Workers & Queues (BullMQ)
- **`apps/api/src/workers/outbound.worker.ts`** — Processes outbound call jobs with jitter to prevent thundering herd
- **`apps/api/src/workers/summary.worker.ts`** — Generates call summaries after hangup
- **`apps/api/src/workers/reminder.worker.ts`** — Initiates appointment reminder calls
- **`apps/api/src/services/recording/recording.worker.ts`** — Downloads recordings from Telnyx, uploads to GCS, updates DB

### Calendar & Reminders
- **`apps/api/src/services/calendar/google.ts`** — Google Calendar API integration (read/write appointments)
- **`apps/api/src/services/reminders/reminder.service.ts`** — Reminder scheduling logic, handles post-call cleanup for reminder calls

### Real-time
- **`apps/api/src/services/events/pubsub.ts`** — Redis Pub/Sub for broadcasting call events between pods
- **`apps/api/src/services/events/sse.manager.ts`** — SSE connection manager, bridges Redis events to connected frontend clients

### Shared Libraries
- **`apps/api/src/lib/date.ts`** — Date/time formatting using `Date` local-time methods (respects `TZ=Asia/Jerusalem` env var, bypasses ICU limitations on Alpine)
- **`apps/api/src/lib/telnyx-signature.ts`** — Ed25519 webhook signature verification with replay protection (±5 min window)
- **`apps/api/src/services/contact-context.ts`** — Builds contact history context for the AI prompt (recent calls, capped to prevent token overflow)

---

## Scaling

- **Horizontal:** Stateless pods — Redis holds all session state. WebSocket affinity via `BackendConfig: sessionAffinity: CLIENT_IP` on GKE Ingress
- **Capacity:** Each pod rejects new calls at `MAX_SESSIONS_PER_POD` (default 25) via the `/health/ready` probe returning 503
- **Graceful shutdown:** On SIGTERM, pod stops accepting calls (readiness 503), waits for all active calls to finish, then exits
- **Queue isolation:** Each worker type has its own BullMQ queue with independent concurrency and retry config

---

## Configuration (env vars)

| Variable | Purpose |
|---|---|
| `TZ` | Must be `Asia/Jerusalem` — applied in Dockerfile and `k8s/deployment.yaml` |
| `TELNYX_API_KEY` | Telnyx REST API authentication |
| `TELNYX_WEBHOOK_PUBLIC_KEY` | Ed25519 public key for webhook signature verification (PEM or base64) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Vertex AI / Google Calendar service account |
| `REDIS_URL` | Redis connection string |
| `DATABASE_URL` | PostgreSQL connection string |
| `MAX_SESSIONS_PER_POD` | Call capacity per pod (default: 25) |
| `DEEPGRAM_API_KEY` | Transcription service |
| `FRONTEND_URL` | Allowed CORS origin |
