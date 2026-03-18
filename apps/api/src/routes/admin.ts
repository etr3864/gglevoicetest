import { Router } from 'express';
import { prisma } from '@voice/db';
import { AppError } from '../middleware/error-handler';
import { simulateCrashForTesting } from '../services/call/media-bridge';

const router = Router();

const TABLE_MAP: Record<string, { model: string; orderBy: Record<string, string> }> = {
  agents:       { model: 'agent',       orderBy: { createdAt: 'desc' } },
  users:        { model: 'user',        orderBy: { createdAt: 'desc' } },
  contacts:     { model: 'contact',     orderBy: { createdAt: 'desc' } },
  calls:        { model: 'call',        orderBy: { createdAt: 'desc' } },
  appointments: { model: 'appointment', orderBy: { startTime: 'desc' } },
  utterances:   { model: 'utterance',   orderBy: { startMs: 'desc' } },
};

const TABLES = Object.keys(TABLE_MAP);

function getTableConfig(name: string) {
  const config = TABLE_MAP[name];
  if (!config) throw new AppError(400, 'INVALID_TABLE', 'Invalid table name');
  return { model: (prisma as any)[config.model], orderBy: config.orderBy };
}

router.get('/table/:name', async (req, res) => {
  const { model, orderBy } = getTableConfig(req.params.name);

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    model.findMany({ skip, take: limit, orderBy }),
    model.count(),
  ]);

  res.json({ data: rows, meta: { page, limit, total, table: req.params.name, tables: TABLES } });
});

router.delete('/table/:name/:id', async (req, res) => {
  const { model } = getTableConfig(req.params.name);
  await model.delete({ where: { id: req.params.id } });
  res.json({ data: { success: true } });
});

router.post('/table/:name/bulk-delete', async (req, res) => {
  const { model } = getTableConfig(req.params.name);
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError(400, 'INVALID_INPUT', 'ids array required');
  }
  const result = await model.deleteMany({ where: { id: { in: ids } } });
  res.json({ data: { deleted: result.count } });
});

/** POST /admin/debug/simulate-crash — triggers reconnect on active call. Remove after testing. */
router.post('/debug/simulate-crash', (_req, res) => {
  const found = simulateCrashForTesting();
  res.json({ data: { triggered: found } });
});

export default router;
