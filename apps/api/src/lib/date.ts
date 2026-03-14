// All functions rely on TZ=Asia/Jerusalem in the process environment.
// In production this is set in k8s/deployment.yaml + tzdata in Dockerfile.
export const TIMEZONE = 'Asia/Jerusalem';

export function formatNow(): string {
  return new Date().toLocaleString('he-IL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('he-IL');
}

export function formatDateLong(date: Date): string {
  return date.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateISO(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatWeekday(date: Date): string {
  return date.toLocaleDateString('he-IL', { weekday: 'long' });
}

export function formatTimestamp(date: Date): string {
  return date.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Converts a date string (YYYY-MM-DD) + time string (HH:MM) to an ISO string
 * with the correct Israel offset, accounting for DST.
 * Relies on TZ=Asia/Jerusalem — parses the input as local time and reads
 * getTimezoneOffset() which correctly reflects DST without needing ICU.
 */
export function toISOWithTimezone(date: string, time: string): string {
  const local = new Date(`${date}T${time}`);
  const offsetMinutes = local.getTimezoneOffset(); // −120 (UTC+2) or −180 (UTC+3)
  const sign = offsetMinutes <= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${date}T${time}:00${sign}${hh}:${mm}`;
}
