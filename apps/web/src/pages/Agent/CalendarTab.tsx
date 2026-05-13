import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Link2, Unlink, Loader2, RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';

const SAMPLE_APPOINTMENT_WEBHOOK_PAYLOAD = JSON.stringify({
  event: 'appointment_booked',
  timestamp: '2026-03-14T10:00:00Z',
  appointment_id: '<appointment_id>',
  agent_id: '<agent_id>',
  agent_name: 'שם הסוכן',
  customer_name: 'יוסי כהן',
  customer_phone: '+972501234567',
  title: 'פגישת ייעוץ',
  date: '2026-03-20',
  time: '10:00',
  duration_min: 30,
  call_id: '<call_id>',
  direction: 'inbound',
  summary: 'תוכן הסיכום שנוצר ע״י ה-AI (null אם סיכומים מבוטלים בסוכן)',
}, null, 2);

interface Props {
  agentId: string;
  agent: any;
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAY_LABELS: Record<string, string> = {
  sunday: 'ראשון',
  monday: 'שני',
  tuesday: 'שלישי',
  wednesday: 'רביעי',
  thursday: 'חמישי',
  friday: 'שישי',
  saturday: 'שבת',
};

const DEFAULT_HOURS: Record<string, { start: string; end: string } | null> = {
  sunday: { start: '09:00', end: '17:00' },
  monday: { start: '09:00', end: '17:00' },
  tuesday: { start: '09:00', end: '17:00' },
  wednesday: { start: '09:00', end: '17:00' },
  thursday: { start: '09:00', end: '17:00' },
  friday: null,
  saturday: null,
};

export default function CalendarTab({ agentId, agent }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ['calendar-status', agentId],
    queryFn: () => api.get(`/agents/${agentId}/calendar/status`).then(r => r.data.data),
  });

  const [instructions, setInstructions] = useState(agent.calendarInstructions || '');
  const [hours, setHours] = useState<Record<string, { start: string; end: string } | null>>(
    agent.businessHours || DEFAULT_HOURS,
  );
  const [webhookUrl, setWebhookUrl] = useState(agent.appointmentWebhookUrl || '');
  const [webhookSecret, setWebhookSecret] = useState(agent.appointmentWebhookSecret || '');
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<{ success: boolean; statusCode: number | null; latencyMs: number } | null>(null);

  useEffect(() => {
    setInstructions(agent.calendarInstructions || '');
    setHours(agent.businessHours || DEFAULT_HOURS);
    setWebhookUrl(agent.appointmentWebhookUrl || '');
    setWebhookSecret(agent.appointmentWebhookSecret || '');
  }, [agent]);

  const selectCalendar = useMutation({
    mutationFn: (calendarId: string) =>
      api.patch(`/agents/${agentId}/calendar/select`, { calendarId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-status', agentId] });
      toast('יומן עודכן', 'success');
    },
    onError: () => toast('שגיאה בעדכון יומן', 'error'),
  });

  const connect = useMutation({
    mutationFn: () => api.get(`/agents/${agentId}/calendar/connect`).then(r => r.data.data),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: () => toast('שגיאה בחיבור', 'error'),
  });

  const disconnect = useMutation({
    mutationFn: () => api.post(`/agents/${agentId}/calendar/disconnect`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-status', agentId] });
      qc.invalidateQueries({ queryKey: ['agent', agentId] });
      toast('יומן נותק', 'success');
    },
    onError: () => toast('שגיאה בניתוק', 'error'),
  });

  const saveSettings = useMutation({
    mutationFn: () =>
      api.patch(`/agents/${agentId}`, {
        calendarInstructions: instructions || null,
        businessHours: hours,
        appointmentWebhookUrl: webhookUrl || null,
        appointmentWebhookSecret: webhookSecret || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', agentId] });
      toast('הגדרות יומן נשמרו', 'success');
    },
    onError: () => toast('שגיאה בשמירה', 'error'),
  });

  const testWebhook = async () => {
    if (!webhookUrl) return;
    setTestingWebhook(true);
    setWebhookTestResult(null);
    try {
      const res = await api.post(`/agents/${agentId}/appointment-webhook-test`);
      setWebhookTestResult(res.data.data);
    } catch {
      setWebhookTestResult({ success: false, statusCode: null, latencyMs: 0 });
    } finally {
      setTestingWebhook(false);
    }
  };

  const connected = statusData?.connected ?? false;

  function toggleDay(day: string) {
    setHours(prev => ({
      ...prev,
      [day]: prev[day] ? null : { start: '09:00', end: '17:00' },
    }));
  }

  function updateDayTime(day: string, field: 'start' | 'end', value: string) {
    setHours(prev => ({
      ...prev,
      [day]: prev[day] ? { ...prev[day]!, [field]: value } : null,
    }));
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Connection Card */}
      <Card>
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-[var(--text-primary)]">חיבור יומן</h3>
            <Badge variant={connected ? 'success' : 'danger'}>
              {connected ? 'מחובר' : 'לא מחובר'}
            </Badge>
          </div>
          <div>
            {statusLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" />
            ) : connected ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                <Unlink className="w-3.5 h-3.5" />
                נתק יומן
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => connect.mutate()}
                disabled={connect.isPending}
              >
                <Link2 className="w-3.5 h-3.5" />
                חבר Google Calendar
              </Button>
            )}
          </div>
        </div>
        {connected && statusData?.calendarId && (
          <CardContent>
            {statusData.calendars?.length > 1 ? (
              <div className="flex items-center gap-3">
                <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">יומן פעיל:</label>
                <select
                  value={statusData.calendarId}
                  onChange={(e) => selectCalendar.mutate(e.target.value)}
                  disabled={selectCalendar.isPending}
                  className="flex-1 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  dir="ltr"
                >
                  {statusData.calendars.map((cal: { id: string; summary: string }) => (
                    <option key={cal.id} value={cal.id}>{cal.summary} ({cal.id})</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)]" dir="ltr">
                {statusData.calendarId}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Business Hours Card */}
      <Card>
        <div className="px-5 pt-4 pb-2">
          <h3 className="font-semibold text-[var(--text-primary)]">שעות פעילות</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            הגדר באילו ימים ושעות הסוכן זמין לקביעת פגישות. הסוכן לא יקבע מחוץ לשעות אלו.
          </p>
        </div>
        <CardContent className="space-y-3">
          {DAY_KEYS.map(day => {
            const active = !!hours[day];
            const inputCls = "rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]";
            return (
              <div key={day} className="flex items-center gap-4">
                {/* Day name + toggle (rightmost in RTL) */}
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[var(--text-primary)] w-12">{DAY_LABELS[day]}</span>
                  <Toggle checked={active} onChange={() => toggleDay(day)} />
                </div>
                {/* Hours — adjacent to toggle, reading RTL: מ [start] עד [end] */}
                {active ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-[var(--text-muted)]">מ</span>
                    <input dir="ltr" type="time" value={hours[day]!.start} onChange={(e) => updateDayTime(day, 'start', e.target.value)} className={inputCls} />
                    <span className="text-[var(--text-muted)]">עד</span>
                    <input dir="ltr" type="time" value={hours[day]!.end} onChange={(e) => updateDayTime(day, 'end', e.target.value)} className={inputCls} />
                  </div>
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">סגור</span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Scheduling Instructions Card */}
      <Card>
        <div className="px-5 pt-4 pb-2">
          <h3 className="font-semibold text-[var(--text-primary)]">הנחיות תזמון</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            הנחיות חופשיות ל-AI לגבי קביעת פגישות (יתווספו ל-System Prompt)
          </p>
        </div>
        <CardContent>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={6}
            className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none leading-relaxed transition-colors"
            placeholder="לדוגמה: כשלקוח מבקש לקבוע פגישה, בדוק קודם זמינות ליום המבוקש. משך ברירת מחדל 30 דקות. אם אין זמינות, הצע יום אחר."
            dir="rtl"
          />
        </CardContent>
      </Card>

      {/* Appointment Webhook Card */}
      <Card>
        <div className="px-5 pt-4 pb-2">
          <h3 className="font-semibold text-[var(--text-primary)]">Webhook פגישות</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            שליחת אירועי יומן (קביעה / שינוי / ביטול) לכתובת חיצונית. נשלח בסוף השיחה ביחד עם סיכום השיחה (לפי הנחיות הסיכום בטאב סיכומים).
          </p>
        </div>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              {webhookUrl && (
                <button
                  onClick={testWebhook}
                  disabled={testingWebhook}
                  className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <RefreshCw className={cn('w-3 h-3', testingWebhook && 'animate-spin')} />
                  בדוק חיבור
                </button>
              )}
              {webhookTestResult && (
                <span className={`text-xs font-medium ${webhookTestResult.success ? 'text-[var(--accent)]' : 'text-red-400'}`}>
                  {webhookTestResult.success
                    ? `✓ ${webhookTestResult.statusCode} · ${webhookTestResult.latencyMs}ms`
                    : `✗ ${webhookTestResult.statusCode ?? 'timeout'} · ${webhookTestResult.latencyMs}ms`}
                </span>
              )}
              <label className="text-sm font-medium text-[var(--text-secondary)]">Webhook URL</label>
            </div>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => { setWebhookUrl(e.target.value); setWebhookTestResult(null); }}
              className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
              placeholder="https://hooks.yourapp.com/appointments"
              dir="ltr"
            />
          </div>
          <Input
            label="Webhook Secret (HMAC)"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            dir="ltr"
            placeholder="אופציונלי — לאימות חתימה"
          />
          <details className="group">
            <summary className="text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] transition-colors">
              דוגמת payload
            </summary>
            <pre className="mt-2 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-3 text-xs font-mono text-[var(--text-primary)] overflow-x-auto" dir="ltr">
              {SAMPLE_APPOINTMENT_WEBHOOK_PAYLOAD}
            </pre>
          </details>
        </CardContent>
      </Card>

      <div className="flex justify-start">
        <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
          <Save className="w-4 h-4" />
          {saveSettings.isPending ? 'שומר...' : 'שמור הגדרות יומן'}
        </Button>
      </div>
    </div>
  );
}
