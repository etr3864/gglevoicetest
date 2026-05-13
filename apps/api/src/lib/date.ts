// All functions use Date local-time methods (getHours, getDate, etc.)
// which rely on TZ=Asia/Jerusalem + tzdata — NOT on ICU.
// ICU (used by toLocaleString) may ignore TZ on Alpine's small-icu build.
export const TIMEZONE = 'Asia/Jerusalem';

const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const pad = (n: number) => String(n).padStart(2, '0');

export function formatNow(): string {
  const d = new Date();
  return `יום ${DAYS_HE[d.getDay()]}, ${d.getDate()} ב${MONTHS_HE[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDate(date: Date): string {
  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;
}

export function formatDateLong(date: Date): string {
  return `${date.getDate()} ב${MONTHS_HE[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatDateISO(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatWeekday(date: Date): string {
  return `יום ${DAYS_HE[date.getDay()]}`;
}

export function formatTimestamp(date: Date): string {
  return `${formatDate(date)}, ${formatTime(date)}`;
}

/**
 * Calendar-day difference between two dates, in TZ-local terms.
 * Same calendar day = 0, next day = 1, previous = -1.
 */
export function calendarDayDiff(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Returns a human-readable relative phrase for the AI (English, deterministic).
 * Examples: "TODAY at 10:30", "TOMORROW (Thursday) at 10:30",
 *           "in 3 days (Saturday 16 May) at 10:30".
 */
export function describeRelativeDateTime(target: Date, now: Date = new Date()): string {
  const time = formatTime(target);
  const diff = calendarDayDiff(now, target);
  const weekdayEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][target.getDay()];

  if (diff === 0) return `TODAY at ${time}`;
  if (diff === 1) return `TOMORROW (${weekdayEn}) at ${time}`;
  if (diff > 1 && diff < 7) return `in ${diff} days (${weekdayEn} ${target.getDate()} ${MONTHS_HE[target.getMonth()]}) at ${time}`;
  return `on ${weekdayEn} ${target.getDate()} ${MONTHS_HE[target.getMonth()]} ${target.getFullYear()} at ${time}`;
}

/**
 * Converts YYYY-MM-DD + HH:MM to an ISO string with the correct Israel offset.
 * Parses as local time (TZ=Asia/Jerusalem) then reads getTimezoneOffset() for DST.
 */
export function toISOWithTimezone(date: string, time: string): string {
  const local = new Date(`${date}T${time}`);
  const offsetMinutes = local.getTimezoneOffset(); // −120 (UTC+2) or −180 (UTC+3)
  const sign = offsetMinutes <= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = pad(Math.floor(abs / 60));
  const mm = pad(abs % 60);
  return `${date}T${time}:00${sign}${hh}:${mm}`;
}
