import type { BusinessHours } from '@voice/shared';

const TIMEZONE = 'Asia/Jerusalem';

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

  if (agent.calendarInstructions) {
    sections.push(agent.calendarInstructions);
  }

  if (hasHours) {
    sections.push('IMPORTANT: Never schedule appointments outside of business hours. If a customer requests a time outside business hours, let them know and suggest the nearest available time within business hours.');
  }

  return '\n\n--- Scheduling Context ---\n' + sections.join('\n\n');
}

function formatNow(): string {
  return new Date().toLocaleString('he-IL', {
    timeZone: TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBusinessHours(hours: BusinessHours): string {
  const lines = DAY_ORDER.map(day => {
    const slot = hours[day];
    const label = DAY_NAMES_HE[day];
    return slot ? `${label}: ${slot.start} - ${slot.end}` : `${label}: סגור`;
  });

  return 'Business hours:\n' + lines.join('\n');
}
