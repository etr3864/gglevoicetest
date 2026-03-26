import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Phone, PhoneIncoming, PhoneOutgoing, Clock, Calendar, TrendingUp, PhoneMissed, PhoneCall } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import type { DateRange } from '../../components/ui/DateRangePicker';
import { cn } from '../../lib/cn';
import api from '../../lib/api';
import { StatCard } from './components/StatCard';
import { TimeRangeFilter, presetToRange, type TimePreset } from './components/TimeRangeFilter';

interface Agent { id: string; name: string }

interface DashboardStats {
  inboundCalls: number; inboundMinutes: number;
  outboundCalls: number; outboundMinutes: number;
  totalCalls: number; totalMinutes: number;
  avgDurationSec: number; appointmentsBooked: number;
  conversionRate: number; outboundNoAnswer: number;
  outboundAnswerRate: number;
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} דק'`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}ש' ${m}דק'` : `${h} שעות`;
}

function formatDurationSec(sec: number): string {
  if (sec < 60) return `${sec} שנ'`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}:${String(s).padStart(2, '0')} דק'` : `${m} דק'`;
}

export default function DashboardPage() {
  const [preset, setPreset] = useState<TimePreset>('7d');
  const [customRange, setCustomRange] = useState<DateRange>({ from: null, to: null });
  const [selectedAgentId, setSelectedAgentId] = useState('');

  const { data: agentsData } = useQuery({
    queryKey: ['dashboard-agents'],
    queryFn: () => api.get<{ data: Agent[] }>('/agents').then((r) => r.data.data),
  });
  const agents = agentsData ?? [];

  const dateRange = useMemo(() => presetToRange(preset, customRange), [preset, customRange]);

  const fromParam = dateRange.from ?? '';
  const toParam = dateRange.to ?? '';

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['dashboard', fromParam, toParam, selectedAgentId],
    queryFn: () =>
      api.get<{ data: DashboardStats }>('/dashboard', {
        params: {
          ...(fromParam ? { from: fromParam } : {}),
          ...(toParam ? { to: toParam } : {}),
          ...(selectedAgentId ? { agentId: selectedAgentId } : {}),
        },
      }).then((r) => r.data.data),
    retry: 1,
  });

  const s = data;

  return (
    <div className="max-w-6xl mx-auto space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">דשבורד</h1>
          {isFetching && !isLoading && (
            <span className="text-xs text-[var(--text-muted)]">מעדכן…</span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {agents.length > 1 && (
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className={cn(
                'px-3 py-2 rounded-lg border text-sm',
                'border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)]',
                'hover:border-[var(--accent)] transition-colors outline-none'
              )}
            >
              <option value="">כל הסוכנים</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <TimeRangeFilter preset={preset} onPresetChange={setPreset} customRange={customRange} onCustomRangeChange={setCustomRange} />
        </div>
      </div>

      {isError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-4 text-sm text-red-400 text-right">
          שגיאה בטעינת הנתונים. נסה שוב.
        </div>
      )}

      {isLoading && !s ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-5 h-28 animate-pulse bg-[var(--bg-hover)]" />
          ))}
        </div>
      ) : s ? (
        <>
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">שיחות</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="שיחות נכנסות" value={s.inboundCalls} subtitle={formatMinutes(s.inboundMinutes)} icon={PhoneIncoming} />
              <StatCard label="שיחות יוצאות" value={s.outboundCalls} subtitle={formatMinutes(s.outboundMinutes)} icon={PhoneOutgoing} />
              <StatCard label="סה״כ שיחות" value={s.totalCalls} subtitle={formatMinutes(s.totalMinutes)} icon={Phone} />
              <StatCard label="משך ממוצע" value={formatDurationSec(s.avgDurationSec)} icon={Clock} />
            </div>
          </div>
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">ביצועים</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="פגישות שנקבעו" value={s.appointmentsBooked} icon={Calendar} />
              <StatCard label="אחוז המרה לפגישות" value={`${s.conversionRate}%`} icon={TrendingUp} />
              <StatCard label="שיחות יוצאות ללא מענה" value={s.outboundNoAnswer} icon={PhoneMissed} />
              <StatCard label="אחוז מענה" value={`${s.outboundAnswerRate}%`} icon={PhoneCall} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
