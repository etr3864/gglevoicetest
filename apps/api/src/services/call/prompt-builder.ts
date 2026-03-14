import type { BusinessHours } from '@voice/shared';
import { formatNow } from '../../lib/date';

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
  const baseSystemPrompt =
    ((isInbound ? agent.inboundSystemPrompt || agent.basePrompt : agent.basePrompt) || 'You are a helpful voice assistant.') +
    DIRECTION_SECTION[direction];
  const openingMessage =
    (isInbound ? agent.inboundOpeningMessage || agent.openingMessage : agent.openingMessage) ?? undefined;
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

export function buildSchedulingPrompt(agent: AgentScheduleData): string {
  const hours = agent.businessHours as BusinessHours | null;
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

function formatBusinessHours(hours: BusinessHours): string {
  const lines = DAY_ORDER.map(day => {
    const slot = hours[day];
    const label = DAY_NAMES_HE[day];
    return slot ? `${label}: ${slot.start} - ${slot.end}` : `${label}: סגור`;
  });

  return 'Business hours:\n' + lines.join('\n');
}
