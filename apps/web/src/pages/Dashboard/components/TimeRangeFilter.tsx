import { DateRangePicker, type DateRange } from '../../../components/ui/DateRangePicker';
import { cn } from '../../../lib/cn';

export type TimePreset = 'today' | '7d' | 'last-week' | '30d' | 'last-month' | '90d' | 'custom' | 'all';

const PRESETS: { id: TimePreset; label: string; title: string }[] = [
  { id: 'today',      label: 'היום',       title: 'היום' },
  { id: '7d',         label: '7 ימים',     title: '7 ימים אחרונים (rolling)' },
  { id: 'last-week',  label: 'שבוע',       title: 'שבוע קלנדרי אחרון (א׳–ש׳)' },
  { id: '30d',        label: '30 ימים',    title: '30 ימים אחרונים (rolling)' },
  { id: 'last-month', label: 'חודש',       title: 'חודש קלנדרי אחרון' },
  { id: '90d',        label: '90 ימים',    title: '90 ימים אחרונים (rolling)' },
  { id: 'custom',     label: 'מותאם',      title: 'טווח מותאם' },
  { id: 'all',        label: 'הכל',        title: 'כל הזמנים' },
];

interface TimeRangeFilterProps {
  preset: TimePreset;
  onPresetChange: (p: TimePreset) => void;
  customRange: DateRange;
  onCustomRangeChange: (r: DateRange) => void;
}

export function TimeRangeFilter({ preset, onPresetChange, customRange, onCustomRangeChange }: TimeRangeFilterProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-0.5 p-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] flex-wrap">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.title}
            onClick={() => onPresetChange(p.id)}
            className={cn(
              'px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
              preset === p.id
                ? 'bg-[var(--accent)] text-white shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <DateRangePicker value={customRange} onChange={onCustomRangeChange} />
      )}
    </div>
  );
}

export function presetToRange(preset: TimePreset, custom: DateRange): { from?: string; to?: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  if (preset === 'all') return {};

  if (preset === 'custom') {
    return {
      from: custom.from?.toISOString(),
      to: custom.to
        ? new Date(custom.to.getFullYear(), custom.to.getMonth(), custom.to.getDate(), 23, 59, 59).toISOString()
        : undefined,
    };
  }

  if (preset === 'last-week') {
    // Previous Sun–Sat calendar week
    const dayOfWeek = today.getDay(); // 0=Sun
    const lastSat = new Date(today);
    lastSat.setDate(today.getDate() - dayOfWeek - 1);
    const lastSun = new Date(lastSat);
    lastSun.setDate(lastSat.getDate() - 6);
    return {
      from: lastSun.toISOString(),
      to: new Date(lastSat.getFullYear(), lastSat.getMonth(), lastSat.getDate(), 23, 59, 59).toISOString(),
    };
  }

  if (preset === 'last-month') {
    // Previous calendar month
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      from: firstOfLastMonth.toISOString(),
      to: new Date(lastOfLastMonth.getFullYear(), lastOfLastMonth.getMonth(), lastOfLastMonth.getDate(), 23, 59, 59).toISOString(),
    };
  }

  // Rolling periods
  const daysBack = preset === 'today' ? 0 : preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const from = new Date(today);
  from.setDate(today.getDate() - daysBack);
  return { from: from.toISOString(), to: endOfToday.toISOString() };
}
