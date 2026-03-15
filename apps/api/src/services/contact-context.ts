import { prisma } from '@voice/db';
import { normalizePhone } from '../lib/phone';
import { formatDate, formatTime } from '../lib/date';

const MAX_CALLS = 2;
const MAX_UTTERANCES_PER_CALL = 10;
const MAX_CHARS_PER_CALL = 600;

interface ContactContext {
  contactId: string;
  phone: string;
  promptSection: string;
}

export async function buildContactContext(rawPhone: string): Promise<ContactContext | null> {
  const phone = normalizePhone(rawPhone);
  const contact = await prisma.contact.findUnique({ where: { phone } });
  if (!contact) return null;

  const recentCalls = await prisma.call.findMany({
    where: { contactId: contact.id, status: 'completed' },
    orderBy: { createdAt: 'desc' },
    take: MAX_CALLS,
    include: {
      utterances: { orderBy: { startMs: 'asc' }, take: MAX_UTTERANCES_PER_CALL },
    },
  });

  const parts: string[] = ['--- Contact Info ---'];

  if (contact.name) parts.push(`Name: ${contact.name}`);
  if (contact.gender) parts.push(`Gender: ${contact.gender}`);
  parts.push(`Phone: ${contact.phone}`);
  parts.push(`Total calls: ${contact.totalCalls}`);

  if (contact.lastCallAt) {
    parts.push(`Last call: ${formatDate(contact.lastCallAt)}`);
  }

  if (contact.notes) {
    parts.push(`Notes: ${contact.notes}`);
  }

  if (recentCalls.length > 0) {
    parts.push('', '--- Recent Conversations ---');
    for (const call of recentCalls) {
      parts.push(formatCallTranscript(call));
    }
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      contactId: contact.id,
      status: 'scheduled',
      startTime: { gte: new Date() },
    },
    orderBy: { startTime: 'asc' },
    take: 10,
  });

  if (appointments.length > 0) {
    parts.push('', '--- Upcoming Appointments ---');
    for (const apt of appointments) {
      parts.push(formatAppointment(apt));
    }
    parts.push('Use these appointment IDs if the customer wants to reschedule or cancel.');
  }

  return {
    contactId: contact.id,
    phone,
    promptSection: parts.join('\n'),
  };
}

function formatAppointment(apt: {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  duration: number;
}): string {
  const date = formatDate(apt.startTime);
  const start = formatTime(apt.startTime);
  const end = formatTime(apt.endTime);
  return `- [ID: ${apt.id}] "${apt.title}" on ${date} ${start}-${end} (${apt.duration}min)`;
}

function formatCallTranscript(call: {
  createdAt: Date;
  direction: string;
  durationSec: number | null;
  utterances: { speaker: string; text: string }[];
}): string {
  const date = formatDate(call.createdAt);
  const dir = call.direction === 'inbound' ? 'incoming' : 'outgoing';
  const dur = call.durationSec ? `${Math.round(call.durationSec / 60)}min` : '';

  let transcript = call.utterances
    .map(u => `${u.speaker}: ${u.text}`)
    .join('\n');

  if (transcript.length > MAX_CHARS_PER_CALL) {
    transcript = transcript.slice(0, MAX_CHARS_PER_CALL) + '\n...';
  }

  return `\n[${date} | ${dir} ${dur}]\n${transcript || '(no transcript)'}`;
}
