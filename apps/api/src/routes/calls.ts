import { Router } from 'express';
import { prisma } from '@voice/db';
import { AppError } from '../middleware/error-handler';
import { enqueueWebhookRetry } from '../services/summary/webhook.service';

const router = Router();

router.get('/agents/:id/calls', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const skip = (page - 1) * limit;

  const [calls, total] = await Promise.all([
    prisma.call.findMany({
      where: { agentId: req.params.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { 
        contact: { select: { phone: true, name: true } },
        _count: { select: { utterances: true } }
      },
    }),
    prisma.call.count({ where: { agentId: req.params.id } }),
  ]);

  const formattedCalls = calls.map(c => ({
    ...c,
    transcriptSaved: c._count.utterances > 0
  }));

  res.json({ data: formattedCalls, meta: { page, limit, total } });
});

router.get('/calls/:id', async (req, res) => {
  const call = await prisma.call.findUnique({
    where: { id: req.params.id },
    include: { contact: true, agent: { select: { id: true, name: true } } },
  });
  if (!call) throw new AppError(404, 'NOT_FOUND', 'Call not found');
  res.json({ data: call });
});

router.get('/calls/:id/utterances', async (req, res) => {
  const utterances = await prisma.utterance.findMany({
    where: { callId: req.params.id },
    orderBy: { startMs: 'asc' },
  });
  res.json({ data: utterances });
});

router.delete('/calls/:id', async (req, res) => {
  await prisma.call.delete({ where: { id: req.params.id } });
  res.json({ data: { success: true } });
});

router.get('/calls/:id/summary', async (req, res) => {
  const summary = await prisma.callSummary.findUnique({ where: { callId: req.params.id } });
  res.json({ data: summary ?? null });
});

router.post('/calls/:id/summary/webhook-retry', async (req, res) => {
  const summary = await prisma.callSummary.findUnique({ where: { callId: req.params.id } });
  if (!summary) throw new AppError(404, 'NOT_FOUND', 'No summary for this call');
  if (summary.webhookStatus === 'SENT') throw new AppError(400, 'ALREADY_SENT', 'Webhook already sent');
  await enqueueWebhookRetry(summary.id);
  res.json({ data: { queued: true } });
});

export default router;
