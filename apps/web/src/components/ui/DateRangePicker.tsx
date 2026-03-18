import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronLeft, Calendar } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  label?: string;
}

const MONTHS_HE = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];
const DAYS_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isBetween(d: Date, from: Date, to: Date): boolean {
  return d > from && d < to;
}

function getCalendarDays(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  // Sunday = 0, we want Sunday as first column (index 0)
  const startOffset = firstDay.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

function formatDisplay(range: DateRange): string {
  if (!range.from && !range.to) return 'בחר תאריכים';
  const fmt = (d: Date) => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
  if (range.from && !range.to) return `מ-${fmt(range.from)}`;
  if (range.from && range.to) return `${fmt(range.from)} – ${fmt(range.to)}`;
  return 'בחר תאריכים';
}

export function DateRangePicker({ value, onChange, label }: DateRangePickerProps) {
  const today = startOfDay(new Date());
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<Date | null>(null);
  const [leftMonth, setLeftMonth] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth() === 0 ? 11 : today.getMonth() - 1,
    ...(today.getMonth() === 0 && { year: today.getFullYear() - 1 }),
  }));

  const containerRef = useRef<HTMLDivElement>(null);

  const rightMonth = {
    year: leftMonth.month === 11 ? leftMonth.year + 1 : leftMonth.year,
    month: leftMonth.month === 11 ? 0 : leftMonth.month + 1,
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDayClick = useCallback(
    (day: Date) => {
      const d = startOfDay(day);
      if (!value.from || (value.from && value.to)) {
        onChange({ from: d, to: null });
      } else {
        if (d < value.from) {
          onChange({ from: d, to: value.from });
        } else if (sameDay(d, value.from)) {
          onChange({ from: d, to: d });
        } else {
          onChange({ from: value.from, to: d });
          setOpen(false);
        }
      }
    },
    [value, onChange]
  );

  const prevMonth = () => {
    setLeftMonth(({ year, month }) =>
      month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
    );
  };

  const nextMonth = () => {
    setLeftMonth(({ year, month }) =>
      month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
    );
  };

  return (
    <div className="relative" ref={containerRef} dir="rtl">
      {label && <div className="text-xs text-[var(--text-muted)] mb-1">{label}</div>}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors',
          'border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)]',
          'hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]',
          open && 'border-[var(--accent)] ring-1 ring-[var(--accent)]/30'
        )}
      >
        <Calendar className="w-4 h-4 text-[var(--text-muted)]" />
        <span>{formatDisplay(value)}</span>
      </button>

      {open && (
        <div
          className={cn(
            'absolute top-full mt-2 z-50 rounded-xl shadow-2xl',
            'border border-[var(--border)] bg-[var(--bg-card)] p-4',
            'flex gap-4'
          )}
          style={{ right: 0, minWidth: 560 }}
        >
          <CalendarMonth
            year={leftMonth.year}
            month={leftMonth.month}
            range={value}
            hovered={hovered}
            today={today}
            onDayClick={handleDayClick}
            onDayHover={setHovered}
            onPrev={prevMonth}
            onNext={null}
          />
          <div className="w-px bg-[var(--border)]" />
          <CalendarMonth
            year={rightMonth.year}
            month={rightMonth.month}
            range={value}
            hovered={hovered}
            today={today}
            onDayClick={handleDayClick}
            onDayHover={setHovered}
            onPrev={null}
            onNext={nextMonth}
          />
        </div>
      )}
    </div>
  );
}

interface CalendarMonthProps {
  year: number;
  month: number;
  range: DateRange;
  hovered: Date | null;
  today: Date;
  onDayClick: (d: Date) => void;
  onDayHover: (d: Date | null) => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}

function CalendarMonth({
  year, month, range, hovered, today,
  onDayClick, onDayHover, onPrev, onNext,
}: CalendarMonthProps) {
  const cells = getCalendarDays(year, month);
  const effectiveTo = range.to ?? hovered;

  function getDayState(day: Date) {
    const isFrom = range.from && sameDay(day, range.from);
    const isTo = effectiveTo && sameDay(day, effectiveTo);
    const inRange =
      range.from && effectiveTo && range.from <= effectiveTo
        ? isBetween(day, range.from, effectiveTo)
        : false;
    const isToday = sameDay(day, today);
    return { isFrom, isTo, inRange, isToday };
  }

  return (
    <div className="flex flex-col gap-3 w-[236px]">
      {/* Month header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onPrev ?? undefined}
          disabled={!onPrev}
          className={cn(
            'p-1 rounded-md transition-colors',
            onPrev
              ? 'hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]'
              : 'opacity-0 pointer-events-none'
          )}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {MONTHS_HE[month]} {year}
        </span>
        <button
          type="button"
          onClick={onNext ?? undefined}
          disabled={!onNext}
          className={cn(
            'p-1 rounded-md transition-colors',
            onNext
              ? 'hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]'
              : 'opacity-0 pointer-events-none'
          )}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 text-center">
        {DAYS_HE.map((d) => (
          <div key={d} className="text-[11px] font-medium text-[var(--text-muted)] py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} />;
          const { isFrom, isTo, inRange, isToday } = getDayState(day);
          const isEdge = isFrom || isTo;

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onDayClick(day)}
              onMouseEnter={() => onDayHover(day)}
              onMouseLeave={() => onDayHover(null)}
              className={cn(
                'relative h-8 w-full text-[13px] transition-colors select-none outline-none',
                inRange && 'bg-[var(--accent)]/10',
                isEdge && 'rounded-full bg-[var(--accent)] text-white font-semibold z-10',
                !isEdge && !inRange && 'hover:bg-[var(--bg-hover)] rounded-full',
                isToday && !isEdge && 'font-bold text-[var(--accent)]',
                'text-[var(--text-primary)]'
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
