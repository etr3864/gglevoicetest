import crypto from 'crypto';
import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { appointmentWebhookQueue } from '../../lib/queue';
import { formatDateISO, formatTime } from '../../lib/date';

const log = createLogger('appointment-webhook');
const SEND_TIMEOUT_MS = 10_000;

export type AppointmentEvent = 'appointment_booked' | 'appointment_rescheduled' | 'appointment_cancelled';

export async function deliverAppointmentWebhook(appointmentId: string, event: AppointmentEvent): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      agent: {
        select: {
          id: true, name: true,
          appointmentWebhookUrl: true, appointmentWebhookSecret: true,
          webhookRetryCount: true, webhookRetryDelay: true,
        },
      },
      contact: { select: { name: true } },
    },
  });

  if (!appointment?.agent.appointmentWebhookUrl) return;

  const callData = appointment.callId
    ? await prisma.call.findUnique({
        where: { id: appointment.callId },
        select: { direction: true, summary: { select: { summaryText: true } } },
      })
    : null;

  const payload = buildPayload(appointment, event, callData?.summary?.summaryText ?? null, callData?.direction ?? null);
  const { success, statusCode, error } = await sendPost(
    appointment.agent.appointmentWebhookUrl,
    payload,
    appointment.agent.appointmentWebhookSecret,
  );

  if (success) {
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { webhookStatus: 'SENT', webhookSentAt: new Date(), webhookAttempts: { increment: 1 } },
    });
    log.info('Webhook sent', { appointmentId, event, statusCode });
    return;
  }

  const attempts = appointment.webhookAttempts + 1;
  const isPermanent = isClientError(statusCode) || attempts >= appointment.agent.webhookRetryCount;

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      webhookAttempts: attempts,
      webhookLastError: error,
      webhookStatus: isPermanent ? 'FAILED' : 'PENDING',
    },
  });

  if (isPermanent) {
    log.error('Webhook permanently failed', undefined, { appointmentId, event, attempts, error });
    return;
  }

  log.warn('Webhook failed, scheduling retry', { appointmentId, event, attempts, statusCode });
  await appointmentWebhookQueue.add(
    'deliver',
    { appointmentId, event },
    { jobId: `appt-webhook-${appointmentId}-${event}-${attempts}`, delay: appointment.agent.webhookRetryDelay * 1000 },
  );
}

function buildPayload(
  appointment: AppointmentWithRelations,
  event: AppointmentEvent,
  summary: string | null,
  direction: string | null,
): Record<string, unknown> {
  return {
    event,
    timestamp: new Date().toISOString(),
    appointment_id: appointment.id,
    agent_id: appointment.agent.id,
    agent_name: appointment.agent.name,
    customer_name: appointment.contact?.name ?? null,
    customer_phone: appointment.phone,
    title: appointment.title,
    date: formatDateISO(appointment.startTime),
    time: formatTime(appointment.startTime),
    duration_min: appointment.duration,
    call_id: appointment.callId ?? null,
    direction,
    summary,
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

interface AppointmentWithRelations {
  id: string;
  phone: string;
  title: string;
  startTime: Date;
  duration: number;
  callId: string | null;
  webhookAttempts: number;
  contact: { name: string | null } | null;
  agent: {
    id: string;
    name: string;
    appointmentWebhookUrl: string | null;
    appointmentWebhookSecret: string | null;
    webhookRetryCount: number;
    webhookRetryDelay: number;
  };
}
