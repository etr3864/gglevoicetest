import { DateRangePicker, type DateRange } from '../../../components/ui/DateRangePicker';
import { cn } from '../../../lib/cn';

export type TimePreset = 'today' | '7d' | '30d' | '90d' | 'custom' | 'all';

const PRESETS: { id: TimePreset; label: string }[] = [
  { id: 'today', label: 'היום' },
  { id: '7d', label: '7 ימים' },
  { id: '30d', label: 'חודש' },
  { id: '90d', label: '90 ימים' },
  { id: 'custom', label: 'מותאם' },
  { id: 'all', label: 'הכל' },
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
      <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPresetChange(p.id)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
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
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === 'all') return {};
  if (preset === 'custom') {
    return {
      from: custom.from?.toISOString(),
      to: custom.to ? new Date(custom.to.getFullYear(), custom.to.getMonth(), custom.to.getDate(), 23, 59, 59).toISOString() : undefined,
    };
  }

  const daysBack = preset === 'today' ? 0 : preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const from = new Date(startOfToday);
  from.setDate(from.getDate() - daysBack);
  return { from: from.toISOString(), to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString() };
}
