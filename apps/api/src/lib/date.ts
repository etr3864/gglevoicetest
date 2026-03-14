export const TIMEZONE = 'Asia/Jerusalem';

export function formatNow(): string {
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

export function formatDate(date: Date): string {
  return date.toLocaleDateString('he-IL', { timeZone: TIMEZONE });
}

export function formatDateLong(date: Date): string {
  return date.toLocaleDateString('he-IL', { timeZone: TIMEZONE, day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateISO(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatWeekday(date: Date): string {
  return date.toLocaleDateString('he-IL', { timeZone: TIMEZONE, weekday: 'long' });
}

export function formatTimestamp(date: Date): string {
  return date.toLocaleString('he-IL', { timeZone: TIMEZONE, dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Converts a date string (YYYY-MM-DD) + time string (HH:MM) to an ISO string
 * with the correct Israel offset, accounting for DST (UTC+2 winter / UTC+3 summer).
 */
export function toISOWithTimezone(date: string, time: string): string {
  const probeDate = new Date(`${date}T${time}:00+02:00`);
  const jeruTime = probeDate.toLocaleTimeString('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const offset = jeruTime === time ? '+02:00' : '+03:00';
  return `${date}T${time}:00${offset}`;
}
