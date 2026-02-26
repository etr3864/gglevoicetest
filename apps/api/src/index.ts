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
import webhookRoutes from './routes/webhooks';
import { registerBuiltinTools } from './services/tools';
import { attachWebSocket } from './services/call';
import { geminiKeyPool } from './services/providers';
import { startOutboundWorker } from './workers/outbound';

const log = createLogger('app');
const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || '3000');

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    await redis.ping();
    res.json({ status: 'healthy' });
  } catch {
    res.status(503).json({ status: 'degraded' });
  }
});

app.get('/voices', (_req, res) => res.json({ data: VOICES }));
app.use('/auth', authRoutes);
app.use('/', outboundRoutes);
app.use('/webhooks', webhookRoutes);

app.use('/agents', calendarRoutes);
app.use('/agents', authMiddleware, agentRoutes);
app.use('/', authMiddleware, callRoutes);
app.use('/', authMiddleware, contactRoutes);
app.use('/admin', authMiddleware, adminRoutes);

app.use(errorHandler);

async function start() {
  try {
    await redis.ping();

    registerBuiltinTools();
    startOutboundWorker();
    attachWebSocket(server);

    server.listen(PORT, '0.0.0.0', () => {
      log.info(`Server ready on :${PORT}`, { geminiKeys: geminiKeyPool.size });
    });
  } catch (err) {
    log.error('Startup failed', err);
    process.exit(1);
  }
}

start();
