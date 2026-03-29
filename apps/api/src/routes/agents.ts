import { Router } from 'express';
import path from 'path';
import crypto from 'crypto';
import { prisma, Prisma } from '@voice/db';
import { createAgentSchema, updateAgentSchema } from '@voice/shared';
import { AppError } from '../middleware/error-handler';
import { requireSuperAdmin, assertAgentAccess } from '../middleware/auth';
import { outboundQueue, OUTBOUND_PRIORITY } from '../lib/queue';
import { normalizePhone } from '../lib/phone';
import { publishCallEvent } from '../services/events/pubsub';
import { encryptConfig, decryptConfig } from '../services/whatsapp/config-crypto';
import { createLogger } from '../lib/logger';

const log = createLogger('agents');

const META_ERROR_MESSAGES: Record<number, string> = {
  190: 'טוקן פג תוקף — צור System User Token חדש ב-Meta Business',
  100: 'פרטים לא תקינים — בדוק את ה-WABA ID וה-Access Token',
  200: 'אין הרשאות מספיקות לטוקן זה',
};

async function validateMetaCredentials(wabaId: string, accessToken: string): Promise<string | undefined> {
  const url = `https://graph.facebook.com/v22.0/${wabaId}?fields=id&access_token=${accessToken}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) return undefined;
    const body = await res.json().catch(() => ({})) as { error?: { code?: number } };
    const code = body.error?.code;
    const msg = (code !== undefined ? META_ERROR_MESSAGES[code] : undefined) ?? `שגיאת Meta (קוד ${code ?? res.status})`;
    throw new AppError(400, 'INVALID_META_CREDENTIALS', msg);
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.warn('Meta credential validation timed out — saving anyway');
    return 'לא הצלחנו לאמת את פרטי Meta — נסה לסנכרן תבניות כדי לוודא שהחיבור תקין';
  }
}

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

  let validationWarning: string | undefined;
  if (data.whatsappConfig !== undefined) {
    if (data.whatsappConfig === null) {
      data.whatsappConfig = null;
    } else {
      const cfg = data.whatsappConfig as Record<string, unknown>;
      if (data.whatsappProvider === 'meta' && cfg.wabaId && cfg.accessToken) {
        validationWarning = await validateMetaCredentials(String(cfg.wabaId), String(cfg.accessToken));
      }
      data.whatsappConfig = encryptConfig(cfg);
    }
  }

  const agent = await prisma.agent.update({ where: { id }, data });
  res.json({ data: agent, ...(validationWarning && { validationWarning }) });
});

const AMBIENT_PREVIEW_TYPES = new Set(['office', 'cafe', 'restaurant', 'city', 'people_talking']);

router.get('/:id/ambient/preview/:type', async (req, res) => {
  const { id, type } = req.params as { id: string; type: string };
  await assertAgentAccess(id, req.user!);

  const t = type.toLowerCase();
  if (!AMBIENT_PREVIEW_TYPES.has(t)) throw new AppError(400, 'INVALID_TYPE', 'Unknown ambient type');

  const filePath = path.resolve(process.cwd(), 'assets', 'ambient', 'preview', `${t}.wav`);
  res.setHeader('Content-Type', 'audio/wav');
  res.sendFile(filePath);
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
