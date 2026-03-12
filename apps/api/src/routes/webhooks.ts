import { Router } from 'express';
import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { normalizePhone } from '../lib/phone';
import { getStreamUrl } from '../lib/audio-config';
import { answerCall, hangupCall, startStream, startRecording } from '../services/telnyx';
import { createSession, endSession, getSession, warmup } from '../services/call';
import { publishCallEvent } from '../services/events/pubsub';
import { handleRecordingWebhook } from '../services/recording/recording.service';

const log = createLogger('webhook');
const router = Router();

router.post('/telnyx', async (req, res) => {
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

      case 'call.answered': {
        if (!callControlId) {
          log.warn('call.answered missing call_control_id');
          break;
        }
        const session = await getSession(callControlId);
        if (!session) {
          log.warn('call.answered no session', { callControlId: callControlId.slice(-12) });
          break;
        }

        const updatedCall = await prisma.call.update({
          where: { id: session.callId },
          data: { status: 'in_call' },
        });
        await publishCallEvent(session.agentId, 'call_updated', { call: updatedCall });

        await startStream(callControlId, getStreamUrl());
        await startRecording(callControlId);
        break;
      }

      case 'call.machine.detection.ended': {
        const result = event.payload?.result;
        if (result === 'machine' && callControlId) {
          log.warn('AMD: machine detected, hanging up', { callControlId: callControlId.slice(-12) });
          await hangupCall(callControlId);
        }
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
            from: payload.from,
            to: payload.to,
            ...(payload.sip_response_code != null && { sipCode: payload.sip_response_code }),
            ...(payload.hangup_source && { hangupSource: payload.hangup_source }),
          });
        }
        await endSession(callControlId);
        break;
      }

      case 'call.recording.saved': {
        const p = event.payload;
        if (!p?.call_control_id) break;

        const recordingId = p.recording_id ?? p.id;
        const downloadUrl = p.recording_urls?.mp3 ?? p.download_urls?.mp3 ?? p.public_recording_urls?.mp3 ?? '';
        const durationMs = p.duration_millis
          ?? (p.duration_secs ? p.duration_secs * 1000 : 0)
          ?? (p.recording_started_at && p.recording_ended_at
            ? new Date(p.recording_ended_at).getTime() - new Date(p.recording_started_at).getTime()
            : 0);

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
      case 'streaming.stopped': {
        log.info('Streaming event', { eventType, callControlId: callControlId?.slice(-12) });
        break;
      }
    }
  } catch (err) {
    log.error('Webhook handler error', err, { eventType });
  }

  res.sendStatus(200);
});

async function handleIncomingCall(
  callControlId: string,
  from: string,
  to: string,
): Promise<void> {
  const phone = normalizePhone(from);

  const [agent, contact] = await Promise.all([
    prisma.agent.findFirst({ where: { phoneNumber: to, status: 'active' } }),
    prisma.contact.upsert({ where: { phone }, update: {}, create: { phone } }),
  ]);

  if (!agent) {
    log.warn('No active agent for number', { to });
    await hangupCall(callControlId);
    return;
  }

  const call = await prisma.call.create({
    data: {
      agentId: agent.id,
      contactId: contact.id,
      callControlId,
      direction: 'inbound',
      status: 'in_call',
      startedAt: new Date(),
    },
    include: { contact: { select: { phone: true, name: true } } },
  });

  await publishCallEvent(agent.id, 'call_created', { call });

  await createSession({
    callId: call.id,
    agentId: agent.id,
    callControlId,
    contactPhone: phone,
  });

  warmup(call.id, agent.id, phone).catch(() => {});

  await answerCall(callControlId, getStreamUrl());
}

export default router;
