import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Phone, PhoneIncoming, PhoneOutgoing, Clock, Calendar, TrendingUp, PhoneMissed, PhoneCall } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { DateRangePicker, type DateRange } from '../../components/ui/DateRangePicker';
import { cn } from '../../lib/cn';
import api from '../../lib/api';

type TimePreset = 'today' | '7d' | '30d' | '90d' | 'custom' | 'all';

const PRESETS: { id: TimePreset; label: string }[] = [
  { id: 'today', label: 'היום' },
  { id: '7d', label: '7 ימים' },
  { id: '30d', label: 'חודש' },
  { id: '90d', label: '90 ימים' },
  { id: 'custom', label: 'מותאם' },
  { id: 'all', label: 'הכל' },
];

function presetToRange(preset: TimePreset, custom: DateRange): { from?: string; to?: string } {
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

interface Agent {
  id: string;
  name: string;
}

interface DashboardStats {
  inboundCalls: number;
  inboundMinutes: number;
  outboundCalls: number;
  outboundMinutes: number;
  totalCalls: number;
  totalMinutes: number;
  avgDurationSec: number;
  appointmentsBooked: number;
  conversionRate: number;
  outboundNoAnswer: number;
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

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: typeof Phone;
}

function StatCard({ label, value, subtitle, icon: Icon }: StatCardProps) {
  return (
    <Card className="p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--text-muted)]">{label}</span>
        <div className="p-2 rounded-lg bg-[var(--accent)]/10">
          <Icon className="w-4 h-4 text-[var(--accent)]" />
        </div>
      </div>
      <div>
        <div className="text-2xl font-bold text-[var(--text-primary)] tabular-nums">{value}</div>
        {subtitle && <div className="text-xs text-[var(--text-muted)] mt-1">{subtitle}</div>}
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const [preset, setPreset] = useState<TimePreset>('7d');
  const [customRange, setCustomRange] = useState<DateRange>({ from: null, to: null });
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');

  const { data: agentsData } = useQuery({
    queryKey: ['dashboard-agents'],
    queryFn: () => api.get<{ data: Agent[] }>('/agents').then((r) => r.data.data),
  });
  const agents = agentsData ?? [];

  const dateRange = useMemo(() => presetToRange(preset, customRange), [preset, customRange]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard', dateRange, selectedAgentId],
    queryFn: () =>
      api.get<{ data: DashboardStats }>('/dashboard', {
        params: { ...dateRange, ...(selectedAgentId && { agentId: selectedAgentId }) },
      }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
    retry: 1,
  });

  const s = data;

  return (
    <div className="max-w-6xl mx-auto space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">דשבורד</h1>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Agent selector */}
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
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}

          {/* Time preset buttons */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
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

          {/* Custom date range picker */}
          {preset === 'custom' && (
            <DateRangePicker value={customRange} onChange={setCustomRange} />
          )}
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
          {/* Row 1 — Calls */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">שיחות</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard
                label="שיחות נכנסות"
                value={s.inboundCalls}
                subtitle={formatMinutes(s.inboundMinutes)}
                icon={PhoneIncoming}
              />
              <StatCard
                label="שיחות יוצאות"
                value={s.outboundCalls}
                subtitle={formatMinutes(s.outboundMinutes)}
                icon={PhoneOutgoing}
              />
              <StatCard
                label="סה״כ שיחות"
                value={s.totalCalls}
                subtitle={formatMinutes(s.totalMinutes)}
                icon={Phone}
              />
              <StatCard
                label="משך ממוצע"
                value={formatDurationSec(s.avgDurationSec)}
                icon={Clock}
              />
            </div>
          </div>

          {/* Row 2 — Performance */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">ביצועים</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard
                label="פגישות שנקבעו"
                value={s.appointmentsBooked}
                icon={Calendar}
              />
              <StatCard
                label="אחוז המרה לפגישות"
                value={`${s.conversionRate}%`}
                icon={TrendingUp}
              />
              <StatCard
                label="שיחות יוצאות ללא מענה"
                value={s.outboundNoAnswer}
                icon={PhoneMissed}
              />
              <StatCard
                label="אחוז מענה"
                value={`${s.outboundAnswerRate}%`}
                icon={PhoneCall}
              />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
