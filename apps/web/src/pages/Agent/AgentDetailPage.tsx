import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight, Loader2, Bot,
  Terminal, Phone, Users, CalendarDays, Bell,
  ScrollText, BookOpen, MessageCircle, Settings2,
} from 'lucide-react';
import { useState, useEffect, useRef, useMemo } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { useAgentEvents } from '../../hooks/useAgentEvents';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { cn } from '../../lib/cn';
import CallDetailModal from './CallDetailModal';
import ContactDrawer from './ContactDrawer';
import OutboundCallDialog from './OutboundCallDialog';
import PromptTab from './PromptTab';
import CallsTab from './CallsTab';
import ContactsTab from './ContactsTab';
import CalendarTab from './CalendarTab';
import RemindersTab from './RemindersTab';
import SummariesTab from './SummariesTab';
import KnowledgeTab from './KnowledgeTab';
import WhatsappTab from './WhatsappTab';
import SettingsTab from './SettingsTab';
import type { UserRole } from '@voice/shared';

type Tab = 'prompt' | 'calls' | 'contacts' | 'calendar' | 'reminders' | 'summaries' | 'knowledge' | 'whatsapp' | 'settings';

const allTabs: { key: Tab; label: string; icon: typeof Terminal; roles: UserRole[] }[] = [
  { key: 'prompt',    label: 'System Prompt', icon: Terminal,       roles: ['super_admin'] },
  { key: 'calls',     label: 'שיחות',         icon: Phone,          roles: ['super_admin', 'admin', 'employee'] },
  { key: 'contacts',  label: 'אנשי קשר',      icon: Users,          roles: ['super_admin', 'admin'] },
  { key: 'calendar',  label: 'יומן',           icon: CalendarDays,   roles: ['super_admin'] },
  { key: 'reminders', label: 'תזכורות',        icon: Bell,           roles: ['super_admin'] },
  { key: 'summaries', label: 'סיכומים',        icon: ScrollText,     roles: ['super_admin'] },
  { key: 'knowledge', label: 'ידע',            icon: BookOpen,       roles: ['super_admin'] },
  { key: 'whatsapp',  label: 'וואטסאפ',        icon: MessageCircle,  roles: ['super_admin'] },
  { key: 'settings',  label: 'הגדרות',         icon: Settings2,      roles: ['super_admin'] },
];

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const { hasRole, isSuperAdmin, isEmployee } = useAuth();

  const tabs = useMemo(() => allTabs.filter(t => hasRole(...t.roles)), [hasRole]);
  const defaultTab = tabs[0]?.key ?? 'calls';
  const urlTab = searchParams.get('tab') as Tab | null;
  const tab: Tab = urlTab && tabs.some(t => t.key === urlTab) ? urlTab : defaultTab;

  function setTab(next: Tab) {
    setSearchParams(next === defaultTab ? {} : { tab: next }, { replace: true });
  }

  // ─── Queries ───

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

  const { data: voicesData } = useQuery({
    queryKey: ['voices'],
    queryFn: () => api.get('/voices').then(r => r.data.data),
    staleTime: Infinity,
  });

  // ─── Local state ───

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

  // ─── Mutations ───

  const updatePrompt = useMutation({
    mutationFn: () => api.patch(`/agents/${id}`, {
      basePrompt: prompt,
      openingMessage: openingMessage || null,
      inboundSystemPrompt: inboundPrompt || null,
      inboundOpeningMessage: inboundOpeningMessage || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', id] });
    },
  });

  const updateSettings = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/agents/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', id] });
      qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/agents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      navigate('/');
    },
  });

  // ─── Loading / Not found ───

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

  // ─── Render ───

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {!isEmployee && (
            <Toggle
              checked={agent.status === 'active'}
              onChange={(checked) =>
                updateSettings.mutate({ status: checked ? 'active' : 'inactive' })
              }
            />
          )}
          <Badge variant={agent.status === 'active' ? 'success' : 'danger'}>
            {agent.status === 'active' ? 'פעיל' : 'מושבת'}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-[var(--text-primary)]">{agent.name}</h2>
          <div className="w-9 h-9 rounded-lg bg-[var(--accent)]/20 flex items-center justify-center">
            <Bot className="w-5 h-5 text-[var(--accent)]" />
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
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'prompt' && (
        <PromptTab
          prompt={prompt}
          setPrompt={setPrompt}
          openingMessage={openingMessage}
          setOpeningMessage={setOpeningMessage}
          inboundPrompt={inboundPrompt}
          setInboundPrompt={setInboundPrompt}
          inboundOpeningMessage={inboundOpeningMessage}
          setInboundOpeningMessage={setInboundOpeningMessage}
          onSave={() => updatePrompt.mutate()}
          isSaving={updatePrompt.isPending}
        />
      )}

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

      {tab === 'contacts' && (
        <ContactsTab
          contactsData={contactsData}
          onSelectContact={setSelectedContact}
        />
      )}

      {tab === 'calendar' && id && (
        <CalendarTab agentId={id} agent={agent} />
      )}

      {tab === 'reminders' && id && (
        <RemindersTab agentId={id} agent={agent} />
      )}

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

      {tab === 'knowledge' && id && (
        <KnowledgeTab agentId={id} />
      )}

      {tab === 'whatsapp' && id && agent && (
        <WhatsappTab agentId={id} agent={agent} />
      )}

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

      {/* Modals */}
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
