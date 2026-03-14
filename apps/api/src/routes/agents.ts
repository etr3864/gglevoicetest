import { Router } from 'express';
import crypto from 'crypto';
import { prisma, Prisma } from '@voice/db';
import { createAgentSchema, updateAgentSchema } from '@voice/shared';
import { AppError } from '../middleware/error-handler';
import { outboundQueue } from '../lib/queue';
import { normalizePhone } from '../lib/phone';
import { publishCallEvent } from '../services/events/pubsub';

function generateApiKey(): string {
  return `vk_${crypto.randomBytes(24).toString('hex')}`;
}

const router = Router();

router.get('/', async (_req, res) => {
  const agents = await prisma.agent.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { calls: true } } },
  });
  res.json({ data: agents });
});

router.post('/', async (req, res) => {
  const body = createAgentSchema.parse(req.body);
  const agent = await prisma.agent.create({ data: { ...body, apiKey: generateApiKey() } });
  res.status(201).json({ data: agent });
});

router.get('/:id', async (req, res) => {
  const agent = await prisma.agent.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { calls: true } } },
  });
  if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent not found');
  res.json({ data: agent });
});

router.patch('/:id', async (req, res) => {
  const body = updateAgentSchema.parse(req.body);
  const data: Record<string, unknown> = { ...body };

  if (data.activeHours === null) data.activeHours = Prisma.DbNull;
  if (data.businessHours === null) data.businessHours = Prisma.DbNull;

  const agent = await prisma.agent.update({ where: { id: req.params.id }, data });
  res.json({ data: agent });
});

router.delete('/:id', async (req, res) => {
  await prisma.agent.delete({ where: { id: req.params.id } });
  res.json({ data: { success: true } });
});

router.post('/:id/regenerate-key', async (req, res) => {
  const agent = await prisma.agent.update({
    where: { id: req.params.id },
    data: { apiKey: generateApiKey() },
  });
  res.json({ data: { apiKey: agent.apiKey } });
});

router.post('/:id/webhook-test', async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id }, select: { webhookUrl: true, webhookSecret: true } });
  if (!agent?.webhookUrl) throw new AppError(400, 'NO_WEBHOOK', 'No webhook URL configured');

  res.json({ data: await sendWebhookTest(agent.webhookUrl, agent.webhookSecret, req.params.id) });
});

router.post('/:id/appointment-webhook-test', async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id }, select: { appointmentWebhookUrl: true, appointmentWebhookSecret: true } });
  if (!agent?.appointmentWebhookUrl) throw new AppError(400, 'NO_WEBHOOK', 'No appointment webhook URL configured');

  res.json({ data: await sendWebhookTest(agent.appointmentWebhookUrl, agent.appointmentWebhookSecret, req.params.id) });
});

router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) {
    throw new AppError(400, 'INVALID_INPUT', 'Status must be active or inactive');
  }
  const agent = await prisma.agent.update({ where: { id: req.params.id }, data: { status } });
  res.json({ data: agent });
});

router.post('/:id/outbound', async (req, res) => {
  const { phone: rawPhone, contactName, gender, context } = req.body;
  if (!rawPhone) throw new AppError(400, 'INVALID_INPUT', 'Phone number required');

  const phone = normalizePhone(rawPhone);
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent not found');
  if (agent.status !== 'active') throw new AppError(400, 'AGENT_INACTIVE', 'Agent is not active');
  if (!agent.phoneNumber) throw new AppError(400, 'NO_PHONE', 'Agent has no phone number');
  if (!agent.telnyxAppId && !process.env.TELNYX_APP_ID) {
    throw new AppError(400, 'NO_APP_ID', 'No Telnyx App ID configured');
  }

  const contact = await prisma.contact.upsert({
    where: { phone },
    update: { ...(contactName && { name: contactName }), ...(gender && { gender }) },
    create: { phone, name: contactName || null, gender: gender || null },
  });

  const call = await prisma.call.create({
    data: {
      agentId: agent.id,
      contactId: contact.id,
      direction: 'outbound',
      status: 'queued',
      context: context ? (context as Prisma.InputJsonValue) : Prisma.DbNull,
    },
    include: { contact: { select: { phone: true, name: true } } },
  });

  await publishCallEvent(agent.id, 'call_created', { call });

  await outboundQueue.add(
    'dial',
    { callId: call.id, agentId: agent.id, contactId: contact.id, phone, context },
    { attempts: 2, backoff: { type: 'fixed', delay: 8000 } },
  );

  res.status(201).json({ data: { callId: call.id, status: 'queued' } });
});

async function sendWebhookTest(url: string, secret: string | null, agentId: string) {
  const payload = JSON.stringify({ event: 'webhook_test', agent_id: agentId, timestamp: new Date().toISOString() });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (secret) {
    const { createHmac } = await import('crypto');
    headers['X-Signature'] = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  }

  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(10_000) });
    return { success: r.ok, statusCode: r.status, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { success: false, statusCode: null, latencyMs: Date.now() - t0, error: err instanceof Error ? err.message : 'error' };
  }
}

export default router;
