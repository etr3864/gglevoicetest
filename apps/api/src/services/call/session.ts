import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { redis } from '../../lib/redis';
import { summaryQueue, followupEvalQueue } from '../../lib/queue';
import type { TranscriptEntry, TokenUsage } from '../providers/types';
import { publishCallEvent } from '../events/pubsub';
import { handleReminderCallEnded } from '../reminders/reminder.service';
import { upsertMonthlyUsage } from '../usage/usage.service';
import { pauseActiveFollowup } from '../followup/followup.cancel';

const log = createLogger('session');
const SESSION_TTL_SEC = 7200;

export interface CallSession {
  callId: string;
  agentId: string;
  callControlId: string;
  contactPhone: string | null;
  direction: 'inbound' | 'outbound';
  startedAt: string;
  callContext?: Record<string, unknown>;
}

export async function addTranscript(callControlId: string, entry: TranscriptEntry): Promise<void> {
  const transcriptsKey = `call:transcripts:${callControlId}`;
  
  const existingRaw = await redis.lrange(transcriptsKey, -1, -1);
  
  if (existingRaw.length > 0) {
    const lastEntry = JSON.parse(existingRaw[0]);
    
    if (lastEntry.speaker === entry.speaker) {
      lastEntry.text = `${lastEntry.text} ${entry.text}`.trim();
      
      await redis.rpop(transcriptsKey);
      await redis.rpush(transcriptsKey, JSON.stringify(lastEntry));
      return;
    }
  }

  const data = JSON.stringify({
    ...entry,
    timestamp: entry.timestamp.toISOString(),
  });
  await redis.rpush(transcriptsKey, data);
  await redis.ltrim(transcriptsKey, -500, -1);
  await redis.expire(transcriptsKey, SESSION_TTL_SEC);
}

export async function getTranscripts(callControlId: string): Promise<TranscriptEntry[]> {
  const data = await redis.lrange(`call:transcripts:${callControlId}`, 0, -1);
  return data.map((d) => {
    const parsed = JSON.parse(d);
    return {
      ...parsed,
      timestamp: new Date(parsed.timestamp),
    };
  });
}

export async function createSession(params: {
  callId: string;
  agentId: string;
  callControlId: string;
  contactPhone: string | null;
  direction?: 'inbound' | 'outbound';
  callContext?: Record<string, unknown>;
}): Promise<CallSession> {
  const session: CallSession = {
    ...params,
    direction: params.direction ?? 'inbound',
    startedAt: new Date().toISOString(),
  };

  await redis.set(`call:session:${params.callControlId}`, JSON.stringify(session), 'EX', SESSION_TTL_SEC);
  await redis.set(`call:session_by_id:${params.callId}`, params.callControlId, 'EX', SESSION_TTL_SEC);

  return session;
}

export async function getSession(callControlId: string): Promise<CallSession | undefined> {
  const data = await redis.get(`call:session:${callControlId}`);
  if (!data) return undefined;
  return JSON.parse(data) as CallSession;
}

export async function getSessionByCallId(callId: string): Promise<CallSession | undefined> {
  const callControlId = await redis.get(`call:session_by_id:${callId}`);
  if (!callControlId) return undefined;
  return getSession(callControlId);
}

export async function endSession(callControlId: string): Promise<void> {
  const session = await getSession(callControlId);
  if (!session) return;

  // Use Redis atomic delete to guarantee only the first caller executes the cleanup
  const deleted = await redis.del(`call:session:${callControlId}`);
  if (deleted === 0) return;

  const transcripts = await getTranscripts(callControlId);
  const durationSec = Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000);

  const usageRaw = await redis.get(`call:usage:${callControlId}`);
  const tokenUsage: TokenUsage | null = usageRaw ? JSON.parse(usageRaw) : null;

  await redis.del(`call:session_by_id:${session.callId}`);
  await redis.del(`call:transcripts:${callControlId}`);
  await redis.del(`call:usage:${callControlId}`);
  await redis.publish('call:disconnect', callControlId);

  const isReminder = session.callContext?.callType === 'reminder';

  await finalizeCallRecord(session, durationSec, tokenUsage);
  await persistUtterances(session, transcripts);
  await updateContactStats(session, durationSec);

  if (isReminder) {
    const reminderId = session.callContext?.reminderId as string | undefined;
    if (reminderId) {
      const callRecord = await prisma.call.findUnique({ where: { id: session.callId }, select: { status: true } });
      handleReminderCallEnded(reminderId, callRecord?.status ?? 'failed')
        .catch((err) => log.error('Failed to handle reminder call ended', err, { reminderId }));
    }
  } else {
    summaryQueue
      .add('generate', { callId: session.callId }, { jobId: `summary-${session.callId}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } })
      .catch((err) => log.error('Failed to enqueue summary', err, { callId: session.callId }));
  }

  handleFollowupAfterCall(session, durationSec)
    .catch((err) => log.error('Failed to handle followup after call', err, { callId: session.callId }));

  const customerUtterances = transcripts.filter(t => t.speaker === 'customer').length;
  const agentUtterances = transcripts.filter(t => t.speaker === 'agent').length;

  log.info('Call ended', {
    callId: session.callId,
    durationSec,
    customerUtterances,
    agentUtterances,
    transcriptCount: transcripts.length,
  });
}

// Delays sum to ~6.7s. First check is immediate (before first delay).
const SESSION_RETRY_DELAYS = [200, 500, 1000, 2000, 3000];

export async function waitForSession(callControlId: string): Promise<CallSession | undefined> {
  for (const delay of SESSION_RETRY_DELAYS) {
    const session = await getSession(callControlId);
    if (session) return session;
    await new Promise((r) => setTimeout(r, delay));
  }
  return getSession(callControlId);
}

export async function activeSessionCount(): Promise<number> {
  let count = 0;
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'call:session:*', 'COUNT', 100);
    cursor = next;
    count += keys.length;
  } while (cursor !== '0');
  return count;
}

async function finalizeCallRecord(session: CallSession, durationSec: number, tokens: TokenUsage | null): Promise<void> {
  try {
    const current = await prisma.call.findUnique({ where: { id: session.callId }, select: { status: true } });
    if (!current) return;

    const finalStatus = current.status === 'in_call' ? 'completed' : current.status;
    const telnyxBilledSec = Math.ceil(durationSec / 60) * 60;
    const deepgramSec = durationSec * 2;

    const call = await prisma.call.update({
      where: { id: session.callId },
      data: {
        status: finalStatus,
        endedAt: new Date(),
        durationSec,
        telnyxBilledSec,
        deepgramSec,
        ...(tokens && {
          audioInputTokens: tokens.audioInputTokens,
          audioOutputTokens: tokens.audioOutputTokens,
          textInputTokens: tokens.textInputTokens,
          textOutputTokens: tokens.textOutputTokens,
        }),
      },
    });

    await publishCallEvent(session.agentId, 'call_updated', { call });

    upsertMonthlyUsage(session.agentId, {
      callCount: 1,
      totalDurationSec: durationSec,
      totalBilledSec: telnyxBilledSec,
      totalDeepgramSec: deepgramSec,
      ...(tokens && {
        totalAudioInputTokens: tokens.audioInputTokens,
        totalAudioOutputTokens: tokens.audioOutputTokens,
        totalTextInputTokens: tokens.textInputTokens,
        totalTextOutputTokens: tokens.textOutputTokens,
      }),
    }).catch((err) => log.error('Failed to upsert monthly usage', err, { callId: session.callId }));
  } catch (err) {
    log.error('Failed to update call record', err, { callId: session.callId });
  }
}

async function persistUtterances(session: CallSession, transcripts: TranscriptEntry[]): Promise<void> {
  if (transcripts.length === 0) return;

  try {
    const baseTime = new Date(session.startedAt).getTime();
    await prisma.utterance.createMany({
      data: transcripts.map((t) => ({
        callId: session.callId,
        speaker: t.speaker,
        text: t.text,
        startMs: Math.max(0, t.timestamp.getTime() - baseTime),
        endMs: Math.max(0, t.timestamp.getTime() - baseTime + 500),
      })),
    });
    
    await publishCallEvent(session.agentId, 'call_updated', { 
      call: { id: session.callId, transcriptSaved: true } 
    });
  } catch (err) {
    log.error('Failed to save utterances', err, { callId: session.callId });
  }
}

const FOLLOWUP_EVAL_DELAY_MS = 2000;

async function handleFollowupAfterCall(session: CallSession, durationSec: number): Promise<void> {
  const dncFlag = await redis.get(`dnc:${session.callId}`);
  if (dncFlag) return;

  const call = await prisma.call.findUnique({
    where: { id: session.callId },
    select: { status: true, disposition: true, contactId: true, callType: true },
  });
  if (!call) return;

  const config = await prisma.followupConfig.findUnique({
    where: { agentId: session.agentId },
    select: { enabled: true },
  });
  if (!config?.enabled) return;

  if (session.direction === 'inbound' && call.contactId) {
    pauseActiveFollowup(call.contactId, session.agentId).catch(() => {});
  }

  if (!call.disposition && (call.status === 'failed' || call.status === 'no_answer')) {
    await prisma.call.update({
      where: { id: session.callId },
      data: { disposition: call.status },
    });
  }

  await followupEvalQueue.add(
    'evaluate',
    { callId: session.callId },
    { delay: FOLLOWUP_EVAL_DELAY_MS, jobId: `followup-eval-${session.callId}` },
  );
}

async function updateContactStats(session: CallSession, durationSec: number): Promise<void> {
  if (!session.contactPhone) return;

  try {
    await prisma.contact.upsert({
      where: { phone_agentId: { phone: session.contactPhone, agentId: session.agentId } },
      create: {
        phone: session.contactPhone,
        agentId: session.agentId,
        totalCalls: 1,
        totalDurationSec: durationSec,
        lastCallAt: new Date(),
      },
      update: {
        totalCalls: { increment: 1 },
        totalDurationSec: { increment: durationSec },
        lastCallAt: new Date(),
      },
    });
  } catch (err) {
    log.warn('Failed to update contact stats', { phone: session.contactPhone?.slice(-4), err: String(err) });
  }
}
