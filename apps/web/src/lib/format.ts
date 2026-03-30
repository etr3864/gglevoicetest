export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${m} דק'`;
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export function formatCallDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const time = date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

  if (sameCalendarDay(date, now)) return `היום · ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameCalendarDay(date, yesterday)) return `אתמול · ${time}`;

  return `${date.toLocaleDateString('he-IL')} · ${time}`;
}
