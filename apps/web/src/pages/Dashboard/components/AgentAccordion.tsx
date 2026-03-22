import {
  Phone, PhoneIncoming, PhoneOutgoing, Clock,
  Calendar, TrendingUp, PhoneMissed, PhoneCall,
  Cpu, FileText, PhoneForwarded, Mic, DollarSign, Timer, BookOpen,
} from 'lucide-react';
import { StatCard } from './StatCard';

interface PerformanceStats {
  inboundCalls: number; inboundMinutes: number;
  outboundCalls: number; outboundMinutes: number;
  totalCalls: number; totalMinutes: number;
  avgDurationSec: number; appointmentsBooked: number;
  conversionRate: number; outboundNoAnswer: number;
  outboundAnswerRate: number;
}

interface CostsData {
  geminiAudioCost: number;
  geminiTextCost: number;
  embeddingCost: number;
  telnyxCallCost: number;
  telnyxRecordingCost: number;
  deepgramCost: number;
  totalCost: number;
  costPerMinIls: number;
  costPerCallIls: number;
}

interface AgentAccordionProps {
  performance: PerformanceStats;
  costs: CostsData;
}

function formatMin(min: number): string {
  if (min < 60) return `${min} דק'`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}ש' ${m}דק'` : `${h} שעות`;
}

function formatSec(sec: number): string {
  if (sec < 60) return `${sec} שנ'`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}:${String(s).padStart(2, '0')} דק'` : `${m} דק'`;
}

function ils(n: number): string {
  return `₪${n.toFixed(2)}`;
}

export function AgentAccordion({ performance: p, costs: c }: AgentAccordionProps) {
  return (
    <div className="px-4 pb-4 space-y-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">ביצועים</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="שיחות נכנסות" value={p.inboundCalls} subtitle={formatMin(p.inboundMinutes)} icon={PhoneIncoming} />
          <StatCard label="שיחות יוצאות" value={p.outboundCalls} subtitle={formatMin(p.outboundMinutes)} icon={PhoneOutgoing} />
          <StatCard label="סה״כ שיחות" value={p.totalCalls} subtitle={formatMin(p.totalMinutes)} icon={Phone} />
          <StatCard label="משך ממוצע" value={formatSec(p.avgDurationSec)} icon={Clock} />
          <StatCard label="פגישות שנקבעו" value={p.appointmentsBooked} icon={Calendar} />
          <StatCard label="אחוז המרה" value={`${p.conversionRate}%`} icon={TrendingUp} />
          <StatCard label="ללא מענה" value={p.outboundNoAnswer} icon={PhoneMissed} />
          <StatCard label="אחוז מענה" value={`${p.outboundAnswerRate}%`} icon={PhoneCall} />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">עלויות</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Gemini Audio" value={ils(c.geminiAudioCost)} icon={Cpu} />
          <StatCard label="Gemini Text" value={ils(c.geminiTextCost)} icon={FileText} />
          <StatCard label="Embedding" value={ils(c.embeddingCost ?? 0)} icon={BookOpen} />
          <StatCard label="Telnyx שיחות" value={ils(c.telnyxCallCost)} icon={PhoneForwarded} />
          <StatCard label="Telnyx הקלטות" value={ils(c.telnyxRecordingCost)} icon={Mic} />
          <StatCard label="Deepgram" value={ils(c.deepgramCost)} icon={Mic} />
          <StatCard label="סה״כ עלות" value={ils(c.totalCost)} icon={DollarSign} />
          <StatCard label="עלות/דקה" value={ils(c.costPerMinIls)} icon={Timer} />
          <StatCard label="עלות/שיחה" value={ils(c.costPerCallIls)} icon={Phone} />
        </div>
      </div>
    </div>
  );
}
