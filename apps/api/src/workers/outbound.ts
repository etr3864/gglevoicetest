import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { normalizePhone } from '../lib/phone';
import { createWorker } from '../lib/queue';
import { createOutboundCall } from '../services/telnyx';
import { createSession, warmup } from '../services/call';
import { publishCallEvent } from '../services/events/pubsub';

const log = createLogger('outbound-worker');

interface OutboundJob {
  callId: string;
  agentId: string;
  contactId: string;
  phone: string;
  context?: Record<string, unknown>;
}

function extractTelnyxError(err: unknown): { code?: string; reason?: string } {
  const msg = err instanceof Error ? err.message : String(err);
  try {
    const json = JSON.parse(msg.slice(msg.indexOf('{')));
    const detail = json.errors?.[0]?.detail || json.telnyx_error?.error_code;
    const code = json.telnyx_error?.error_code;
    return { code, reason: detail };
  } catch {
    return { reason: msg.slice(0, 200) };
  }
}

export function startOutboundWorker() {
  const worker = createWorker<OutboundJob>('outbound-calls', async (job) => {
    const { callId, agentId, phone, context } = job.data;
    const isRetry = job.attemptsMade > 0;

    const t0 = Date.now();
    const agent = await validateAgent(callId, agentId);
    await markCalling(callId, agentId, isRetry);
    log.info('Call queued', { callId, to: phone, agentId, attempt: job.attemptsMade + 1 });

    warmup(callId, agentId, phone, context).catch((err) => {
      log.error('Warmup failed', err, { callId });
    });

    const callControlId = await resolveCallControlId(agent, phone, callId, agentId);
    log.info('Call dialing', { callId, elapsed: Date.now() - t0 });

    await createSession({ callId, agentId, callControlId, contactPhone: phone, direction: 'outbound', callContext: context });
  }, { concurrency: parseInt(process.env.OUTBOUND_CONCURRENCY || '20') });

  worker.on('failed', (job, err) => {
    const data = job?.data;
    log.error('Job failed', undefined, {
      jobId: job?.id,
      callId: data?.callId,
      phone: data?.phone,
      reason: err?.message?.slice(0, 150),
    });
  });

  return worker;
}

async function validateAgent(callId: string, agentId: string) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  const appId = agent?.telnyxAppId || process.env.TELNYX_APP_ID;

  if (!agent || !agent.phoneNumber || !appId) {
    const missing = !agent ? 'agent not found' : !agent.phoneNumber ? 'no phone number' : 'no Telnyx App ID';
    log.error('Agent validation failed', undefined, { callId, agentId, missing });
    const call = await prisma.call.update({ where: { id: callId }, data: { status: 'failed' } });
    await publishCallEvent(agentId, 'call_updated', { call });
    throw new Error(`Agent ${agentId}: ${missing}`);
  }

  return { ...agent, telnyxAppId: appId };
}

async function markCalling(callId: string, agentId: string, isRetry = false): Promise<void> {
  const call = await prisma.call.update({
    where: { id: callId },
    data: { status: 'calling', ...(isRetry && { retryCount: { increment: 1 } }) },
  });
  await publishCallEvent(agentId, 'call_updated', { call });
}

async function resolveCallControlId(
  agent: { phoneNumber: string | null; telnyxAppId: string | null },
  phone: string,
  callId: string,
  agentId: string,
): Promise<string> {
  const existing = await prisma.call.findUnique({ where: { id: callId }, select: { callControlId: true } });
  if (existing?.callControlId) return existing.callControlId;

  const { callControlId } = await dialOutbound(agent, phone, callId, agentId);
  await prisma.call.update({ where: { id: callId }, data: { callControlId } });
  return callControlId;
}

async function dialOutbound(
  agent: { phoneNumber: string | null; telnyxAppId: string | null },
  phone: string,
  callId: string,
  agentId: string,
) {
  const webhookUrl = `${process.env.API_URL}/webhooks/telnyx`;
  const from = normalizePhone(agent.phoneNumber!);
  const to = normalizePhone(phone);

  try {
    const result = await createOutboundCall({
      from,
      to,
      connectionId: agent.telnyxAppId!,
      webhookUrl,
      clientState: JSON.stringify({ callId, agentId }),
    });
    log.info('Outbound call started', { callId, to, from });
    return result;
  } catch (err) {
    const detail = extractTelnyxError(err);
    log.error('Dial failed', undefined, { callId, from, to, ...detail });
    const call = await prisma.call.update({ where: { id: callId }, data: { status: 'failed' } });
    await publishCallEvent(agentId, 'call_updated', { call });
    throw err;
  }
}
