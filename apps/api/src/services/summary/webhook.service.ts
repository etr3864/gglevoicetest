import crypto from 'crypto';
import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { webhookQueue } from '../../lib/queue';

const log = createLogger('webhook');

const SEND_TIMEOUT_MS = 10_000;

export async function deliverWebhook(summaryId: string): Promise<void> {
  const row = await prisma.callSummary.findUnique({
    where: { id: summaryId },
    include: {
      call: {
        include: {
          contact: { select: { name: true, phone: true } },
          appointments: { select: { id: true }, take: 1, orderBy: { createdAt: 'desc' } },
        },
      },
      agent: { select: { id: true, name: true, webhookUrl: true, webhookSecret: true, webhookRetryCount: true, webhookRetryDelay: true } },
    },
  });

  if (!row || !row.agent.webhookUrl) return;

  const payload = buildPayload(row);
  const { success, statusCode, error } = await sendPost(row.agent.webhookUrl, payload, row.agent.webhookSecret);

  if (success) {
    await prisma.callSummary.update({
      where: { id: summaryId },
      data: { webhookStatus: 'SENT', webhookSentAt: new Date(), webhookAttempts: { increment: 1 } },
    });
    log.info('Webhook sent', { summaryId, statusCode });
    return;
  }

  const attempts = row.webhookAttempts + 1;
  const isPermanentFailure = isClientError(statusCode) || attempts >= row.agent.webhookRetryCount;

  await prisma.callSummary.update({
    where: { id: summaryId },
    data: {
      webhookAttempts: attempts,
      webhookLastError: error,
      webhookStatus: isPermanentFailure ? 'FAILED' : 'PENDING',
    },
  });

  if (isPermanentFailure) {
    log.error('Webhook permanently failed', undefined, { summaryId, attempts, error });
    return;
  }

  log.warn('Webhook failed, scheduling retry', { summaryId, attempts, statusCode });
  await webhookQueue.add(
    'deliver',
    { summaryId },
    { jobId: `webhook-${summaryId}-${attempts}`, delay: row.agent.webhookRetryDelay * 1000 },
  );
}

export async function enqueueWebhookRetry(summaryId: string): Promise<void> {
  await webhookQueue.add('deliver', { summaryId }, { jobId: `webhook-${summaryId}-manual` });
}

function buildPayload(row: SummaryWithRelations): Record<string, unknown> {
  const { call, agent } = row;
  return {
    event: 'call_summary',
    timestamp: new Date().toISOString(),
    agent_id: agent.id,
    agent_name: agent.name,
    call_id: call.id,
    direction: call.direction,
    duration_sec: row.callDurationSec,
    started_at: call.startedAt?.toISOString() ?? null,
    ended_at: call.endedAt?.toISOString() ?? null,
    customer_name: call.contact?.name ?? null,
    customer_phone: call.contact?.phone ?? null,
    recording_url: call.recordingUrl ?? null,
    utterance_count: row.utteranceCount,
    call_context: call.context ?? null,
    summary: row.summaryText,
    appointment_id: call.appointments?.[0]?.id ?? null,
  };
}

async function sendPost(
  url: string,
  payload: Record<string, unknown>,
  secret: string | null,
): Promise<{ success: boolean; statusCode: number | null; error: string | null }> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (secret) {
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    headers['X-Signature'] = `sha256=${sig}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    return { success: res.ok, statusCode: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { success: false, statusCode: null, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

function isClientError(statusCode: number | null): boolean {
  return statusCode !== null && statusCode >= 400 && statusCode < 500 && statusCode !== 429;
}

interface SummaryWithRelations {
  id: string;
  summaryText: string;
  utteranceCount: number;
  callDurationSec: number;
  webhookAttempts: number;
  call: {
    id: string;
    direction: string;
    startedAt: Date | null;
    endedAt: Date | null;
    recordingUrl: string | null;
    context: unknown;
    contact: { name: string | null; phone: string } | null;
    appointments: { id: string }[];
  };
  agent: {
    id: string;
    name: string;
    webhookUrl: string | null;
    webhookSecret: string | null;
    webhookRetryCount: number;
    webhookRetryDelay: number;
  };
}
