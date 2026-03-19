import type { LucideIcon } from 'lucide-react';
import { Card } from '../../../components/ui/Card';

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
}

export function StatCard({ label, value, subtitle, icon: Icon }: StatCardProps) {
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
