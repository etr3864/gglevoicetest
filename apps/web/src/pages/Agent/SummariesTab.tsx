import { useState } from 'react';
import { Save, RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Toggle } from '../../components/ui/Toggle';

const SAMPLE_WEBHOOK_PAYLOAD = JSON.stringify({
  event: 'call_summary',
  timestamp: '2026-03-13T14:30:00Z',
  agent_id: '<agent_id>',
  agent_name: 'שם הסוכן',
  call_id: '<call_id>',
  direction: 'outbound',
  duration_sec: 245,
  started_at: '2026-03-13T14:25:00Z',
  ended_at: '2026-03-13T14:29:05Z',
  customer_name: 'יוסי כהן',
  customer_phone: '+972501234567',
  recording_url: 'https://storage.googleapis.com/...',
  utterance_count: 23,
  call_context: null,
  summary: 'תוכן הסיכום שנוצר על ידי ה-AI...',
}, null, 2);

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
}, null, 2);

interface SummariesTabProps {
  agentId: string;
  form: any;
  setForm: (fn: (f: any) => any) => void;
  webhookTestResult: any;
  setWebhookTestResult: (r: any) => void;
  onSave: (data: Record<string, unknown>) => void;
  isSaving: boolean;
}

export default function SummariesTab({ agentId, form, setForm, webhookTestResult, setWebhookTestResult, onSave, isSaving }: SummariesTabProps) {
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [testingApptWebhook, setTestingApptWebhook] = useState(false);
  const [apptWebhookTestResult, setApptWebhookTestResult] = useState<{ success: boolean; statusCode: number | null; latencyMs: number } | null>(null);

  const testWebhook = async () => {
    if (!form.webhookUrl) return;
    setTestingWebhook(true);
    try {
      const res = await api.post(`/agents/${agentId}/webhook-test`);
      setWebhookTestResult(res.data.data);
    } catch {
      setWebhookTestResult({ success: false, statusCode: null, latencyMs: 0 });
    } finally {
      setTestingWebhook(false);
    }
  };

  const testApptWebhook = async () => {
    if (!form.appointmentWebhookUrl) return;
    setTestingApptWebhook(true);
    try {
      const res = await api.post(`/agents/${agentId}/appointment-webhook-test`);
      setApptWebhookTestResult(res.data.data);
    } catch {
      setApptWebhookTestResult({ success: false, statusCode: null, latencyMs: 0 });
    } finally {
      setTestingApptWebhook(false);
    }
  };

  const saveSummaryConfig = () => {
    onSave({
      summaryEnabled: form.summaryEnabled,
      summaryMinDuration: form.summaryMinDuration,
      summaryPrompt: form.summaryPrompt || null,
      webhookUrl: form.webhookUrl || null,
      webhookSecret: form.webhookSecret || null,
      webhookRetryCount: form.webhookRetryCount,
      webhookRetryDelay: form.webhookRetryDelay,
      appointmentWebhookUrl: form.appointmentWebhookUrl || null,
      appointmentWebhookSecret: form.appointmentWebhookSecret || null,
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="px-5 pt-4 pb-2">
          <h3 className="font-semibold text-[var(--text-primary)]">הגדרות סיכום</h3>
        </div>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Toggle
              checked={form.summaryEnabled}
              onChange={(v) => setForm((f: any) => ({ ...f, summaryEnabled: v }))}
            />
            <span className="text-sm text-[var(--text-secondary)]">סיכומים מופעלים</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5 text-right">
              מינימום אורך שיחה לסיכום (שניות)
            </label>
            <input
              type="number"
              min={0}
              max={3600}
              value={form.summaryMinDuration}
              onChange={(e) => setForm((f: any) => ({ ...f, summaryMinDuration: parseInt(e.target.value) || 0 }))}
              className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5 text-right">
              הנחיות לסיכום (ריק = ברירת מחדל)
            </label>
            <textarea
              value={form.summaryPrompt}
              onChange={(e) => setForm((f: any) => ({ ...f, summaryPrompt: e.target.value }))}
              rows={4}
              className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none transition-colors"
              placeholder="לדוגמה: זהה אם הלקוח מעוניין לקנות, מה עלה בשיחה, ומה הצעד הבא."
              dir="rtl"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <div className="px-5 pt-4 pb-2">
          <h3 className="font-semibold text-[var(--text-primary)]">Webhook</h3>
        </div>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              {form.webhookUrl && (
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
                <span className={`text-xs ${webhookTestResult.success ? 'text-[var(--accent)]' : 'text-red-400'}`}>
                  {webhookTestResult.success ? `${webhookTestResult.statusCode} OK (${webhookTestResult.latencyMs}ms)` : `נכשל (${webhookTestResult.statusCode ?? 'timeout'})`}
                </span>
              )}
              <label className="text-sm font-medium text-[var(--text-secondary)]">Webhook URL</label>
            </div>
            <input
              type="url"
              value={form.webhookUrl}
              onChange={(e) => { setForm((f: any) => ({ ...f, webhookUrl: e.target.value })); setWebhookTestResult(null); }}
              className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
              placeholder="https://hooks.yourapp.com/call-summary"
              dir="ltr"
            />
          </div>

          <Input
            label="Webhook Secret (HMAC)"
            value={form.webhookSecret}
            onChange={(e) => setForm((f: any) => ({ ...f, webhookSecret: e.target.value }))}
            dir="ltr"
            placeholder="אופציונלי — לאימות חתימה"
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5 text-right">ניסיונות חוזרים</label>
              <input
                type="number" min={0} max={10}
                value={form.webhookRetryCount}
                onChange={(e) => setForm((f: any) => ({ ...f, webhookRetryCount: parseInt(e.target.value) || 0 }))}
                className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5 text-right">השהייה בין ניסיונות (שניות)</label>
              <input
                type="number" min={1} max={3600}
                value={form.webhookRetryDelay}
                onChange={(e) => setForm((f: any) => ({ ...f, webhookRetryDelay: parseInt(e.target.value) || 60 }))}
                className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                dir="ltr"
              />
            </div>
          </div>

          <details className="group">
            <summary className="text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] transition-colors">
              דוגמת payload
            </summary>
            <pre className="mt-2 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-3 text-xs font-mono text-[var(--text-primary)] overflow-x-auto" dir="ltr">
              {SAMPLE_WEBHOOK_PAYLOAD}
            </pre>
          </details>
        </CardContent>
      </Card>

      <Card>
        <div className="px-5 pt-4 pb-2">
          <h3 className="font-semibold text-[var(--text-primary)]">Webhook פגישות</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">שליחת אירועי יומן (קביעה / שינוי / ביטול) לכתובת חיצונית</p>
        </div>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5 text-right">Webhook URL</label>
            <input
              type="url"
              value={form.appointmentWebhookUrl}
              onChange={(e) => setForm((f: any) => ({ ...f, appointmentWebhookUrl: e.target.value }))}
              className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
              placeholder="https://hooks.yourapp.com/appointments"
              dir="ltr"
            />
          </div>
          <Input
            label="Webhook Secret (HMAC)"
            value={form.appointmentWebhookSecret}
            onChange={(e) => setForm((f: any) => ({ ...f, appointmentWebhookSecret: e.target.value }))}
            dir="ltr"
            placeholder="אופציונלי — לאימות חתימה"
          />
          {form.appointmentWebhookUrl && (
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" onClick={testApptWebhook} disabled={testingApptWebhook}>
                {testingApptWebhook ? 'בודק...' : 'בדוק חיבור'}
              </Button>
              {apptWebhookTestResult && (
                <span className={`text-xs font-medium ${apptWebhookTestResult.success ? 'text-green-500' : 'text-red-500'}`}>
                  {apptWebhookTestResult.success
                    ? `✓ ${apptWebhookTestResult.statusCode} · ${apptWebhookTestResult.latencyMs}ms`
                    : `✗ ${apptWebhookTestResult.statusCode ?? 'error'} · ${apptWebhookTestResult.latencyMs}ms`}
                </span>
              )}
            </div>
          )}
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
        <Button onClick={saveSummaryConfig} disabled={isSaving}>
          <Save className="w-4 h-4" />
          {isSaving ? 'שומר...' : 'שמור'}
        </Button>
      </div>
    </div>
  );
}
