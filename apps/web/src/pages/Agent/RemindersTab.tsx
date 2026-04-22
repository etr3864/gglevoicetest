import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Phone, BellOff, CheckCircle, XCircle, Clock, Loader2, Play } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { useToast } from '../../components/ui/Toast';
import { cn } from '../../lib/cn';

interface ReminderRule {
  minutesBefore: number;
  contentType: 'template' | 'ai';
  template: string | null;
  aiPrompt: string | null;
}

interface ReminderConfig {
  enabled: boolean;
  retryAttempts: number;
  retryDelayMinutes: number;
  rules: ReminderRule[];
}

interface Props {
  agentId: string;
  agent: any;
}

const PRESET_OPTIONS = [
  { label: '15 דקות לפני', value: 15 },
  { label: '30 דקות לפני', value: 30 },
  { label: 'שעה לפני', value: 60 },
  { label: 'יום לפני (24 שעות)', value: 1440 },
  { label: 'מותאם אישית', value: -1 },
];

const TEMPLATE_VARS = ['{customer_name}', '{title}', '{date}', '{time}', '{day}', '{duration}', '{agent_name}'];

const STATUS_CONFIG: Record<string, { label: string; variant: 'success' | 'danger' | 'warning' | 'info' | 'neutral' }> = {
  PENDING: { label: 'ממתין', variant: 'info' },
  CALLING: { label: 'מתקשר...', variant: 'warning' },
  COMPLETED: { label: 'הושלם', variant: 'success' },
  NO_ANSWER: { label: 'לא נענה', variant: 'neutral' },
  FAILED: { label: 'נכשל', variant: 'danger' },
  CANCELLED: { label: 'בוטל', variant: 'neutral' },
};

function defaultConfig(): ReminderConfig {
  return { enabled: false, retryAttempts: 2, retryDelayMinutes: 5, rules: [] };
}

function defaultRule(): ReminderRule {
  return { minutesBefore: 60, contentType: 'template', template: 'שלום {customer_name}, תזכורת לפגישה שלך "{title}" בתאריך {date} בשעה {time}.', aiPrompt: null };
}

export default function RemindersTab({ agentId, agent }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [config, setConfig] = useState<ReminderConfig>(defaultConfig());
  const [customMinutes, setCustomMinutes] = useState<Record<number, number>>({});

  useEffect(() => {
    const existing = agent?.calendarConfig?.reminders;
    setConfig(existing ? { ...defaultConfig(), ...existing } : defaultConfig());
  }, [agent]);

  const { data: remindersData, isLoading: remindersLoading } = useQuery({
    queryKey: ['agent-reminders', agentId],
    queryFn: () => api.get(`/agents/${agentId}/reminders?limit=50`).then(r => r.data),
    refetchInterval: 300_000,
  });

  const saveConfig = useMutation({
    mutationFn: () =>
      api.patch(`/agents/${agentId}`, {
        calendarConfig: { ...agent?.calendarConfig, reminders: config },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', agentId] });
      toast('הגדרות תזכורות נשמרו', 'success');
    },
    onError: () => toast('שגיאה בשמירה', 'error'),
  });

  const triggerReminder = useMutation({
    mutationFn: (reminderId: string) =>
      api.post(`/agents/${agentId}/reminders/${reminderId}/trigger`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-reminders', agentId] });
      toast('תזכורת הופעלה', 'success');
    },
    onError: () => toast('שגיאה בהפעלה', 'error'),
  });

  const cancelReminder = useMutation({
    mutationFn: (reminderId: string) =>
      api.post(`/agents/${agentId}/reminders/${reminderId}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-reminders', agentId] });
      toast('תזכורת בוטלה', 'success');
    },
    onError: () => toast('שגיאה בביטול', 'error'),
  });

  function addRule() {
    setConfig(c => ({ ...c, rules: [...c.rules, defaultRule()] }));
  }

  function removeRule(idx: number) {
    setConfig(c => ({ ...c, rules: c.rules.filter((_, i) => i !== idx) }));
  }

  function updateRule(idx: number, patch: Partial<ReminderRule>) {
    setConfig(c => ({
      ...c,
      rules: c.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  }

  function getPresetValue(rule: ReminderRule, idx: number): number {
    if (customMinutes[idx] !== undefined) return -1;
    const preset = PRESET_OPTIONS.find(p => p.value !== -1 && p.value === rule.minutesBefore);
    return preset ? preset.value : -1;
  }

  function handlePresetChange(idx: number, value: number) {
    if (value === -1) {
      setCustomMinutes(prev => ({ ...prev, [idx]: config.rules[idx].minutesBefore }));
    } else {
      setCustomMinutes(prev => {
        const next = { ...prev };
        delete next[idx];
        return next;
      });
      updateRule(idx, { minutesBefore: value });
    }
  }

  const hasCalendar = !!agent?.calendarConfig?.accessToken;

  return (
    <div className="space-y-6" dir="rtl">
      {!hasCalendar && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          לחיבור תזכורות נדרש חיבור ליומן Google. עבור לטאב יומן כדי לחבר.
        </div>
      )}

      {/* Settings */}
      <Card>
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <h3 className="font-semibold text-[var(--text-primary)]">הגדרות תזכורות</h3>
        </div>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <Toggle
              checked={config.enabled}
              onChange={(v) => setConfig(c => ({ ...c, enabled: v }))}
            />
            <span className="text-sm text-[var(--text-secondary)]">תזכורות מופעלות</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">ניסיונות חוזרים</label>
              <input
                type="number" min={0} max={5}
                value={config.retryAttempts}
                onChange={(e) => setConfig(c => ({ ...c, retryAttempts: parseInt(e.target.value) || 0 }))}
                className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">השהייה בין ניסיונות (דקות)</label>
              <input
                type="number" min={1} max={60}
                value={config.retryDelayMinutes}
                onChange={(e) => setConfig(c => ({ ...c, retryDelayMinutes: parseInt(e.target.value) || 5 }))}
                className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                dir="ltr"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rules */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Button size="sm" variant="secondary" onClick={addRule}>
            <Plus className="w-4 h-4" />
            הוסף תזכורת
          </Button>
          <span className="text-sm font-semibold text-[var(--text-primary)]">כללי תזכורת</span>
        </div>

        {config.rules.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--border)] px-6 py-8 text-center">
            <BellOff className="w-8 h-8 mx-auto mb-2 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-secondary)]">אין כללי תזכורת</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">לחץ "הוסף תזכורת" להגדרת שיחה אוטומטית</p>
          </div>
        )}

        {config.rules.map((rule, idx) => (
          <Card key={idx}>
            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
              <button
                onClick={() => removeRule(idx)}
                className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium text-[var(--text-primary)]">תזכורת {idx + 1}</span>
            </div>
            <CardContent className="space-y-4">
              {/* Timing */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">מתי לשלוח</label>
                <select
                  value={getPresetValue(rule, idx)}
                  onChange={(e) => handlePresetChange(idx, parseInt(e.target.value))}
                  className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                >
                  {PRESET_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {getPresetValue(rule, idx) === -1 && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={rule.minutesBefore}
                      onChange={(e) => updateRule(idx, { minutesBefore: parseInt(e.target.value) || 1 })}
                      className="w-28 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                      dir="ltr"
                    />
                    <span className="text-sm text-[var(--text-muted)]">דקות לפני הפגישה</span>
                  </div>
                )}
              </div>

              {/* Content type */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">סוג תוכן</label>
                <div className="flex rounded-lg border border-[var(--border)] overflow-hidden w-fit">
                  {(['template', 'ai'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => updateRule(idx, { contentType: type })}
                      className={cn(
                        'px-4 py-2 text-sm font-medium transition-colors',
                        rule.contentType === type
                          ? 'bg-[var(--accent)] text-white'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                      )}
                    >
                      {type === 'template' ? 'טקסט קבוע' : 'AI חופשי'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Template content */}
              {rule.contentType === 'template' && (
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">תוכן ההודעה</label>
                  <textarea
                    value={rule.template || ''}
                    onChange={(e) => updateRule(idx, { template: e.target.value })}
                    rows={3}
                    className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none transition-colors"
                    placeholder="שלום {customer_name}, תזכורת לפגישה שלך ב-{time}..."
                    dir="rtl"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {TEMPLATE_VARS.map(v => (
                      <button
                        key={v}
                        onClick={() => updateRule(idx, { template: (rule.template || '') + v })}
                        className="px-2 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs font-mono text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                        dir="ltr"
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* AI prompt */}
              {rule.contentType === 'ai' && (
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">הנחיות לסוכן</label>
                  <textarea
                    value={rule.aiPrompt || ''}
                    onChange={(e) => updateRule(idx, { aiPrompt: e.target.value })}
                    rows={4}
                    className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none transition-colors"
                    placeholder="לדוגמה: הזכר ללקוח על הפגישה בצורה חמה ומקצועית. אם הלקוח מבקש לבטל, נסה להציע זמן חלופי."
                    dir="rtl"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-start">
        <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>
          <Save className="w-4 h-4" />
          {saveConfig.isPending ? 'שומר...' : 'שמור הגדרות'}
        </Button>
      </div>

      {/* Reminders list */}
      <Card>
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)]">
            {remindersData?.meta?.total ?? 0} תזכורות
          </span>
          <h3 className="font-semibold text-[var(--text-primary)]">תזכורות מתוזמנות</h3>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {remindersLoading && (
            <div className="px-6 py-8 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" />
            </div>
          )}
          {!remindersLoading && !remindersData?.data?.length && (
            <div className="px-6 py-10 text-center">
              <Clock className="w-8 h-8 mx-auto mb-2 text-[var(--text-muted)]" />
              <p className="text-sm text-[var(--text-secondary)]">אין תזכורות עדיין</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">תזכורות ייווצרו אוטומטית עם קביעת פגישות</p>
            </div>
          )}
          {remindersData?.data?.map((r: any) => {
            const statusCfg = STATUS_CONFIG[r.status] ?? { label: r.status, variant: 'neutral' as const };
            const canTrigger = ['PENDING', 'NO_ANSWER', 'FAILED'].includes(r.status);
            const canCancel = ['PENDING', 'CALLING'].includes(r.status);

            return (
              <div key={r.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 shrink-0">
                  {canTrigger && (
                    <button
                      onClick={() => triggerReminder.mutate(r.id)}
                      className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                      title="הפעל עכשיו"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {canCancel && (
                    <button
                      onClick={() => cancelReminder.mutate(r.id)}
                      className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-red-400 transition-colors"
                      title="בטל תזכורת"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                  {r.attempts > 0 && (
                    <span className="text-xs text-[var(--text-muted)]">{r.attempts} ניסיון</span>
                  )}
                </div>

                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {r.appointment?.title ?? '—'}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {r.contact?.name || r.contact?.phone || '—'} &bull;{' '}
                    <span dir="ltr">{new Date(r.scheduledFor).toLocaleString('he-IL')}</span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
