import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Save, GripVertical, XCircle,
  Clock, Loader2, RefreshCw, UserX, BarChart3,
} from 'lucide-react';
import api from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { useToast } from '../../components/ui/Toast';

interface FollowupStep {
  id: string;
  order: number;
  delayMinutes: number;
  instruction: string;
}

interface FollowupConfig {
  id: string;
  enabled: boolean;
  generalInstruction: string;
  activeHoursStart: string;
  activeHoursEnd: string;
  smartTimingEnabled: boolean;
  smartTimingMinCalls: number;
  minCallbackMinutes: number;
  steps: FollowupStep[];
}

interface FollowupStats {
  pending: number;
  scheduled: number;
  executing: number;
  completed: number;
  optedOut: number;
}

interface Props {
  agentId: string;
}

const STATUS_MAP: Record<string, { label: string; variant: 'success' | 'danger' | 'warning' | 'info' | 'neutral' }> = {
  PENDING: { label: 'ממתין', variant: 'info' },
  SCHEDULED: { label: 'מתוזמן', variant: 'info' },
  EXECUTING: { label: 'מתבצע', variant: 'warning' },
  COMPLETED: { label: 'הושלם', variant: 'success' },
  CANCELLED: { label: 'בוטל', variant: 'neutral' },
  OPTED_OUT: { label: 'הוסר', variant: 'danger' },
};

function formatRelativeTime(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff < 0) return 'עבר';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `בעוד ${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `בעוד ${hours} שעות`;
  const days = Math.floor(hours / 24);
  return `בעוד ${days} ימים`;
}

function formatDelay(minutes: number): string {
  if (minutes < 60) return `${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (minutes < 1440) {
    return remaining > 0 ? `${hours} שעות ו-${remaining} דקות` : `${hours} שעות`;
  }
  const days = Math.floor(minutes / 1440);
  const leftoverHours = Math.floor((minutes % 1440) / 60);
  return leftoverHours > 0 ? `${days} ימים ו-${leftoverHours} שעות` : `${days} ימים`;
}

export default function FollowupTab({ agentId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: config, isLoading: configLoading } = useQuery<FollowupConfig | null>({
    queryKey: ['followup-config', agentId],
    queryFn: () => api.get(`/agents/${agentId}/followup/config`).then(r => r.data.data),
  });

  const { data: stats } = useQuery<FollowupStats>({
    queryKey: ['followup-stats', agentId],
    queryFn: () => api.get(`/agents/${agentId}/followup/stats`).then(r => r.data.data),
    refetchInterval: 60_000,
  });

  const { data: activeData, isLoading: activeLoading } = useQuery({
    queryKey: ['followup-active', agentId],
    queryFn: () => api.get(`/agents/${agentId}/followup/active?limit=50`).then(r => r.data),
    refetchInterval: 30_000,
  });

  const { data: upcomingData } = useQuery({
    queryKey: ['followup-upcoming', agentId],
    queryFn: () => api.get(`/agents/${agentId}/followup/upcoming`).then(r => r.data.data),
    refetchInterval: 60_000,
  });

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-[var(--text-secondary)]">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>טוען הגדרות פולואפ...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {stats && <StatsBar stats={stats} />}
      <ConfigSection agentId={agentId} config={config ?? null} qc={qc} toast={toast} />
      <StepsSection agentId={agentId} steps={config?.steps ?? []} qc={qc} toast={toast} />
      {!!upcomingData?.length && <UpcomingSection data={upcomingData} />}
      <ActiveFollowupsSection
        agentId={agentId}
        data={activeData}
        isLoading={activeLoading}
        qc={qc}
        toast={toast}
      />
    </div>
  );
}

function StatsBar({ stats }: { stats: FollowupStats }) {
  const items = [
    { label: 'מתוזמנים', value: stats.scheduled, color: 'text-blue-400' },
    { label: 'ממתינים', value: stats.pending, color: 'text-blue-400' },
    { label: 'מתבצעים', value: stats.executing, color: 'text-yellow-400' },
    { label: 'הושלמו', value: stats.completed, color: 'text-[var(--accent)]' },
    { label: 'הוסרו', value: stats.optedOut, color: 'text-red-400' },
  ];

  return (
    <Card>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            {items.map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <p className={`text-lg font-bold ${color}`}>{value}</p>
                <p className="text-xs text-[var(--text-muted)]">{label}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[var(--text-muted)]" />
            <h3 className="font-semibold text-[var(--text-primary)]">סטטיסטיקות</h3>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ConfigSection({
  agentId,
  config,
  qc,
  toast,
}: {
  agentId: string;
  config: FollowupConfig | null;
  qc: ReturnType<typeof useQueryClient>;
  toast: (msg: string, type: 'success' | 'error') => void;
}) {
  const [form, setForm] = useState({
    enabled: config?.enabled ?? false,
    generalInstruction: config?.generalInstruction ?? '',
    activeHoursStart: config?.activeHoursStart ?? '09:00',
    activeHoursEnd: config?.activeHoursEnd ?? '21:00',
    smartTimingEnabled: config?.smartTimingEnabled ?? true,
    smartTimingMinCalls: config?.smartTimingMinCalls ?? 3,
    minCallbackMinutes: config?.minCallbackMinutes ?? 5,
  });

  const saveConfig = useMutation({
    mutationFn: () => api.put(`/agents/${agentId}/followup/config`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['followup-config', agentId] });
      toast('הגדרות פולואפ נשמרו', 'success');
    },
    onError: () => toast('שגיאה בשמירה', 'error'),
  });

  return (
    <Card>
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <div />
        <h3 className="font-semibold text-[var(--text-primary)]">הגדרות פולואפ</h3>
      </div>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between">
          <Toggle
            checked={form.enabled}
            onChange={(v) => setForm(f => ({ ...f, enabled: v }))}
          />
          <span className="text-sm text-[var(--text-secondary)]">פולואפ מופעל</span>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">הנחיות כלליות לסוכן</label>
          <textarea
            value={form.generalInstruction}
            onChange={(e) => setForm(f => ({ ...f, generalInstruction: e.target.value }))}
            rows={3}
            maxLength={2000}
            className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none transition-colors"
            placeholder="הנחיות כלליות שיהיו בכל שיחת פולואפ..."
            dir="rtl"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">{form.generalInstruction.length}/2000</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">שעת סיום</label>
            <input
              type="time"
              value={form.activeHoursEnd}
              onChange={(e) => setForm(f => ({ ...f, activeHoursEnd: e.target.value }))}
              className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">שעת התחלה</label>
            <input
              type="time"
              value={form.activeHoursStart}
              onChange={(e) => setForm(f => ({ ...f, activeHoursStart: e.target.value }))}
              className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              dir="ltr"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Toggle
            checked={form.smartTimingEnabled}
            onChange={(v) => setForm(f => ({ ...f, smartTimingEnabled: v }))}
          />
          <span className="text-sm text-[var(--text-secondary)]">תזמון חכם (לפי שעות מענה)</span>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
            מינימום דקות לקולבק
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={1440}
              value={form.minCallbackMinutes}
              onChange={(e) => setForm(f => ({ ...f, minCallbackMinutes: parseInt(e.target.value) || 5 }))}
              className="w-24 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              dir="ltr"
            />
            <span className="text-xs text-[var(--text-muted)]">דקות מינימום בין קריאת schedule_callback לביצוע</span>
          </div>
        </div>

        <div className="flex justify-start">
          <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>
            <Save className="w-4 h-4" />
            {saveConfig.isPending ? 'שומר...' : 'שמור הגדרות'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StepsSection({
  agentId,
  steps,
  qc,
  toast,
}: {
  agentId: string;
  steps: FollowupStep[];
  qc: ReturnType<typeof useQueryClient>;
  toast: (msg: string, type: 'success' | 'error') => void;
}) {
  const [newStep, setNewStep] = useState({ delayMinutes: 60, instruction: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ delayMinutes: 0, instruction: '' });

  const addStep = useMutation({
    mutationFn: () => api.post(`/agents/${agentId}/followup/steps`, newStep),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['followup-config', agentId] });
      setNewStep({ delayMinutes: 60, instruction: '' });
      toast('שלב נוסף', 'success');
    },
    onError: () => toast('שגיאה בהוספת שלב', 'error'),
  });

  const updateStep = useMutation({
    mutationFn: (stepId: string) =>
      api.put(`/agents/${agentId}/followup/steps/${stepId}`, editForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['followup-config', agentId] });
      setEditingId(null);
      toast('שלב עודכן', 'success');
    },
    onError: () => toast('שגיאה בעדכון', 'error'),
  });

  const deleteStep = useMutation({
    mutationFn: (stepId: string) =>
      api.delete(`/agents/${agentId}/followup/steps/${stepId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['followup-config', agentId] });
      toast('שלב נמחק', 'success');
    },
    onError: () => toast('שגיאה במחיקה', 'error'),
  });

  function startEditing(step: FollowupStep) {
    setEditingId(step.id);
    setEditForm({ delayMinutes: step.delayMinutes, instruction: step.instruction });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-muted)]">{steps.length} שלבים</span>
        <h3 className="font-semibold text-[var(--text-primary)]">שלבי פולואפ</h3>
      </div>

      {steps.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-6 py-8 text-center">
          <RefreshCw className="w-8 h-8 mx-auto mb-2 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-secondary)]">אין שלבי פולואפ</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">הוסף שלב ראשון כדי להפעיל את מנגנון הפולואפ</p>
        </div>
      )}

      {steps.map((step, idx) => (
        <Card key={step.id}>
          <div className="px-5 py-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => deleteStep.mutate(step.id)}
                className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              {editingId === step.id ? (
                <Button
                  size="sm"
                  onClick={() => updateStep.mutate(step.id)}
                  disabled={updateStep.isPending}
                >
                  <Save className="w-3.5 h-3.5" />
                  שמור
                </Button>
              ) : (
                <button
                  onClick={() => startEditing(step)}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  ערוך
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <GripVertical className="w-4 h-4 text-[var(--text-muted)]" />
              <div className="text-left">
                <span className="text-sm font-medium text-[var(--text-primary)]">שלב {idx + 1}</span>
                <span className="text-xs text-[var(--text-muted)] mr-2">
                  <Clock className="w-3 h-3 inline ml-1" />
                  {formatDelay(step.delayMinutes)}
                </span>
              </div>
            </div>
          </div>

          {editingId === step.id ? (
            <CardContent className="space-y-3 border-t border-[var(--border)]">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">השהיה (דקות)</label>
                <input
                  type="number"
                  min={30}
                  value={editForm.delayMinutes}
                  onChange={(e) => setEditForm(f => ({ ...f, delayMinutes: parseInt(e.target.value) || 30 }))}
                  className="w-32 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">הנחיות לשלב</label>
                <textarea
                  value={editForm.instruction}
                  onChange={(e) => setEditForm(f => ({ ...f, instruction: e.target.value }))}
                  rows={3}
                  maxLength={1000}
                  className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none transition-colors"
                  dir="rtl"
                />
              </div>
            </CardContent>
          ) : (
            <CardContent className="border-t border-[var(--border)]">
              <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{step.instruction}</p>
            </CardContent>
          )}
        </Card>
      ))}

      <Card>
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <div />
          <span className="text-sm font-medium text-[var(--text-primary)]">הוסף שלב חדש</span>
        </div>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-[1fr_120px] gap-3" dir="rtl">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">הנחיות</label>
              <textarea
                value={newStep.instruction}
                onChange={(e) => setNewStep(s => ({ ...s, instruction: e.target.value }))}
                rows={2}
                maxLength={1000}
                className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] resize-none transition-colors"
                placeholder="מה הסוכן צריך לעשות בשלב הזה..."
                dir="rtl"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">השהיה (דקות)</label>
              <input
                type="number"
                min={30}
                value={newStep.delayMinutes}
                onChange={(e) => setNewStep(s => ({ ...s, delayMinutes: parseInt(e.target.value) || 30 }))}
                className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                dir="ltr"
              />
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => addStep.mutate()}
            disabled={!newStep.instruction.trim() || addStep.isPending}
          >
            <Plus className="w-4 h-4" />
            הוסף שלב
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function UpcomingSection({ data }: { data: any[] }) {
  return (
    <Card>
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <span className="text-xs text-[var(--text-muted)]">{data.length} מתוזמנים</span>
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[var(--text-muted)]" />
          <h3 className="font-semibold text-[var(--text-primary)]">פולואפים קרובים</h3>
        </div>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {data.map((f: any) => (
          <div key={f.id} className="px-5 py-3 flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--accent)] font-medium">
              {f.scheduledFor ? formatRelativeTime(f.scheduledFor) : '—'}
            </span>
            <div className="text-left">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {f.contact?.name || f.contact?.phone || '—'}
              </p>
              <p className="text-xs text-[var(--text-muted)]">שלב {f.currentStepOrder}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ActiveFollowupsSection({
  agentId,
  data,
  isLoading,
  qc,
  toast,
}: {
  agentId: string;
  data: any;
  isLoading: boolean;
  qc: ReturnType<typeof useQueryClient>;
  toast: (msg: string, type: 'success' | 'error') => void;
}) {
  const cancelFollowup = useMutation({
    mutationFn: (followupId: string) =>
      api.post(`/agents/${agentId}/followup/active/${followupId}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['followup-active', agentId] });
      qc.invalidateQueries({ queryKey: ['followup-stats', agentId] });
      toast('פולואפ בוטל', 'success');
    },
    onError: () => toast('שגיאה בביטול', 'error'),
  });

  return (
    <Card>
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <span className="text-xs text-[var(--text-muted)]">
          {data?.meta?.total ?? 0} פולואפים פעילים
        </span>
        <h3 className="font-semibold text-[var(--text-primary)]">פולואפים פעילים</h3>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {isLoading && (
          <div className="px-6 py-8 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" />
          </div>
        )}
        {!isLoading && !data?.data?.length && (
          <div className="px-6 py-10 text-center">
            <UserX className="w-8 h-8 mx-auto mb-2 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-secondary)]">אין פולואפים פעילים</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">פולואפים ייווצרו אוטומטית לאחר שיחות</p>
          </div>
        )}
        {data?.data?.map((f: any) => {
          const statusCfg = STATUS_MAP[f.status] ?? { label: f.status, variant: 'neutral' as const };
          const canCancel = ['PENDING', 'SCHEDULED'].includes(f.status);

          return (
            <div key={f.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 shrink-0">
                {canCancel && (
                  <button
                    onClick={() => cancelFollowup.mutate(f.id)}
                    className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-red-400 transition-colors"
                    title="בטל פולואפ"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                )}
                <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                <span className="text-xs text-[var(--text-muted)]">שלב {f.currentStepOrder}</span>
              </div>

              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {f.contact?.name || f.contact?.phone || '—'}
                </p>
                {f.scheduledFor && (
                  <p className="text-xs text-[var(--text-muted)]">
                    <span dir="ltr">{new Date(f.scheduledFor).toLocaleString('he-IL')}</span>
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
