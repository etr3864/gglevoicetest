import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });
import http from 'http';
import express from 'express';
import cors from 'cors';
import { createLogger } from './lib/logger';
import { VOICES } from './lib/constants';
import { redis } from './lib/redis';
import { errorHandler } from './middleware/error-handler';
import { authMiddleware } from './middleware/auth';
import authRoutes from './routes/auth';
import agentRoutes from './routes/agents';
import callRoutes from './routes/calls';
import contactRoutes from './routes/contacts';
import outboundRoutes from './routes/outbound';
import adminRoutes from './routes/admin';
import calendarRoutes from './routes/calendar';
import reminderRoutes from './routes/reminders';
import webhookRoutes from './routes/webhooks';
import recordingRoutes from './routes/recordings';
import eventsRouter from './routes/events';
import { registerBuiltinTools } from './services/tools';
import { attachWebSocket, activeConnectionCount } from './services/call';
import { geminiKeyPool } from './services/providers';
import { startOutboundWorker } from './workers/outbound';
import { startRecordingWorker } from './services/recording/recording.worker';
import { startSummaryWorker } from './workers/summary.worker';
import { startWebhookWorker } from './workers/webhook.worker';
import { startAppointmentWebhookWorker } from './workers/appointment-webhook.worker';
import { startReminderWorker } from './workers/reminder.worker';
import { startRecordingCrons } from './services/recording/recording.cron';
import { initPubSub, closePubSub } from './services/events/pubsub';
import { sseManager } from './services/events/sse.manager';
import { activeSessionCount } from './services/call/session';

const log = createLogger('app');
const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || '3000');

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  ...(process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? []),
];
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (origin.endsWith('.vercel.app')) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({
  verify: (req: any, _res, buf) => {
    if (req.path?.startsWith('/webhooks/telnyx')) {
      req.rawBody = buf;
    }
  },
}));

const MAX_SESSIONS_PER_POD = parseInt(process.env.MAX_SESSIONS_PER_POD || '25');
let isDraining = false;

// Liveness: always 200 as long as process is alive
app.get(['/health', '/health/live'], (_req, res) => {
  res.json({ status: 'alive' });
});

// Readiness: 503 when draining or at capacity — LB stops sending traffic
app.get('/health/ready', async (_req, res) => {
  const connections = activeConnectionCount();
  if (isDraining) {
    return res.status(503).json({ status: 'draining', connections });
  }
  if (connections >= MAX_SESSIONS_PER_POD) {
    return res.status(503).json({ status: 'full', connections });
  }
  try {
    await redis.ping();
    res.json({ status: 'ready', connections });
  } catch {
    res.status(503).json({ status: 'degraded' });
  }
});

app.get('/voices', (_req, res) => res.json({ data: VOICES }));
app.use('/auth', authRoutes);
app.use('/', outboundRoutes);
app.use('/webhooks', webhookRoutes);

app.use('/agents', calendarRoutes);
app.use('/agents', authMiddleware, reminderRoutes);
app.use('/', eventsRouter);
app.use('/agents', authMiddleware, agentRoutes);
app.use('/', authMiddleware, callRoutes);
app.use('/', recordingRoutes);
app.use('/', authMiddleware, contactRoutes);
app.use('/admin', authMiddleware, adminRoutes);

app.use(errorHandler);

function waitForCallsToFinish(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (activeConnectionCount() === 0) return resolve();
      setTimeout(check, 1000);
    };
    check();
  });
}

async function start() {
  try {
    await redis.ping();
    await initPubSub();

    registerBuiltinTools();
    const outboundWorker = startOutboundWorker();
    const recordingWorker = startRecordingWorker();
    const summaryWorker = startSummaryWorker();
    const webhookWorker = startWebhookWorker();
    const appointmentWebhookWorker = startAppointmentWebhookWorker();
    const reminderWorker = startReminderWorker();
    startRecordingCrons();
    attachWebSocket(server);

    server.listen(PORT, '0.0.0.0', () => {
      log.info(`Server ready on :${PORT}`, { geminiKeys: geminiKeyPool.size });
    });

    const shutdown = async () => {
      if (isDraining) return;
      isDraining = true;
      log.info('Draining: waiting for active calls to finish', { connections: activeConnectionCount() });

      await waitForCallsToFinish();

      log.info('All calls finished, shutting down');
      sseManager.shutdown();
      await Promise.all([outboundWorker.close(), recordingWorker.close(), summaryWorker.close(), webhookWorker.close(), appointmentWebhookWorker.close(), reminderWorker.close()]);
      await closePubSub();
      server.close(() => process.exit(0));
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    log.error('Startup failed', err);
    process.exit(1);
  }
}

start();
