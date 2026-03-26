import { Router } from 'express';
import crypto from 'crypto';
import { prisma, Prisma } from '@voice/db';
import { createAgentSchema, updateAgentSchema } from '@voice/shared';
import { AppError } from '../middleware/error-handler';
import { requireSuperAdmin, assertAgentAccess } from '../middleware/auth';
import { outboundQueue, OUTBOUND_PRIORITY } from '../lib/queue';
import { normalizePhone } from '../lib/phone';
import { publishCallEvent } from '../services/events/pubsub';
import { encryptConfig, decryptConfig } from '../services/whatsapp/config-crypto';

function generateApiKey(): string {
  return `vk_${crypto.randomBytes(24).toString('hex')}`;
}

function getAdminId(user: Express.Request['user']): string | undefined {
  if (!user) return undefined;
  if (user.role === 'super_admin') return undefined;
  return user.role === 'employee' && user.parentId ? user.parentId : user.userId;
}

const router = Router();

router.get('/', async (req, res) => {
  const adminId = getAdminId(req.user);
  const where = adminId ? { userId: adminId } : {};
  const agents = await prisma.agent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { calls: true } } },
  });
  res.json({ data: agents });
});

router.post('/', requireSuperAdmin, async (req, res) => {
  const body = createAgentSchema.parse(req.body);
  const agent = await prisma.agent.create({ data: { ...body, apiKey: generateApiKey() } });
  res.status(201).json({ data: agent });
});

router.get('/:id', async (req, res) => {
  const { id } = req.params as { id: string };
  await assertAgentAccess(id, req.user!);

  const agent = await prisma.agent.findUnique({
    where: { id },
    include: { _count: { select: { calls: true } } },
  });
  if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent not found');

  let whatsappConfig: object | null = null;
  if (agent.whatsappConfig) {
    try {
      whatsappConfig = decryptConfig(agent.whatsappConfig);
    } catch {}
  }

  res.json({ data: { ...agent, whatsappConfig } });
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params as { id: string };
  if (req.user?.role === 'employee') {
    throw new AppError(403, 'FORBIDDEN', 'Employees cannot edit agents');
  }
  if (req.user?.role === 'admin') {
    throw new AppError(403, 'FORBIDDEN', 'Admins cannot edit agent configuration');
  }
  await assertAgentAccess(id, req.user!);

  const body = updateAgentSchema.parse(req.body);
  const data: Record<string, unknown> = { ...body };

  if (data.activeHours === null) data.activeHours = Prisma.DbNull;
  if (data.businessHours === null) data.businessHours = Prisma.DbNull;

  if (data.calendarConfig !== undefined) {
    const existing = await prisma.agent.findUnique({ where: { id }, select: { calendarConfig: true } });
    data.calendarConfig = { ...(existing?.calendarConfig as Record<string, unknown> ?? {}), ...(data.calendarConfig as Record<string, unknown>) };
  }

  if (data.modelConfig !== undefined) {
    const existing = await prisma.agent.findUnique({ where: { id }, select: { modelConfig: true } });
    const prev = (existing?.modelConfig ?? {}) as Record<string, unknown>;
    const next = data.modelConfig as Record<string, unknown>;
    data.modelConfig = {
      ...prev,
      ...next,
      ...(next.generation ? { generation: { ...(prev.generation as object ?? {}), ...(next.generation as object) } } : {}),
      ...(next.vad        ? { vad:        { ...(prev.vad        as object ?? {}), ...(next.vad        as object) } } : {}),
    };
  }

  if (data.whatsappConfig !== undefined) {
    if (data.whatsappConfig === null) {
      data.whatsappConfig = null;
    } else {
      data.whatsappConfig = encryptConfig(data.whatsappConfig as object);
    }
  }

  const agent = await prisma.agent.update({ where: { id }, data });
  res.json({ data: agent });
});

router.delete('/:id', requireSuperAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  await prisma.agent.delete({ where: { id } });
  res.json({ data: { success: true } });
});

router.post('/:id/regenerate-key', requireSuperAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  const agent = await prisma.agent.update({
    where: { id },
    data: { apiKey: generateApiKey() },
  });
  res.json({ data: { apiKey: agent.apiKey } });
});

router.post('/:id/webhook-test', requireSuperAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  const agent = await prisma.agent.findUnique({ where: { id }, select: { webhookUrl: true, webhookSecret: true } });
  if (!agent?.webhookUrl) throw new AppError(400, 'NO_WEBHOOK', 'No webhook URL configured');
  res.json({ data: await sendWebhookTest(agent.webhookUrl, agent.webhookSecret, id) });
});

router.post('/:id/appointment-webhook-test', requireSuperAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  const agent = await prisma.agent.findUnique({ where: { id }, select: { appointmentWebhookUrl: true, appointmentWebhookSecret: true } });
  if (!agent?.appointmentWebhookUrl) throw new AppError(400, 'NO_WEBHOOK', 'No appointment webhook URL configured');
  res.json({ data: await sendWebhookTest(agent.appointmentWebhookUrl, agent.appointmentWebhookSecret, id) });
});

router.patch('/:id/status', async (req, res) => {
  const { id } = req.params as { id: string };
  if (req.user?.role === 'employee') {
    throw new AppError(403, 'FORBIDDEN', 'Employees cannot change agent status');
  }
  await assertAgentAccess(id, req.user!);

  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) {
    throw new AppError(400, 'INVALID_INPUT', 'Status must be active or inactive');
  }
  const agent = await prisma.agent.update({ where: { id }, data: { status } });
  res.json({ data: agent });
});

router.post('/:id/outbound', async (req, res) => {
  const { id } = req.params as { id: string };
  await assertAgentAccess(id, req.user!);

  const { phone: rawPhone, contactName, gender, context } = req.body;
  if (!rawPhone) throw new AppError(400, 'INVALID_INPUT', 'Phone number required');

  const phone = normalizePhone(rawPhone);
  const agent = await prisma.agent.findUnique({ where: { id } });
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
    { attempts: 2, backoff: { type: 'fixed', delay: 8000 }, priority: OUTBOUND_PRIORITY.campaign },
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
