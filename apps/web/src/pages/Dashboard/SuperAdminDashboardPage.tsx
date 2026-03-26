import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, Phone, Clock, TrendingDown } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import type { DateRange } from '../../components/ui/DateRangePicker';
import api from '../../lib/api';
import { StatCard } from './components/StatCard';
import { TimeRangeFilter, presetToRange, type TimePreset } from './components/TimeRangeFilter';
import { AgentTable } from './components/AgentTable';
import { PricingSettings } from './components/PricingSettings';
import type { SuperAdminDashboardData } from './types';

function formatMinutes(min: number): string {
  if (min < 60) return `${min} דק'`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}ש' ${m}דק'` : `${h} שעות`;
}

export default function SuperAdminDashboardPage() {
  const [preset, setPreset] = useState<TimePreset>('30d');
  const [customRange, setCustomRange] = useState<DateRange>({ from: null, to: null });

  const dateRange = useMemo(() => presetToRange(preset, customRange), [preset, customRange]);

  const fromParam = dateRange.from ?? '';
  const toParam = dateRange.to ?? '';

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['super-admin-dashboard', fromParam, toParam],
    queryFn: () =>
      api.get<{ data: SuperAdminDashboardData }>('/dashboard/super-admin', {
        params: {
          ...(fromParam ? { from: fromParam } : {}),
          ...(toParam ? { to: toParam } : {}),
        },
      }).then((r) => r.data.data),
    retry: 1,
  });

  const summary = data?.summary;

  return (
    <div className="max-w-7xl mx-auto space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">דשבורד מערכת</h1>
          {isFetching && !isLoading && (
            <span className="text-xs text-[var(--text-muted)]">מעדכן…</span>
          )}
        </div>
        <TimeRangeFilter preset={preset} onPresetChange={setPreset} customRange={customRange} onCustomRangeChange={setCustomRange} />
      </div>

      {isError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-4 text-sm text-red-400 text-right">
          שגיאה בטעינת הנתונים. נסה שוב.
        </div>
      )}

      {isLoading && !summary ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-5 h-28 animate-pulse bg-[var(--bg-hover)]" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="סה״כ עלות" value={`₪${summary.totalCostIls.toFixed(2)}`} icon={DollarSign} />
          <StatCard label="סה״כ שיחות" value={summary.totalCalls} icon={Phone} />
          <StatCard label="סה״כ דקות" value={formatMinutes(summary.totalMinutes)} icon={Clock} />
          <StatCard label="עלות ממוצעת/דקה" value={`₪${summary.avgCostPerMinIls.toFixed(2)}`} icon={TrendingDown} />
        </div>
      ) : null}

      {data && <AgentTable agents={data.agents} />}

      <PricingSettings />
    </div>
  );
}
