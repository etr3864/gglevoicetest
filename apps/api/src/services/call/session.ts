import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { redis } from '../../lib/redis';
import { summaryQueue } from '../../lib/queue';
import type { TranscriptEntry } from '../providers/types';
import { publishCallEvent } from '../events/pubsub';
import { handleReminderCallEnded } from '../reminders/reminder.service';

const log = createLogger('session');
const SESSION_COUNT_KEY = 'call:session_count';
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
  await redis.incr(SESSION_COUNT_KEY);

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

  await redis.decr(SESSION_COUNT_KEY);

  const transcripts = await getTranscripts(callControlId);
  const durationSec = Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000);

  await redis.del(`call:session_by_id:${session.callId}`);
  await redis.del(`call:transcripts:${callControlId}`);
  await redis.publish('call:disconnect', callControlId);

  const isReminder = session.callContext?.callType === 'reminder';

  await finalizeCallRecord(session, durationSec);
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
  const count = await redis.get(SESSION_COUNT_KEY);
  return Math.max(0, parseInt(count || '0', 10));
}

async function finalizeCallRecord(session: CallSession, durationSec: number): Promise<void> {
  try {
    const current = await prisma.call.findUnique({ where: { id: session.callId }, select: { status: true } });
    if (!current) return;
    const finalStatus = current.status === 'in_call' ? 'completed' : current.status;
    const call = await prisma.call.update({
      where: { id: session.callId },
      data: { status: finalStatus, endedAt: new Date(), durationSec },
    });
    await publishCallEvent(session.agentId, 'call_updated', { call });
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

async function updateContactStats(session: CallSession, durationSec: number): Promise<void> {
  if (!session.contactPhone) return;

  try {
    await prisma.contact.update({
      where: { phone: session.contactPhone },
      data: {
        totalCalls: { increment: 1 },
        totalDurationSec: { increment: durationSec },
        lastCallAt: new Date(),
      },
    });
  } catch (err) {
    log.warn('Failed to update contact stats', { phone: session.contactPhone?.slice(-4), err: String(err) });
  }
}
