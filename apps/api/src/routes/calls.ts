import { Router } from 'express';
import * as XLSX from 'xlsx';
import { prisma } from '@voice/db';
import { AppError } from '../middleware/error-handler';
import { assertAgentAccess, requireSuperAdmin, requireAdminOrAbove } from '../middleware/auth';
import { enqueueWebhookRetry } from '../services/summary/webhook.service';
import { createLogger } from '../lib/logger';

const router = Router();
const log = createLogger('calls');

const VALID_DIRECTIONS = new Set(['inbound', 'outbound', 'no_answer']);

type CallFilterParams = { from?: string; to?: string; direction?: string; q?: string };
type AgentInfo = { name: string; user: { name: string | null; companyName: string | null } | null } | null;

function firstStr(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
  return typeof v === 'string' ? v : undefined;
}

function parseFilterParams(query: Record<string, unknown>): CallFilterParams {
  const from = firstStr(query.from);
  const to = firstStr(query.to);
  const direction = firstStr(query.direction);
  const q = firstStr(query.q);
  if (from && isNaN(Date.parse(from))) throw new AppError(400, 'INVALID_PARAM', 'Invalid from date');
  if (to && isNaN(Date.parse(to))) throw new AppError(400, 'INVALID_PARAM', 'Invalid to date');
  if (direction && !VALID_DIRECTIONS.has(direction)) throw new AppError(400, 'INVALID_PARAM', 'Invalid direction');
  return { from, to, direction, q };
}

function buildCallWhere(agentId: string, p: CallFilterParams) {
  const q = p.q && p.q.trim().length >= 3 ? p.q.trim() : undefined;
  return {
    agentId,
    ...(p.from || p.to ? { createdAt: {
      ...(p.from ? { gte: new Date(p.from) } : {}),
      ...(p.to ? { lte: new Date(p.to) } : {}),
    } } : {}),
    ...(p.direction === 'no_answer' ? { direction: 'outbound', status: 'no_answer' }
      : p.direction ? { direction: p.direction } : {}),
    ...(q ? { contact: { OR: [
      { phone: { contains: q, mode: 'insensitive' as const } },
      { name: { contains: q, mode: 'insensitive' as const } },
    ] } } : {}),
  };
}

router.get('/agents/:id/calls', async (req, res) => {
  await assertAgentAccess(req.params.id, req.user!);

  const params = parseFilterParams(req.query as Record<string, unknown>);
  const page = Math.max(1, parseInt(firstStr(req.query.page) ?? '') || 1);
  const limit = Math.min(100, Math.max(1, parseInt(firstStr(req.query.limit) ?? '') || 25));
  const where = buildCallWhere(req.params.id, params);

  const [calls, total] = await Promise.all([
    prisma.call.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        contact: { select: { phone: true, name: true } },
        _count: { select: { utterances: true } },
      },
    }),
    prisma.call.count({ where }),
  ]);

  res.json({
    data: calls.map(c => ({ ...c, transcriptSaved: c._count.utterances > 0 })),
    meta: { page, limit, total },
  });
});

async function fetchCallBatches(where: ReturnType<typeof buildCallWhere>) {
  const results: any[] = [];
  let cursor: string | undefined;

  do {
    const batch = await prisma.call.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, direction: true, durationSec: true, createdAt: true,
        contact: { select: { name: true, phone: true } },
        utterances: { select: { speaker: true, text: true, startMs: true }, orderBy: { startMs: 'asc' } },
        summary: { select: { summaryText: true } },
      },
    });
    results.push(...batch);
    cursor = batch.length === 500 ? batch[batch.length - 1].id : undefined;
  } while (cursor);

  return results;
}

function formatCallRow(call: any, agentInfo: AgentInfo): (string | number)[] {
  const transcript = (call.utterances as any[]).map(u => `${u.speaker}: ${u.text}`).join('\n');
  const row: (string | number)[] = [
    call.contact?.name ?? '',
    call.contact?.phone ?? '',
    call.direction === 'inbound' ? 'נכנסת' : 'יוצאת',
    new Date(call.createdAt).toLocaleString('he-IL'),
    call.durationSec != null ? Math.round(call.durationSec / 60) : '',
    call.summary?.summaryText ?? '',
    transcript,
  ];
  if (agentInfo) row.push(agentInfo.name, agentInfo.user?.companyName ?? agentInfo.user?.name ?? '');
  return row;
}

function buildExportWorkbook(calls: any[], agentInfo: AgentInfo, total: number, params: CallFilterParams): Buffer {
  const wb = XLSX.utils.book_new();
  const rangeLabel = params.from
    ? `${new Date(params.from).toLocaleDateString('he-IL')} — ${params.to ? new Date(params.to).toLocaleDateString('he-IL') : 'היום'}`
    : 'כל הזמנים';
  const totalMinutes = Math.round(calls.reduce((s, c) => s + (c.durationSec ?? 0), 0) / 60);

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['טווח', rangeLabel],
    ['סה"כ שיחות', total],
    ['סה"כ דקות שיחה', totalMinutes],
    ['תאריך ייצוא', new Date().toLocaleString('he-IL')],
  ]), 'סיכום');

  const baseHeaders = ['שם לקוח', 'טלפון', 'כיוון', 'תאריך ושעה', 'משך (דקות)', 'סיכום', 'תמלול'];
  const headers = agentInfo ? [...baseHeaders, 'שם סוכן', 'שם עסק'] : baseHeaders;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    headers,
    ...calls.map(c => formatCallRow(c, agentInfo)),
  ]), 'שיחות');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

router.get('/agents/:id/calls/export', requireAdminOrAbove, async (req, res) => {
  const { id: agentId } = req.params as { id: string };
  await assertAgentAccess(agentId, req.user!);

  const params = parseFilterParams(req.query as Record<string, unknown>);
  const isSuperAdmin = req.user!.role === 'super_admin';
  const where = buildCallWhere(agentId, params);

  const total = await prisma.call.count({ where });
  if (total > 10_000) log.warn('Large export requested', { agentId, total });

  let agentInfo: AgentInfo = null;
  if (isSuperAdmin) {
    const raw = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { name: true, user: { select: { name: true, companyName: true } } },
    });
    agentInfo = raw as AgentInfo;
  }

  const calls = await fetchCallBatches(where);
  const buf = buildExportWorkbook(calls, agentInfo, total, params);
  const dateStr = new Date().toISOString().slice(0, 10);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="calls-${agentId.slice(0, 8)}-${dateStr}.xlsx"`);
  res.send(buf);
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
    select: { id: true, content: true, createdAt: true, status: true, mediaType: true, mediaName: true, templateName: true },
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
  if (summary.webhookStatus === 'ROUTED_TO_APPOINTMENT') {
    throw new AppError(400, 'ROUTED_TO_APPOINTMENT', 'Summary was delivered via the appointment webhook for this call');
  }
  await enqueueWebhookRetry(summary.id);
  res.json({ data: { queued: true } });
});

export default router;
