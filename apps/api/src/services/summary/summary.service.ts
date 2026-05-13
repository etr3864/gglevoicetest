import { prisma, Prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { generateText } from '../../lib/gemini-text';
import { webhookQueue, appointmentWebhookQueue } from '../../lib/queue';
import { upsertMonthlyUsage } from '../usage/usage.service';
import type { AppointmentEvent } from '../calendar/appointment-webhook.service';

const log = createLogger('summary');

const DEFAULT_SUMMARY_PROMPT = `You are summarizing a phone call for a business manager.
Write a short, clear, and informative summary.
Focus on: what the customer wanted, what was discussed, and the next step.
Be concise. No formatting, no bullet points — plain text only.`;

const MAX_TRANSCRIPT_CHARS = 80_000;

export async function generateCallSummary(callId: string): Promise<void> {
  const data = await fetchCallData(callId);
  if (!data) return;

  const { call, agent, utterances } = data;
  const pendingAppointments = await fetchPendingAppointments(callId);
  const hasAppointment = pendingAppointments.length > 0;

  let summaryId: string | null = null;

  if (isEligible(call, agent, utterances.length, hasAppointment)) {
    summaryId = await tryGenerateAndSaveSummary({
      call, agent, utterances,
      callId,
      routeToAppointmentWebhook: hasAppointment,
      throwOnFailure: !hasAppointment,
    });
  }

  if (hasAppointment) {
    await dispatchAppointmentWebhooks(pendingAppointments);
  } else if (summaryId && agent.webhookUrl) {
    await webhookQueue.add('deliver', { summaryId }, { jobId: `webhook-${summaryId}` });
  }
}

async function tryGenerateAndSaveSummary(params: {
  call: { direction: string; durationSec: number | null; startedAt: Date | null; context: unknown };
  agent: { id: string; name: string; summaryPrompt: string | null; webhookUrl: string | null };
  utterances: { speaker: string; text: string; startMs: number }[];
  callId: string;
  routeToAppointmentWebhook: boolean;
  throwOnFailure: boolean;
}): Promise<string | null> {
  const { call, agent, utterances, callId, routeToAppointmentWebhook, throwOnFailure } = params;
  const prompt = buildPrompt(call, agent, utterances);
  const t0 = Date.now();

  let result;
  try {
    result = await generateText(agent.summaryPrompt || DEFAULT_SUMMARY_PROMPT, prompt);
  } catch (err) {
    log.error('Gemini summary failed', err, { callId });
    if (throwOnFailure) throw err;
    return null;
  }

  log.info('Summary generated', { callId, tokenCount: result.tokenCount, latencyMs: Date.now() - t0 });

  const webhookStatus = routeToAppointmentWebhook
    ? 'ROUTED_TO_APPOINTMENT'
    : (agent.webhookUrl ? 'PENDING' : 'NONE');
  const summary = await saveSummary({
    callId,
    agentId: agent.id,
    summaryText: result.text,
    tokenCount: result.tokenCount,
    utteranceCount: utterances.length,
    callDurationSec: call.durationSec ?? 0,
    webhookStatus,
  });

  if (summary && result.tokenCount) {
    upsertMonthlyUsage(agent.id, { totalSummaryTokens: result.tokenCount })
      .catch((err) => log.error('Failed to upsert summary usage', err, { callId }));
  }

  return summary?.id ?? null;
}

interface PendingAppointment {
  id: string;
  event: AppointmentEvent;
}

async function fetchPendingAppointments(callId: string): Promise<PendingAppointment[]> {
  const rows = await prisma.appointment.findMany({
    where: { pendingWebhookCallId: callId, pendingWebhookEvent: { not: null } },
    select: { id: true, pendingWebhookEvent: true },
  });
  return rows
    .filter((r): r is { id: string; pendingWebhookEvent: AppointmentEvent } => !!r.pendingWebhookEvent)
    .map((r) => ({ id: r.id, event: r.pendingWebhookEvent }));
}

async function dispatchAppointmentWebhooks(pending: PendingAppointment[]): Promise<void> {
  for (const appt of pending) {
    try {
      await appointmentWebhookQueue.add(
        'deliver',
        { appointmentId: appt.id, event: appt.event },
        { jobId: `appt-webhook-${appt.id}-${appt.event}` },
      );
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { pendingWebhookEvent: null, pendingWebhookCallId: null },
      });
    } catch (err) {
      log.error('Failed to enqueue appointment webhook', err, { appointmentId: appt.id, event: appt.event });
    }
  }
}

async function fetchCallData(callId: string) {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: {
      agent: true,
      contact: { select: { name: true, phone: true } },
      utterances: { orderBy: { startMs: 'asc' } },
    },
  });

  if (!call) {
    log.warn('Call not found for summary', { callId });
    return null;
  }

  return { call, agent: call.agent, utterances: call.utterances };
}

function isEligible(
  call: { durationSec: number | null; status: string },
  agent: { summaryEnabled: boolean; summaryMinDuration: number },
  utteranceCount: number,
  hasAppointment: boolean,
): boolean {
  if (!agent.summaryEnabled) return false;
  if (utteranceCount === 0) return false;

  if (!hasAppointment) {
    const duration = call.durationSec ?? 0;
    if (duration < agent.summaryMinDuration) return false;
  }

  return true;
}

function buildPrompt(
  call: { direction: string; durationSec: number | null; startedAt: Date | null; context: unknown },
  agent: { name: string },
  utterances: { speaker: string; text: string; startMs: number }[],
): string {
  const duration = formatDuration(call.durationSec ?? 0);
  const date = call.startedAt ? new Date(call.startedAt).toISOString() : 'unknown';

  const lines: string[] = [
    `Direction: ${call.direction}`,
    `Duration: ${duration}`,
    `Date: ${date}`,
    `Agent: ${agent.name}`,
  ];

  if (call.context && typeof call.context === 'object' && Object.keys(call.context).length > 0) {
    lines.push(`Call Context: ${JSON.stringify(call.context)}`);
  }

  lines.push('', 'Transcript:');

  const transcriptLines = utterances.map(u => `[${u.speaker}]: ${u.text}`);
  const transcriptStr = transcriptLines.join('\n');

  if (transcriptStr.length > MAX_TRANSCRIPT_CHARS) {
    const truncated = truncateTranscript(utterances);
    lines.push(`[Transcript truncated — showing last ${truncated.length} utterances]`);
    lines.push(...truncated.map(u => `[${u.speaker}]: ${u.text}`));
  } else {
    lines.push(transcriptStr);
  }

  return lines.join('\n');
}

function truncateTranscript(
  utterances: { speaker: string; text: string; startMs: number }[],
): typeof utterances {
  let chars = 0;
  const result: typeof utterances = [];
  for (let i = utterances.length - 1; i >= 0; i--) {
    chars += utterances[i].text.length + 12;
    if (chars > MAX_TRANSCRIPT_CHARS) break;
    result.unshift(utterances[i]);
  }
  return result;
}

async function saveSummary(params: {
  callId: string;
  agentId: string;
  summaryText: string;
  tokenCount: number | null;
  utteranceCount: number;
  callDurationSec: number;
  webhookStatus: string;
}) {
  try {
    return await prisma.callSummary.create({ data: params });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      log.info('Summary already exists (dedup)', { callId: params.callId });
      return null;
    }
    throw err;
  }
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

