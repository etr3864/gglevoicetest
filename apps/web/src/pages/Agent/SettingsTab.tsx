import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Save, Trash2, PhoneCall, PhoneOutgoing,
  Eye, EyeOff, RefreshCw, Copy, Check,
} from 'lucide-react';
import api from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';

const TEMPERATURE_LABELS: Record<number, string> = {
  0.0: 'דטרמיניסטי', 0.3: 'שמרני', 0.5: 'מקצועי', 0.7: 'מאוזן',
  1.0: 'יצירתי', 1.4: 'ספונטני', 2.0: 'כאוטי',
};

function temperatureLabel(val: number): string {
  const keys = Object.keys(TEMPERATURE_LABELS).map(Number).sort((a, b) => a - b);
  const closest = keys.reduce((prev, k) => Math.abs(k - val) < Math.abs(prev - val) ? k : prev, keys[0]);
  return Math.abs(closest - val) <= 0.15 ? TEMPERATURE_LABELS[closest] : '';
}

interface SettingsTabProps {
  agent: any;
  form: any;
  setForm: (fn: (f: any) => any) => void;
  voices: { id: string; label: string; gender: string; description: string }[];
  onSave: (data: Record<string, unknown>) => void;
  onDelete: () => void;
  isSaving: boolean;
}

export default function SettingsTab({ agent, form, setForm, voices, onSave, onDelete, isSaving }: SettingsTabProps) {
  const femaleVoices = voices.filter(v => v.gender === 'female');
  const maleVoices = voices.filter(v => v.gender === 'male');

  return (
    <div className="space-y-4">
      <Card>
        <div className="px-5 pt-4 pb-2">
          <h3 className="font-semibold text-[var(--text-primary)]">כללי</h3>
        </div>
        <CardContent className="space-y-4">
          <Input
            label="שם הסוכן"
            value={form.name}
            onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))}
          />
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">קול</label>
            <select
              value={form.voice}
              onChange={(e) => setForm((f: any) => ({ ...f, voice: e.target.value }))}
              className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
              dir="rtl"
            >
              {femaleVoices.length > 0 && (
                <optgroup label="נשי">
                  {femaleVoices.map(v => (
                    <option key={v.id} value={v.id}>{v.label} — {v.description}</option>
                  ))}
                </optgroup>
              )}
              {maleVoices.length > 0 && (
                <optgroup label="גברי">
                  {maleVoices.map(v => (
                    <option key={v.id} value={v.id}>{v.label} — {v.description}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-[var(--text-muted)]">
                {form.temperature.toFixed(1)}
                {temperatureLabel(form.temperature) && (
                  <span className="mr-1.5 text-[var(--text-secondary)]">— {temperatureLabel(form.temperature)}</span>
                )}
              </span>
              <label className="text-sm font-medium text-[var(--text-secondary)]">טמפרטורה</label>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={form.temperature}
              onChange={(e) => setForm((f: any) => ({ ...f, temperature: parseFloat(e.target.value) }))}
              className="w-full accent-violet-500"
            />
            <div className="flex justify-between text-xs text-[var(--text-muted)] mt-1">
              <span>0.0</span>
              <span>1.0</span>
              <span>2.0</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <div className="px-5 pt-4 pb-2 flex items-center gap-2">
          <h3 className="font-semibold text-[var(--text-primary)]">טלפוניה (Telnyx)</h3>
          <PhoneCall className="w-4 h-4 text-[var(--text-muted)]" />
        </div>
        <CardContent className="space-y-4">
          <Input
            label="מספר טלפון"
            value={form.phoneNumber}
            onChange={(e) => setForm((f: any) => ({ ...f, phoneNumber: e.target.value }))}
            dir="ltr"
            placeholder="+972501234567"
          />
          <Input
            label="Telnyx Phone ID"
            value={form.telnyxPhoneId}
            onChange={(e) => setForm((f: any) => ({ ...f, telnyxPhoneId: e.target.value }))}
            dir="ltr"
            placeholder="מופיע בדאשבורד של Telnyx"
          />
          <Input
            label="Telnyx App ID (TeXML)"
            value={form.telnyxAppId}
            onChange={(e) => setForm((f: any) => ({ ...f, telnyxAppId: e.target.value }))}
            dir="ltr"
            placeholder="מופיע ב-TeXML Applications"
          />
        </CardContent>
      </Card>

      <Card>
        <div className="px-5 pt-4 pb-2">
          <h3 className="font-semibold text-[var(--text-primary)]">מידע</h3>
        </div>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[var(--text-secondary)]">ID</p>
            <p className="font-mono text-xs text-[var(--text-muted)] mt-0.5">{agent.id}</p>
          </div>
          <div>
            <p className="text-[var(--text-secondary)]">נוצר</p>
            <p className="text-[var(--text-muted)] mt-0.5">
              {new Date(agent.createdAt).toLocaleString('he-IL')}
            </p>
          </div>
        </CardContent>
      </Card>

      <ApiReferenceCard agentId={agent.id} apiKey={agent.apiKey} />

      <div className="flex items-center gap-3">
        <Button
          onClick={() => onSave({
            name: form.name,
            voice: form.voice,
            phoneNumber: form.phoneNumber || null,
            telnyxPhoneId: form.telnyxPhoneId || null,
            telnyxAppId: form.telnyxAppId || null,
            modelConfig: { generation: { temperature: form.temperature } },
          })}
          disabled={isSaving}
        >
          <Save className="w-4 h-4" />
          {isSaving ? 'שומר...' : 'שמור הגדרות'}
        </Button>
        <Button
          variant="danger"
          onClick={() => { if (confirm('למחוק את הסוכן הזה?')) onDelete(); }}
        >
          <Trash2 className="w-4 h-4" />
          מחק סוכן
        </Button>
      </div>
    </div>
  );
}

function ApiReferenceCard({ agentId, apiKey: initialKey }: { agentId: string; apiKey: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const apiBase = import.meta.env.VITE_API_URL || window.location.origin;

  const regenerate = useMutation({
    mutationFn: () => api.post(`/agents/${agentId}/regenerate-key`).then(r => r.data.data.apiKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', agentId] });
      toast('מפתח חדש נוצר', 'success');
    },
  });

  const apiKey = initialKey || '';
  const maskedKey = apiKey.length > 8
    ? apiKey.slice(0, 6) + '•'.repeat(Math.min(apiKey.length - 10, 20)) + apiKey.slice(-4)
    : '••••••••';

  const curlExample = `curl -X POST ${apiBase}/v1/calls \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${apiKey}" \\
  -d '{
    "phone": "+972541234567",
    "contact_name": "שם הלקוח",
    "gender": "male",
    "context": { "source": "api" }
  }'`;

  const jsonExample = JSON.stringify({
    phone: '+972541234567',
    contact_name: 'שם הלקוח',
    gender: 'male',
    context: { source: 'api' },
  }, null, 2);

  function copy(key: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  const CopyBtn = ({ id, text }: { id: string; text: string }) => (
    <button
      onClick={() => copy(id, text)}
      className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
    >
      {copied === id
        ? <Check className="w-3.5 h-3.5 text-[var(--accent)]" />
        : <Copy className="w-3.5 h-3.5" />}
    </button>
  );

  if (!apiKey) {
    return (
      <Card>
        <div className="px-5 pt-4 pb-2 flex items-center gap-2" dir="rtl">
          <PhoneOutgoing className="w-4 h-4 text-[var(--text-muted)]" />
          <h3 className="font-semibold text-[var(--text-primary)]">API — הוצאת שיחה</h3>
        </div>
        <CardContent dir="rtl">
          <p className="text-sm text-[var(--text-muted)] mb-3">לסוכן הזה אין עדיין מפתח API.</p>
          <Button size="sm" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
            <RefreshCw className="w-3.5 h-3.5" />
            צור מפתח
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <div className="px-5 pt-4 pb-2 flex items-center gap-2" dir="rtl">
        <PhoneOutgoing className="w-4 h-4 text-[var(--text-muted)]" />
        <h3 className="font-semibold text-[var(--text-primary)]">API — הוצאת שיחה</h3>
      </div>
      <CardContent className="space-y-4" dir="rtl">
        <div className="space-y-2.5 text-sm">
          <div className="flex items-center justify-between">
            <CopyBtn id="url" text={`${apiBase}/v1/calls`} />
            <div className="flex items-center gap-2">
              <Badge variant="info">POST</Badge>
              <span className="font-mono text-xs text-[var(--text-muted)]" dir="ltr">{apiBase}/v1/calls</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                onClick={() => { if (confirm('ליצור מפתח חדש? המפתח הישן יפסיק לעבוד.')) regenerate.mutate(); }}
                className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                title="צור מפתח חדש"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <CopyBtn id="apikey" text={apiKey} />
              <button
                onClick={() => setShowKey(p => !p)}
                className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-secondary)]">API Key:</span>
              <code className="font-mono text-xs bg-[var(--bg-primary)] px-2 py-0.5 rounded" dir="ltr">
                {showKey ? apiKey : maskedKey}
              </code>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <CopyBtn id="json" text={jsonExample} />
            <span className="text-sm text-[var(--text-secondary)]">Body (JSON)</span>
          </div>
          <pre
            className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-3 text-xs font-mono text-[var(--text-primary)] overflow-x-auto"
            dir="ltr"
          >{jsonExample}</pre>
        </div>

        <div className="text-xs text-[var(--text-muted)] space-y-1" dir="rtl">
          <p><strong>phone</strong> — מספר טלפון בפורמט +972 (חובה)</p>
          <p><strong>contact_name</strong> — שם איש קשר (אופציונלי)</p>
          <p><strong>gender</strong> — male / female / unknown (אופציונלי)</p>
          <p><strong>context</strong> — JSON חופשי שיועבר לסוכן (אופציונלי)</p>
        </div>

        <details className="group">
          <summary className="text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] transition-colors">
            דוגמת cURL
          </summary>
          <div className="mt-2 relative">
            <div className="absolute top-2 left-2">
              <CopyBtn id="curl" text={curlExample} />
            </div>
            <pre
              className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-3 pr-3 text-xs font-mono text-[var(--text-primary)] overflow-x-auto"
              dir="ltr"
            >{curlExample}</pre>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
