import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight, Save, Trash2, Settings, Phone, MessageSquare,
  FileText, Users, PhoneCall, PhoneOutgoing, PhoneIncoming, PhoneMissed, Loader2, Calendar,
  Copy, Check, RefreshCw, Eye, EyeOff, Activity, Play, Pause,
  Download, Search, X as XIcon, BookOpen
} from 'lucide-react';
import { useState, useEffect, useRef, useCallback, type RefObject, type MouseEvent as ReactMouseEvent } from 'react';
import api from '../../lib/api';
import { useAgentEvents } from '../../hooks/useAgentEvents';
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
import RemindersTab from './RemindersTab';
import KnowledgeTab from './KnowledgeTab';

type Tab = 'prompt' | 'calls' | 'contacts' | 'calendar' | 'reminders' | 'summaries' | 'knowledge' | 'settings';

const tabs: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: 'prompt', label: 'System Prompt', icon: FileText },
  { key: 'calls', label: 'שיחות', icon: Phone },
  { key: 'contacts', label: 'אנשי קשר', icon: Users },
  { key: 'calendar', label: 'יומן', icon: Calendar },
  { key: 'reminders', label: 'תזכורות', icon: PhoneOutgoing },
  { key: 'summaries', label: 'סיכומים', icon: MessageSquare },
  { key: 'knowledge', label: 'ידע', icon: BookOpen },
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
    queryFn: () => api.get(`/agents/${id}/calls?limit=100`).then(r => r.data),
    enabled: !!id && tab === 'calls',
  });

  useAgentEvents(id, tab === 'calls');

  const { data: contactsData } = useQuery({
    queryKey: ['agent-contacts', id],
    queryFn: () => api.get(`/agents/${id}/contacts`).then(r => r.data),
    enabled: !!id && tab === 'contacts',
  });

  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [showOutbound, setShowOutbound] = useState(false);
  const [callSearch, setCallSearch] = useState('');
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [prompt, setPrompt] = useState('');
  const [openingMessage, setOpeningMessage] = useState('');
  const [inboundPrompt, setInboundPrompt] = useState('');
  const [inboundOpeningMessage, setInboundOpeningMessage] = useState('');
  const [summaryForm, setSummaryForm] = useState({
    summaryEnabled: false,
    summaryMinDuration: 30,
    summaryPrompt: '',
    webhookUrl: '',
    webhookSecret: '',
    webhookRetryCount: 3,
    webhookRetryDelay: 60,
    appointmentWebhookUrl: '',
    appointmentWebhookSecret: '',
  });
  const [webhookTestResult, setWebhookTestResult] = useState<{ success: boolean; statusCode: number | null; latencyMs: number } | null>(null);
  const [form, setForm] = useState({
    name: '',
    voice: 'Aoede',
    phoneNumber: '',
    telnyxPhoneId: '',
    telnyxAppId: '',
    temperature: 0.7,
  });

  const { data: voicesData } = useQuery({
    queryKey: ['voices'],
    queryFn: () => api.get('/voices').then(r => r.data.data),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (agent) {
      setPrompt(agent.basePrompt || '');
      setOpeningMessage(agent.openingMessage || '');
      setInboundPrompt(agent.inboundSystemPrompt || '');
      setInboundOpeningMessage(agent.inboundOpeningMessage || '');
      setSummaryForm({
        summaryEnabled: agent.summaryEnabled ?? false,
        summaryMinDuration: agent.summaryMinDuration ?? 30,
        summaryPrompt: agent.summaryPrompt || '',
        webhookUrl: agent.webhookUrl || '',
        webhookSecret: agent.webhookSecret || '',
        webhookRetryCount: agent.webhookRetryCount ?? 3,
        webhookRetryDelay: agent.webhookRetryDelay ?? 60,
        appointmentWebhookUrl: agent.appointmentWebhookUrl || '',
        appointmentWebhookSecret: agent.appointmentWebhookSecret || '',
      });
      setForm({
        name: agent.name,
        voice: agent.voice || 'Aoede',
        phoneNumber: agent.phoneNumber || '',
        telnyxPhoneId: agent.telnyxPhoneId || '',
        telnyxAppId: agent.telnyxAppId || '',
        temperature: agent.modelConfig?.generation?.temperature ?? 0.7,
      });
    }
  }, [agent]);

  const updatePrompt = useMutation({
    mutationFn: () => api.patch(`/agents/${id}`, {
      basePrompt: prompt,
      openingMessage: openingMessage || null,
      inboundSystemPrompt: inboundPrompt || null,
      inboundOpeningMessage: inboundOpeningMessage || null,
    }),
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
        <div className="space-y-4">
          {/* Two-column layout: outbound | inbound */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Outbound */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 px-1">
                <PhoneOutgoing className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">שיחות יוצאות</span>
              </div>
              <Card>
                <div className="p-1">
                  <div className="flex items-center justify-between px-5 pt-4 pb-2">
                    <span className={`text-xs ${charCount > 7000 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>{charCount} / 8000 תווים &bull; {wordCount} מילים</span>
                    <h3 className="font-semibold text-[var(--text-primary)] text-sm">System Prompt</h3>
                  </div>
                  <div className="px-3 pb-3">
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      maxLength={8000}
                      rows={12}
                      className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none leading-relaxed transition-colors"
                      placeholder="כתוב כאן את ההנחיות לסוכן לשיחות יוצאות..."
                      dir="rtl"
                    />
                  </div>
                </div>
              </Card>
              <Card>
                <div className="p-1">
                  <div className="flex items-center justify-between px-5 pt-4 pb-1">
                    <span className="text-xs text-[var(--text-muted)]">{openingMessage.length} / 2000</span>
                    <h3 className="font-semibold text-[var(--text-primary)] text-sm">הודעת פתיחה</h3>
                  </div>
                  <div className="px-3 pb-3">
                    <textarea
                      value={openingMessage}
                      onChange={(e) => setOpeningMessage(e.target.value)}
                      maxLength={2000}
                      rows={3}
                      className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none leading-relaxed transition-colors"
                      placeholder='לדוגמה: "Introduce yourself and explain why you are calling."'
                      dir="ltr"
                    />
                  </div>
                </div>
              </Card>
            </div>

            {/* Inbound */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 px-1">
                <PhoneIncoming className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">שיחות נכנסות</span>
                <span className="text-xs text-[var(--text-muted)]">(ריק = fallback ליוצאות)</span>
              </div>
              <Card>
                <div className="p-1">
                  <div className="flex items-center justify-between px-5 pt-4 pb-2">
                    <span className={`text-xs ${inboundPrompt.length > 7000 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>{inboundPrompt.length} / 8000 תווים</span>
                    <h3 className="font-semibold text-[var(--text-primary)] text-sm">System Prompt</h3>
                  </div>
                  <div className="px-3 pb-3">
                    <textarea
                      value={inboundPrompt}
                      onChange={(e) => setInboundPrompt(e.target.value)}
                      maxLength={8000}
                      rows={12}
                      className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none leading-relaxed transition-colors"
                      placeholder="אם ריק, ישתמש ב-System Prompt של שיחות יוצאות..."
                      dir="rtl"
                    />
                  </div>
                </div>
              </Card>
              <Card>
                <div className="p-1">
                  <div className="flex items-center justify-between px-5 pt-4 pb-1">
                    <span className="text-xs text-[var(--text-muted)]">{inboundOpeningMessage.length} / 2000</span>
                    <h3 className="font-semibold text-[var(--text-primary)] text-sm">הודעת פתיחה</h3>
                  </div>
                  <div className="px-3 pb-3">
                    <textarea
                      value={inboundOpeningMessage}
                      onChange={(e) => setInboundOpeningMessage(e.target.value)}
                      maxLength={2000}
                      rows={3}
                      className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none leading-relaxed transition-colors"
                      placeholder='אם ריק, ישתמש בהודעת הפתיחה של שיחות יוצאות...'
                      dir="ltr"
                    />
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => updatePrompt.mutate()} disabled={updatePrompt.isPending}>
              <Save className="w-4 h-4" />
              {updatePrompt.isPending ? 'שומר...' : 'שמור'}
            </Button>
          </div>
        </div>
      )}

      {/* ===== Calls ===== */}
      {tab === 'calls' && id && (
        <CallsTab
          agentId={id}
          callsData={callsData}
          callSearch={callSearch}
          setCallSearch={setCallSearch}
          playingCallId={playingCallId}
          setPlayingCallId={setPlayingCallId}
          audioRef={audioRef}
          onShowOutbound={() => setShowOutbound(true)}
          onSelectCall={setSelectedCallId}
        />
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

      {/* ===== Reminders ===== */}
      {tab === 'reminders' && id && (
        <RemindersTab agentId={id} agent={agent} />
      )}

      {/* ===== Summaries ===== */}
      {tab === 'summaries' && id && (
        <SummariesTab
          agentId={id}
          form={summaryForm}
          setForm={setSummaryForm}
          webhookTestResult={webhookTestResult}
          setWebhookTestResult={setWebhookTestResult}
          onSave={(data) => updateSettings.mutate(data)}
          isSaving={updateSettings.isPending}
        />
      )}

      {/* ===== Knowledge ===== */}
      {tab === 'knowledge' && id && (
        <KnowledgeTab agentId={id} />
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

type DirectionFilter = 'all' | 'inbound' | 'outbound' | 'no_answer';

const DIRECTION_FILTERS: { key: DirectionFilter; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'outbound', label: 'יוצאות' },
  { key: 'inbound', label: 'נכנסות' },
  { key: 'no_answer', label: '📵 לא נענו' },
];

function CallsTab({
  agentId, callsData, callSearch, setCallSearch,
  playingCallId, setPlayingCallId, audioRef,
  onShowOutbound, onSelectCall,
}: {
  agentId: string;
  callsData: any;
  callSearch: string;
  setCallSearch: (v: string) => void;
  playingCallId: string | null;
  setPlayingCallId: (id: string | null) => void;
  audioRef: RefObject<HTMLAudioElement | null>;
  onShowOutbound: () => void;
  onSelectCall: (id: string) => void;
}) {
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const searchLower = callSearch.toLowerCase();
  const filtered = (callsData?.data ?? []).filter((c: any) => {
    if (directionFilter === 'no_answer') {
      if (!(c.direction === 'outbound' && c.status === 'no_answer')) return false;
    } else if (directionFilter !== 'all' && c.direction !== directionFilter) return false;
    if (!callSearch || callSearch.length < 3) return true;
    return (
      c.contact?.phone?.includes(callSearch) ||
      c.contact?.name?.toLowerCase().includes(searchLower)
    );
  });

  const playRecording = useCallback(async (e: ReactMouseEvent, call: any) => {
    e.stopPropagation();
    if (playingCallId === call.id) {
      audioRef.current?.pause();
      setPlayingCallId(null);
      return;
    }
    try {
      const res = await api.get(`/agents/${agentId}/calls/${call.id}/recording`);
      const url = res.data.data.url;
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlayingCallId(null);
      audio.onerror = async () => {
        // Signed URL might have expired — refetch
        try {
          const retry = await api.get(`/agents/${agentId}/calls/${call.id}/recording`);
          audio.src = retry.data.data.url;
          audio.play();
        } catch {
          setPlayingCallId(null);
        }
      };
      await audio.play();
      setPlayingCallId(call.id);
    } catch {
      setPlayingCallId(null);
    }
  }, [agentId, playingCallId, audioRef, setPlayingCallId]);

  const downloadRecording = useCallback(async (e: ReactMouseEvent, call: any) => {
    e.stopPropagation();
    try {
      const res = await api.get(`/agents/${agentId}/calls/${call.id}/recording/download`);
      const a = document.createElement('a');
      a.href = res.data.data.url;
      a.download = `call-${call.id}.mp3`;
      a.click();
    } catch {}
  }, [agentId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={callSearch}
            onChange={e => setCallSearch(e.target.value)}
            placeholder="חיפוש לפי מספר / שם..."
            dir="rtl"
            className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] pr-9 pl-9 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
          />
          {callSearch && (
            <button onClick={() => setCallSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Direction segmented filter */}
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden shrink-0">
          {DIRECTION_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setDirectionFilter(key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                directionFilter === key
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="text-sm text-[var(--text-muted)] shrink-0">
          {filtered.length} שיחות
        </span>
        <Button size="sm" onClick={onShowOutbound}>
          <PhoneOutgoing className="w-3.5 h-3.5" />
          שיחה יוצאת
        </Button>
      </div>

      <Card>
        <div className="divide-y divide-[var(--border)]">
          {!filtered.length && (
            <div className="px-6 py-12 text-center">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 text-[var(--text-muted)]" />
              <p className="text-[var(--text-secondary)]">{callSearch.length >= 3 ? 'לא נמצאו תוצאות' : 'אין שיחות עדיין'}</p>
            </div>
          )}
          {filtered.map((call: any) => (
            <div
              key={call.id}
              className="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
              onClick={() => onSelectCall(call.id)}
            >
              <div className="flex items-center gap-3">
                <Badge variant={
                  call.status === 'completed' ? 'success' :
                  call.status === 'failed' ? 'danger' :
                  call.status === 'no_answer' ? 'neutral' :
                  call.status === 'in_call' ? 'warning' :
                  call.status === 'ringing' ? 'warning' : 'info'
                }>
                  {call.status === 'in_call' && <Activity className="w-3 h-3 inline mr-1 animate-pulse" />}
                  {call.status === 'ringing' && <Activity className="w-3 h-3 inline mr-1 animate-pulse" />}
                  {call.status === 'calling' ? 'מחייג...' :
                   call.status === 'ringing' ? 'מצלצל...' :
                   call.status === 'in_call' ? 'בשיחה' :
                   call.status === 'completed' ? 'הושלמה' :
                   call.status === 'failed' ? 'נכשלה' :
                   call.status === 'no_answer' ? 'לא נענתה' :
                   call.status === 'queued' ? 'ממתין' : call.status}
                </Badge>
                <span title={
                  call.status === 'no_answer' ? 'יוצאת — לא נענתה' :
                  call.direction === 'inbound' ? 'שיחה נכנסת' : 'שיחה יוצאת'
                }>
                  {call.status === 'no_answer'
                    ? <PhoneMissed className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    : call.direction === 'inbound'
                      ? <PhoneIncoming className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      : <PhoneOutgoing className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                </span>
                {call.retryCount > 0 && <Badge variant="warning">חויג שנית</Badge>}
                {call.durationSec != null && (
                  <span className="text-xs text-[var(--text-muted)]">{formatDuration(call.durationSec)}</span>
                )}
                {call.status === 'completed' && (
                  <span className="text-xs text-[var(--text-muted)]">
                    {call.transcriptSaved ? 'תמלול זמין' : 'מעבד...'}
                  </span>
                )}
                {call.recordingStatus === 'processing' && (
                  <Loader2 className="w-3.5 h-3.5 text-[var(--text-muted)] animate-spin" />
                )}
                {call.recordingStatus === 'ready' && (
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={e => playRecording(e, call)}
                      className="p-1 rounded hover:bg-[var(--bg-hover)] text-emerald-400 hover:text-emerald-300 transition-colors"
                      title={playingCallId === call.id ? 'עצור' : 'נגן הקלטה'}
                    >
                      {playingCallId === call.id
                        ? <Pause className="w-3.5 h-3.5" />
                        : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={e => downloadRecording(e, call)}
                      className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                      title="הורד MP3"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
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
        {callsData?.meta && callsData.meta.total > (callsData.data?.length ?? 0) && (
          <div className="px-5 py-3 border-t border-[var(--border)] text-center">
            <span className="text-xs text-[var(--text-muted)]">
              מציג {callsData.data.length} מתוך {callsData.meta.total}
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}

const TEMPERATURE_LABELS: Record<number, string> = {
  0.0: 'דטרמיניסטי', 0.3: 'שמרני', 0.5: 'מקצועי', 0.7: 'מאוזן',
  1.0: 'יצירתי', 1.4: 'ספונטני', 2.0: 'כאוטי',
};

function temperatureLabel(val: number): string {
  const keys = Object.keys(TEMPERATURE_LABELS).map(Number).sort((a, b) => a - b);
  const closest = keys.reduce((prev, k) => Math.abs(k - val) < Math.abs(prev - val) ? k : prev, keys[0]);
  return Math.abs(closest - val) <= 0.15 ? TEMPERATURE_LABELS[closest] : '';
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
              className="w-full accent-emerald-500"
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

function SummariesTab({ agentId, form, setForm, webhookTestResult, setWebhookTestResult, onSave, isSaving }: {
  agentId: string;
  form: any;
  setForm: (fn: (f: any) => any) => void;
  webhookTestResult: any;
  setWebhookTestResult: (r: any) => void;
  onSave: (data: Record<string, unknown>) => void;
  isSaving: boolean;
}) {
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [testingApptWebhook, setTestingApptWebhook] = useState(false);
  const [apptWebhookTestResult, setApptWebhookTestResult] = useState<{ success: boolean; statusCode: number | null; latencyMs: number } | null>(null);
  const { toast } = useToast();

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
                <span className={`text-xs ${webhookTestResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
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

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${m} דק'`;
}
