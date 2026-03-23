import { Router } from 'express';
import { prisma } from '@voice/db';
import { AppError } from '../middleware/error-handler';
import { assertAgentAccess, requireSuperAdmin } from '../middleware/auth';
import { enqueueWebhookRetry } from '../services/summary/webhook.service';

const router = Router();

router.get('/agents/:id/calls', async (req, res) => {
  await assertAgentAccess(req.params.id, req.user!);

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

async function loadCallAndAssertAccess(callId: string, user: Express.Request['user']) {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: { contact: true, agent: { select: { id: true, name: true } } },
  });
  if (!call) throw new AppError(404, 'NOT_FOUND', 'Call not found');
  await assertAgentAccess(call.agentId, user!);
  return call;
}

router.get('/calls/:id', async (req, res) => {
  const call = await loadCallAndAssertAccess(req.params.id, req.user);
  res.json({ data: call });
});

router.get('/calls/:id/utterances', async (req, res) => {
  const call = await loadCallAndAssertAccess(req.params.id, req.user);
  const utterances = await prisma.utterance.findMany({
    where: { callId: call.id },
    orderBy: { startMs: 'asc' },
  });
  res.json({ data: utterances });
});

router.get('/calls/:id/whatsapp-messages', async (req, res) => {
  const call = await loadCallAndAssertAccess(req.params.id, req.user);
  const messages = await prisma.whatsappMessage.findMany({
    where: { callId: call.id, direction: 'outbound' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, content: true, createdAt: true, status: true, mediaType: true, mediaName: true },
  });
  res.json({ data: messages });
});

router.delete('/calls/:id', requireSuperAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  await prisma.call.delete({ where: { id } });
  res.json({ data: { success: true } });
});

router.get('/calls/:id/summary', async (req, res) => {
  const call = await loadCallAndAssertAccess(req.params.id, req.user);
  const summary = await prisma.callSummary.findUnique({ where: { callId: call.id } });
  res.json({ data: summary ?? null });
});

router.post('/calls/:id/summary/webhook-retry', requireSuperAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  const summary = await prisma.callSummary.findUnique({ where: { callId: id } });
  if (!summary) throw new AppError(404, 'NOT_FOUND', 'No summary for this call');
  if (summary.webhookStatus === 'SENT') throw new AppError(400, 'ALREADY_SENT', 'Webhook already sent');
  await enqueueWebhookRetry(summary.id);
  res.json({ data: { queued: true } });
});

export default router;
