import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { redis } from '../../lib/redis';
import type { TranscriptEntry } from '../providers/types';
import { publishCallEvent } from '../events/pubsub';

const log = createLogger('session');
const SESSION_COUNT_KEY = 'call:session_count';

// Represents the data stored in Redis
export interface CallSession {
  callId: string;
  agentId: string;
  callControlId: string;
  contactPhone: string | null;
  startedAt: string; // ISO date string
}

// Helper to store transcripts
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
  await redis.expire(transcriptsKey, 7200); // 2 hours TTL
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
}): Promise<CallSession> {
  const session: CallSession = {
    ...params,
    startedAt: new Date().toISOString(),
  };

  await redis.set(`call:session:${params.callControlId}`, JSON.stringify(session), 'EX', 7200);
  await redis.set(`call:session_by_id:${params.callId}`, params.callControlId, 'EX', 7200);
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

  await finalizeCallRecord(session, durationSec);
  await persistUtterances(session, transcripts);
  await updateContactStats(session, durationSec);

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

export async function activeSessionCount(): Promise<number> {
  const count = await redis.get(SESSION_COUNT_KEY);
  return Math.max(0, parseInt(count || '0', 10));
}

async function finalizeCallRecord(session: CallSession, durationSec: number): Promise<void> {
  try {
    const call = await prisma.call.update({
      where: { id: session.callId },
      data: { status: 'completed', endedAt: new Date(), durationSec },
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
    
    // Notify frontend that transcript is ready
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
  } catch {}
}
