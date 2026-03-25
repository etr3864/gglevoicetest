import type { BusinessHours } from '@voice/shared';
import { formatNow } from '../../lib/date';
import { getContextMessages } from '../whatsapp/whatsapp.service';
import type { MediaContext } from '../media/types';

interface AgentPromptData {
  basePrompt: string | null;
  openingMessage: string | null;
  inboundSystemPrompt?: string | null;
  inboundOpeningMessage?: string | null;
}

const DIRECTION_SECTION: Record<'inbound' | 'outbound', string> = {
  outbound: '\n\n--- Direction ---\nThis is an outbound call you are making. You initiated contact — begin the conversation proactively.',
  inbound: '\n\n--- Direction ---\nThis is an inbound call. The customer called you — greet them warmly.',
};

export function resolveDirectionalPrompts(
  agent: AgentPromptData,
  direction: 'inbound' | 'outbound',
): { baseSystemPrompt: string; openingMessage?: string } {
  const isInbound = direction === 'inbound';

  const rawPrompt = isInbound
    ? agent.inboundSystemPrompt || agent.basePrompt
    : agent.basePrompt;
  const baseSystemPrompt = (rawPrompt || 'You are a helpful voice assistant.') + DIRECTION_SECTION[direction];

  const openingMessage = (isInbound
    ? agent.inboundOpeningMessage || agent.openingMessage
    : agent.openingMessage) ?? undefined;

  return { baseSystemPrompt, openingMessage };
}

const DAY_NAMES_HE: Record<string, string> = {
  sunday: 'ראשון',
  monday: 'שני',
  tuesday: 'שלישי',
  wednesday: 'רביעי',
  thursday: 'חמישי',
  friday: 'שישי',
  saturday: 'שבת',
};

const DAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

interface AgentScheduleData {
  calendarConfig: unknown;
  calendarInstructions: string | null;
  businessHours: unknown;
}

function isBusinessHours(val: unknown): val is BusinessHours {
  return typeof val === 'object' && val !== null;
}

export function buildSchedulingPrompt(agent: AgentScheduleData): string {
  const hours = isBusinessHours(agent.businessHours) ? agent.businessHours : null;
  const hasCalendar = !!agent.calendarConfig;
  const hasHours = hours && DAY_ORDER.some(d => hours[d] !== null);

  if (!hasHours && !agent.calendarInstructions && !hasCalendar) return '';

  const sections: string[] = [];

  sections.push(`Current date and time: ${formatNow()}`);

  if (hasHours) {
    sections.push(formatBusinessHours(hours));
  }

  sections.push(
    'Scheduling flow:\n' +
    '- To book: call check_availability → present up to 3 options clearly (e.g. "10:00, 11:30, or 14:00") → wait for the customer to choose → call book_appointment.\n' +
    '- To reschedule or cancel: call get_contact_appointments first to get the appointmentId, confirm with the customer which appointment, then call reschedule_appointment or cancel_appointment.\n' +
    '- Never book or cancel without explicit customer confirmation.',
  );

  if (agent.calendarInstructions) {
    sections.push(agent.calendarInstructions);
  }

  if (hasHours) {
    sections.push('IMPORTANT: Never schedule appointments outside of business hours. If a customer requests a time outside business hours, let them know and suggest the nearest available time within business hours.');
  }

  return '\n\n--- Scheduling Context ---\n' + sections.join('\n\n');
}

const MAX_WHATSAPP_CONTEXT_CHARS = 2000;

interface AgentWhatsappData {
  whatsappProvider: string | null;
  whatsappInstructions: string | null;
}

export function buildWhatsappPrompt(agent: AgentWhatsappData): string {
  if (!agent.whatsappProvider) return '';

  const sections: string[] = [
    'You have the ability to send WhatsApp messages to the customer using the send_whatsapp tool.',
    'Use it when the customer asks for information in writing (payment links, addresses, documents, confirmations, summaries).',
  ];

  if (agent.whatsappInstructions) {
    sections.push(agent.whatsappInstructions);
  }

  sections.push(
    'Tell the customer you are sending the message before calling send_whatsapp.',
    'If the tool returns sent: false, tell the customer there is a temporary issue with WhatsApp and you will try again.',
  );

  return '\n\n--- WhatsApp ---\n' + sections.join('\n');
}

export async function buildWhatsappContextSection(
  agentId: string,
  contactPhone: string,
  limit: number,
): Promise<string> {
  if (!contactPhone) return '';

  const messages = await getContextMessages(agentId, contactPhone, limit);
  if (messages.length === 0) return '';

  const lines = messages.map((m: { direction: string; content: string; createdAt: Date }) => {
    const direction = m.direction === 'outbound' ? 'Agent' : 'Customer';
    const date = m.createdAt.toISOString().slice(0, 16).replace('T', ' ');
    return `[${date}] ${direction}: ${m.content}`;
  });

  let text = lines.join('\n');
  if (text.length > MAX_WHATSAPP_CONTEXT_CHARS) {
    text = text.slice(-MAX_WHATSAPP_CONTEXT_CHARS);
    const newlineIdx = text.indexOf('\n');
    if (newlineIdx > 0) text = text.slice(newlineIdx + 1);
  }

  return `\n\n--- WhatsApp History ---\n${text}`;
}

const MEDIA_INJECT_THRESHOLD = 15;

interface AgentMediaData {
  mediaEnabled: boolean;
  mediaInstructions: string | null;
}

export function buildMediaPrompt(agent: AgentMediaData, mediaCtx: MediaContext): string {
  if (!agent.mediaEnabled || !mediaCtx.hasMedia) return '';

  const lines = ['\n\n--- ספריית מדיה ---'];

  if (mediaCtx.items && mediaCtx.totalCount <= MEDIA_INJECT_THRESHOLD) {
    lines.push(
      'יש לך קבצי מדיה זמינים לשליחה. שלח כל פריט ב-send_media עם ה-ID המדויק שלו.' +
      ' לשליחת כמה פריטים — קרא send_media בנפרד לכל ID (לעולם אל תשלח query ריק):'
    );
    for (const item of mediaCtx.items) {
      const caption = item.caption ? ` [כיתוב: "${item.caption}"]` : '';
      lines.push(`• ID:${item.id} [${item.mediaType}] ${item.name} — ${item.description}${caption}`);
    }
  } else {
    lines.push(
      `יש לך ${mediaCtx.totalCount} קבצי מדיה זמינים.` +
      ' השתמש ב-send_media עם תיאור ספציפי לכל פריט.' +
      ' לשליחת כמה פריטים — קרא מספר פעמים עם תיאורים שונים ומיוחדים לכל אחד.'
    );
  }

  if (agent.mediaInstructions) lines.push(agent.mediaInstructions);

  return lines.join('\n');
}

function formatBusinessHours(hours: BusinessHours): string {
  const lines = DAY_ORDER.map(day => {
    const slot = hours[day];
    const label = DAY_NAMES_HE[day];
    return slot ? `${label}: ${slot.start} - ${slot.end}` : `${label}: סגור`;
  });

  return 'Business hours:\n' + lines.join('\n');
}
