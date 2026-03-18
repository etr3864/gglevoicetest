import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { normalizePhone } from '../lib/phone';
import { getStreamUrl } from '../lib/audio-config';
import { verifyTelnyxWebhook } from '../lib/telnyx-signature';
import { answerCall, hangupCall, startRecording } from '../services/telnyx';
import { createSession, endSession, getSession, warmup } from '../services/call';
import { publishCallEvent } from '../services/events/pubsub';
import { handleRecordingWebhook } from '../services/recording/recording.service';
import {
  verifyMetaSignature,
  verifyWasenderSignature,
  verifyMetaChallenge,
  handleMetaWebhook,
  handleWasenderWebhook,
  loadAgentWhatsappConfig,
} from '../services/whatsapp/webhook-handler';

const log = createLogger('webhook');
const router = Router();

router.post('/telnyx', async (req, res) => {
  if (!verifyTelnyxWebhook(req)) {
    log.warn('Telnyx webhook signature invalid');
    return res.sendStatus(403);
  }

  const event = req.body?.data;
  if (!event) return res.sendStatus(200);

  const eventType = event.event_type;
  const callControlId = event.payload?.call_control_id;
  const from = event.payload?.from;
  const to = event.payload?.to;

  log.info('Webhook received', { eventType, callControlId: callControlId?.slice(-12) });

  try {
    switch (eventType) {
      case 'call.initiated': {
        if (event.payload?.direction === 'incoming') {
          if (!callControlId || !from || !to) {
            log.warn('call.initiated missing required fields', { callControlId: !!callControlId, from: !!from, to: !!to });
            break;
          }
          await handleIncomingCall(callControlId, from, to);
        }
        break;
      }

      case 'call.ringing': {
        if (!callControlId) break;
        let session = await getSession(callControlId);
        if (!session) {
          await new Promise((r) => setTimeout(r, 500));
          session = await getSession(callControlId);
        }
        if (!session) break;
        const ringingCall = await prisma.call.update({
          where: { id: session.callId },
          data: { status: 'ringing' },
        });
        await publishCallEvent(session.agentId, 'call_updated', { call: ringingCall });
        break;
      }

      case 'call.answered': {
        // Primary path: status + recording handled by WebSocket start event
        // in media-bridge. This is a fallback for cases where the stream
        // event hasn't fired yet.
        if (!callControlId) break;
        const session = await getSession(callControlId);
        if (!session) break;
        const existing = await prisma.call.findUnique({ where: { id: session.callId }, select: { status: true } });
        if (existing?.status !== 'in_call') {
          const updatedCall = await prisma.call.update({
            where: { id: session.callId },
            data: { status: 'in_call' },
          });
          await publishCallEvent(session.agentId, 'call_updated', { call: updatedCall });
        }
        startRecording(callControlId).catch((err) =>
          log.warn('startRecording fallback failed', { callControlId: callControlId.slice(-12), err: String(err) })
        );
        break;
      }

      case 'call.hangup': {
        if (!callControlId) break;
        const payload = event.payload || {};
        const cause = payload.hangup_cause;
        if (cause && cause !== 'normal_clearing' && cause !== 'originator_cancel') {
          log.warn('Call ended with non-normal cause', {
            callControlId: callControlId.slice(-12),
            cause,
            from: payload.from ? `***${String(payload.from).slice(-4)}` : undefined,
            to: payload.to ? `***${String(payload.to).slice(-4)}` : undefined,
            ...(payload.sip_response_code != null && { sipCode: payload.sip_response_code }),
            ...(payload.hangup_source && { hangupSource: payload.hangup_source }),
          });
        }
        await markNoAnswerIfUnanswered(callControlId);
        await endSession(callControlId);
        break;
      }

      case 'call.recording.saved': {
        const p = event.payload;
        if (!p?.call_control_id) break;

        const { recordingId, downloadUrl, durationMs } = extractRecordingFields(p);
        if (!recordingId || !downloadUrl) {
          log.warn('call.recording.saved missing fields', { recordingId, hasUrl: !!downloadUrl });
          break;
        }

        await handleRecordingWebhook({
          telnyxRecordingId: recordingId,
          callControlId: p.call_control_id,
          downloadUrl,
          durationMs,
        });
        break;
      }

      case 'streaming.started':
      case 'streaming.stopped':
      case 'streaming.failed': {
        log.info('Streaming event', {
          eventType,
          callControlId: callControlId?.slice(-12),
          ...(eventType === 'streaming.failed' && { payload: JSON.stringify(event.payload).slice(0, 300) }),
        });
        break;
      }
    }
  } catch (err) {
    log.error('Webhook handler error', err, { eventType });
  }

  res.sendStatus(200);
});

async function findCallParticipants(to: string, phone: string) {
  const [agent, contact] = await Promise.all([
    prisma.agent.findFirst({ where: { phoneNumber: to, status: 'active' } }),
    prisma.contact.upsert({ where: { phone }, update: {}, create: { phone } }),
  ]);
  return { agent, contact };
}

async function initCallRecord(
  callControlId: string,
  agentId: string,
  contactId: string,
  phone: string,
) {
  const call = await prisma.call.create({
    data: { agentId, contactId, callControlId, direction: 'inbound', status: 'in_call', startedAt: new Date() },
    include: { contact: { select: { phone: true, name: true } } },
  });
  await publishCallEvent(agentId, 'call_created', { call });
  await createSession({ callId: call.id, agentId, callControlId, contactPhone: phone });
  return call;
}

async function handleIncomingCall(
  callControlId: string,
  from: string,
  to: string,
): Promise<void> {
  const phone = normalizePhone(from);

  const existing = await prisma.call.findFirst({ where: { callControlId } });
  if (existing) {
    log.warn('Duplicate call.initiated ignored', { callControlId: callControlId.slice(-12) });
    return;
  }

  const { agent, contact } = await findCallParticipants(to, phone);
  if (!agent) {
    log.warn('No active agent for number', { to });
    await hangupCall(callControlId);
    return;
  }

  const call = await initCallRecord(callControlId, agent.id, contact.id, phone);

  warmup(call.id, agent.id, phone, undefined, 'inbound').catch((err) =>
    log.warn('Inbound warmup failed', { callId: call.id, err: String(err) })
  );

  try {
    await answerCall(callControlId, getStreamUrl());
  } catch (err) {
    log.error('answerCall failed — hanging up', err, { callControlId: callControlId.slice(-12) });
    await hangupCall(callControlId).catch(() => {});
  }
}

function extractRecordingFields(p: Record<string, any>): { recordingId: string | undefined; downloadUrl: string; durationMs: number } {
  const recordingId = p.recording_id ?? p.id;
  const downloadUrl = p.recording_urls?.mp3 ?? p.download_urls?.mp3 ?? p.public_recording_urls?.mp3 ?? '';
  const durationMs = p.duration_millis
    ?? (p.duration_secs ? p.duration_secs * 1000 : null)
    ?? (p.recording_started_at && p.recording_ended_at
      ? new Date(p.recording_ended_at).getTime() - new Date(p.recording_started_at).getTime()
      : 0);
  return { recordingId, downloadUrl, durationMs };
}

async function markNoAnswerIfUnanswered(callControlId: string): Promise<void> {
  const session = await getSession(callControlId);
  if (!session) return;
  const { count } = await prisma.call.updateMany({
    where: { id: session.callId, status: { in: ['calling', 'ringing'] } },
    data: { status: 'no_answer' },
  });
  if (count > 0) {
    await publishCallEvent(session.agentId, 'call_updated', {
      call: { id: session.callId, status: 'no_answer' },
    });
  }
}

router.get('/whatsapp/meta/:agentId', async (req: Request, res: Response) => {
  const agentId = req.params.agentId as string;
  const config = await loadAgentWhatsappConfig(agentId);
  if (!config?.verifyToken) return res.sendStatus(403);

  const challenge = verifyMetaChallenge(req.query as Record<string, string>, config.verifyToken);
  if (!challenge) return res.sendStatus(403);

  res.send(challenge);
});

router.post('/whatsapp/meta/:agentId', async (req: Request, res: Response) => {
  const agentId = req.params.agentId as string;
  const rawBody: Buffer | undefined = (req as any).rawBody;

  const config = await loadAgentWhatsappConfig(agentId);
  if (!config?.appSecret) return res.sendStatus(403);

  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  if (!signature || !rawBody || !verifyMetaSignature(rawBody, signature, config.appSecret)) {
    log.warn('Meta webhook HMAC invalid', { agentId });
    return res.sendStatus(403);
  }

  res.sendStatus(200);
  handleMetaWebhook(req.body, agentId).catch(err =>
    log.error('handleMetaWebhook failed', err, { agentId }),
  );
});

router.post('/whatsapp/wasender/:agentId', async (req: Request, res: Response) => {
  const agentId = req.params.agentId as string;
  const rawBody: Buffer | undefined = (req as any).rawBody;

  const config = await loadAgentWhatsappConfig(agentId);
  if (!config?.webhookSecret) return res.sendStatus(403);

  const signature = req.headers['x-wasender-signature'] as string | undefined;
  if (!signature || !rawBody || !verifyWasenderSignature(rawBody, signature, config.webhookSecret)) {
    log.warn('WA Sender webhook HMAC invalid', { agentId });
    return res.sendStatus(403);
  }

  res.sendStatus(200);
  handleWasenderWebhook(req.body, agentId).catch(err =>
    log.error('handleWasenderWebhook failed', err, { agentId }),
  );
});

export default router;
