import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight, Save, Trash2, Settings, Phone, MessageSquare,
  FileText, Users, PhoneCall, PhoneOutgoing, Loader2, Calendar,
  Copy, Check, RefreshCw, Eye, EyeOff,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { useToast } from '../../components/ui/Toast';
import { cn } from '../../lib/cn';
import CallDetailModal from './CallDetailModal';
import ContactDrawer from './ContactDrawer';
import OutboundCallDialog from './OutboundCallDialog';
import CalendarTab from './CalendarTab';

type Tab = 'prompt' | 'calls' | 'contacts' | 'calendar' | 'settings';

const tabs: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: 'prompt', label: 'System Prompt', icon: FileText },
  { key: 'calls', label: 'שיחות', icon: Phone },
  { key: 'contacts', label: 'אנשי קשר', icon: Users },
  { key: 'calendar', label: 'יומן', icon: Calendar },
  { key: 'settings', label: 'הגדרות', icon: Settings },
];

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();

  const urlTab = searchParams.get('tab') as Tab | null;
  const tab: Tab = urlTab && tabs.some(t => t.key === urlTab) ? urlTab : 'prompt';

  function setTab(next: Tab) {
    setSearchParams(next === 'prompt' ? {} : { tab: next }, { replace: true });
  }

  const { data: agent, isLoading } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api.get(`/agents/${id}`).then(r => r.data.data),
    enabled: !!id,
  });

  const { data: callsData } = useQuery({
    queryKey: ['agent-calls', id],
    queryFn: () => api.get(`/agents/${id}/calls?limit=50`).then(r => r.data),
    enabled: !!id && tab === 'calls',
  });

  const { data: contactsData } = useQuery({
    queryKey: ['agent-contacts', id],
    queryFn: () => api.get(`/agents/${id}/contacts`).then(r => r.data),
    enabled: !!id && tab === 'contacts',
  });

  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [showOutbound, setShowOutbound] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [form, setForm] = useState({
    name: '',
    voice: 'Aoede',
    phoneNumber: '',
    telnyxPhoneId: '',
    telnyxAppId: '',
  });

  const { data: voicesData } = useQuery({
    queryKey: ['voices'],
    queryFn: () => api.get('/voices').then(r => r.data.data),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (agent) {
      setPrompt(agent.basePrompt || '');
      setForm({
        name: agent.name,
        voice: agent.voice || 'Aoede',
        phoneNumber: agent.phoneNumber || '',
        telnyxPhoneId: agent.telnyxPhoneId || '',
        telnyxAppId: agent.telnyxAppId || '',
      });
    }
  }, [agent]);

  const updatePrompt = useMutation({
    mutationFn: () => api.patch(`/agents/${id}`, { basePrompt: prompt }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', id] });
      toast('פרומפט נשמר', 'success');
    },
    onError: () => toast('שגיאה בשמירת פרומפט', 'error'),
  });

  const updateSettings = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/agents/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', id] });
      qc.invalidateQueries({ queryKey: ['agents'] });
      toast('הגדרות נשמרו', 'success');
    },
    onError: () => toast('שגיאה בשמירת הגדרות', 'error'),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/agents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      navigate('/');
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-[var(--text-secondary)]">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>טוען סוכן...</span>
      </div>
    );
  }

  if (!agent) {
    return <div className="text-center py-12 text-[var(--text-secondary)]">סוכן לא נמצא</div>;
  }

  const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length;
  const charCount = prompt.length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Toggle
            checked={agent.status === 'active'}
            onChange={(checked) =>
              updateSettings.mutate({ status: checked ? 'active' : 'inactive' })
            }
          />
          <Badge variant={agent.status === 'active' ? 'success' : 'danger'}>
            {agent.status === 'active' ? 'פעיל' : 'מושבת'}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-[var(--text-primary)]">{agent.name}</h2>
          <div className="w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <FileText className="w-5 h-5 text-emerald-400" />
          </div>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            חזרה
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px',
              tab === key
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ===== System Prompt ===== */}
      {tab === 'prompt' && (
        <Card>
          <div className="p-1">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <span className="text-xs text-[var(--text-muted)]">
                {charCount} תווים &bull; {wordCount} מילים
              </span>
              <h3 className="font-semibold text-[var(--text-primary)]">System Prompt</h3>
            </div>
            <div className="px-3 pb-3">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={14}
                className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none leading-relaxed transition-colors"
                placeholder="כתוב כאן את ההנחיות לסוכן..."
                dir="rtl"
              />
            </div>
            <div className="px-5 pb-4 flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">
                הפרומפט הזה יתווסף לכל שיחה
              </span>
              <Button onClick={() => updatePrompt.mutate()} disabled={updatePrompt.isPending}>
                <Save className="w-4 h-4" />
                {updatePrompt.isPending ? 'שומר...' : 'שמור'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ===== Calls ===== */}
      {tab === 'calls' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--text-muted)]">
              {callsData?.meta?.total ?? 0} שיחות
            </span>
            <Button size="sm" onClick={() => setShowOutbound(true)}>
              <PhoneOutgoing className="w-3.5 h-3.5" />
              שיחה יוצאת
            </Button>
          </div>
          <Card>
            <div className="divide-y divide-[var(--border)]">
              {!callsData?.data?.length && (
                <div className="px-6 py-12 text-center">
                  <MessageSquare className="w-10 h-10 mx-auto mb-3 text-[var(--text-muted)]" />
                  <p className="text-[var(--text-secondary)]">אין שיחות עדיין</p>
                </div>
              )}
              {callsData?.data?.map((call: any) => (
                <div
                  key={call.id}
                  className="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
                  onClick={() => setSelectedCallId(call.id)}
                >
                  <div className="flex items-center gap-3">
                    <Badge variant={
                      call.status === 'completed' ? 'success' :
                      call.status === 'failed' ? 'danger' :
                      call.status === 'in_call' ? 'warning' : 'info'
                    }>
                      {call.status}
                    </Badge>
                    {call.durationSec != null && (
                      <span className="text-xs text-[var(--text-muted)]">{formatDuration(call.durationSec)}</span>
                    )}
                    <Badge variant="neutral">{call.direction === 'inbound' ? 'נכנסת' : 'יוצאת'}</Badge>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {call.contact?.name || call.contact?.phone || 'לא ידוע'}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {new Date(call.createdAt).toLocaleString('he-IL')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            {callsData?.meta && callsData.meta.total > callsData.data.length && (
              <div className="px-5 py-3 border-t border-[var(--border)] text-center">
                <span className="text-xs text-[var(--text-muted)]">
                  מציג {callsData.data.length} מתוך {callsData.meta.total}
                </span>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ===== Contacts ===== */}
      {tab === 'contacts' && (
        <Card>
          <div className="divide-y divide-[var(--border)]">
            {!contactsData?.data?.length && (
              <div className="px-6 py-12 text-center">
                <Users className="w-10 h-10 mx-auto mb-3 text-[var(--text-muted)]" />
                <p className="text-[var(--text-secondary)]">אין אנשי קשר עדיין</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">אנשי קשר נוצרים אוטומטית כשמתקבלות שיחות</p>
              </div>
            )}
            {contactsData?.data?.map((contact: any) => (
              <div
                key={contact.id}
                className="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
                onClick={() => setSelectedContact(contact)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--text-muted)]">
                    {contact.totalCalls} שיחות
                  </span>
                  {contact.totalDurationSec > 0 && (
                    <span className="text-xs text-[var(--text-muted)]">
                      {formatDuration(contact.totalDurationSec)}
                    </span>
                  )}
                  {contact.lastCallAt && (
                    <span className="text-xs text-[var(--text-muted)]">
                      אחרון: {new Date(contact.lastCallAt).toLocaleDateString('he-IL')}
                    </span>
                  )}
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {contact.name || 'ללא שם'}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]" dir="ltr">{contact.phone}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ===== Calendar ===== */}
      {tab === 'calendar' && id && (
        <CalendarTab agentId={id} agent={agent} />
      )}

      {/* ===== Settings ===== */}
      {tab === 'settings' && (
        <SettingsTab
          agent={agent}
          form={form}
          setForm={setForm}
          voices={voicesData || []}
          onSave={(data) => updateSettings.mutate(data)}
          onDelete={() => remove.mutate()}
          isSaving={updateSettings.isPending}
        />
      )}

      {selectedCallId && (
        <CallDetailModal callId={selectedCallId} onClose={() => setSelectedCallId(null)} />
      )}
      {selectedContact && (
        <ContactDrawer contact={selectedContact} onClose={() => setSelectedContact(null)} />
      )}
      {showOutbound && id && (
        <OutboundCallDialog agentId={id} onClose={() => setShowOutbound(false)} />
      )}
    </div>
  );
}

function SettingsTab({ agent, form, setForm, voices, onSave, onDelete, isSaving }: {
  agent: any;
  form: any;
  setForm: (fn: (f: any) => any) => void;
  voices: { id: string; label: string; gender: string; description: string }[];
  onSave: (data: Record<string, unknown>) => void;
  onDelete: () => void;
  isSaving: boolean;
}) {
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
  const apiBase = window.location.origin;

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
        ? <Check className="w-3.5 h-3.5 text-emerald-400" />
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

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${m} דק'`;
}
