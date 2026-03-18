import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Copy, Check, Loader2, Save } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';

type Provider = 'meta' | 'wasender' | '';

interface MetaConfig {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}

interface WasenderConfig {
  apiKey: string;
  session: string;
  webhookSecret: string;
}

interface Agent {
  id: string;
  whatsappProvider?: string | null;
  whatsappConfig?: Record<string, string> | null;
  whatsappInstructions?: string | null;
  whatsappContextMessages?: number;
}

interface Props {
  agentId: string;
  agent: Agent;
}

const API_HOST = import.meta.env.VITE_API_URL?.replace('/api', '') ?? window.location.origin;

function webhookUrl(agentId: string, provider: Provider): string {
  if (provider === 'meta') return `${API_HOST}/webhooks/whatsapp/meta/${agentId}`;
  if (provider === 'wasender') return `${API_HOST}/webhooks/whatsapp/wasender/${agentId}`;
  return '';
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      title="העתק"
    >
      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

export default function WhatsappTab({ agentId, agent }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [provider, setProvider] = useState<Provider>((agent.whatsappProvider as Provider) || '');
  const [meta, setMeta] = useState<MetaConfig>({
    phoneNumberId: '',
    accessToken: '',
    appSecret: '',
    verifyToken: '',
  });
  const [wasender, setWasender] = useState<WasenderConfig>({
    apiKey: '',
    session: '',
    webhookSecret: '',
  });
  const [instructions, setInstructions] = useState(agent.whatsappInstructions ?? '');
  const [contextMessages, setContextMessages] = useState(agent.whatsappContextMessages ?? 20);

  useEffect(() => {
    const cfg = agent.whatsappConfig as Record<string, string> | null | undefined;
    if (!cfg) return;
    if (agent.whatsappProvider === 'meta') {
      setMeta({
        phoneNumberId: cfg.phoneNumberId ?? '',
        accessToken: cfg.accessToken ?? '',
        appSecret: cfg.appSecret ?? '',
        verifyToken: cfg.verifyToken ?? '',
      });
    } else if (agent.whatsappProvider === 'wasender') {
      setWasender({
        apiKey: cfg.apiKey ?? '',
        session: cfg.session ?? '',
        webhookSecret: cfg.webhookSecret ?? '',
      });
    }
  }, [agent.whatsappConfig, agent.whatsappProvider]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const whatsappConfig = provider === 'meta' ? meta : provider === 'wasender' ? wasender : null;
      await api.patch(`/agents/${agentId}`, {
        whatsappProvider: provider || null,
        whatsappConfig,
        whatsappInstructions: instructions || null,
        whatsappContextMessages: contextMessages,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', agentId] });
      toast('הגדרות וואטסאפ נשמרו', 'success');
    },
    onError: () => toast('שגיאה בשמירת הגדרות וואטסאפ', 'error'),
  });

  const url = webhookUrl(agentId, provider);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
          <MessageSquare className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">WhatsApp</p>
          <p className="text-xs text-[var(--text-secondary)]">הגדרת ספק וחיבור לוואטסאפ</p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--text-primary)]">ספק</label>
        <select
          value={provider}
          onChange={e => setProvider(e.target.value as Provider)}
          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        >
          <option value="">ללא</option>
          <option value="meta">Meta Cloud API (רשמי)</option>
          <option value="wasender">WA Sender (לא רשמי)</option>
        </select>
      </div>

      {provider === 'meta' && (
        <div className="space-y-3 p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
          <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Meta Cloud API</p>
          <Input
            label="Phone Number ID"
            value={meta.phoneNumberId}
            onChange={e => setMeta(p => ({ ...p, phoneNumberId: e.target.value }))}
            placeholder="123456789012345"
            dir="ltr"
          />
          <Input
            label="Access Token"
            value={meta.accessToken}
            onChange={e => setMeta(p => ({ ...p, accessToken: e.target.value }))}
            placeholder="EAAxxxxxxx..."
            dir="ltr"
          />
          <Input
            label="App Secret"
            value={meta.appSecret}
            onChange={e => setMeta(p => ({ ...p, appSecret: e.target.value }))}
            placeholder="App Secret מה-Meta Developer Portal"
            dir="ltr"
          />
          <Input
            label="Verify Token"
            value={meta.verifyToken}
            onChange={e => setMeta(p => ({ ...p, verifyToken: e.target.value }))}
            placeholder="מחרוזת אקראית שאתה בוחר"
            dir="ltr"
          />
        </div>
      )}

      {provider === 'wasender' && (
        <div className="space-y-3 p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
          <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">WA Sender</p>
          <Input
            label="API Key"
            value={wasender.apiKey}
            onChange={e => setWasender(p => ({ ...p, apiKey: e.target.value }))}
            placeholder="מפתח API"
            dir="ltr"
          />
          <Input
            label="Session"
            value={wasender.session}
            onChange={e => setWasender(p => ({ ...p, session: e.target.value }))}
            placeholder="שם הסשן"
            dir="ltr"
          />
          <Input
            label="Webhook Secret"
            value={wasender.webhookSecret}
            onChange={e => setWasender(p => ({ ...p, webhookSecret: e.target.value }))}
            placeholder="Webhook Secret"
            dir="ltr"
          />
        </div>
      )}

      {url && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[var(--text-primary)]">Webhook URL</label>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
            <span className="flex-1 text-xs text-[var(--text-secondary)] font-mono break-all">{url}</span>
            <CopyButton text={url} />
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            {provider === 'meta'
              ? 'הדבק את ה-URL הזה ב-Meta Developer Portal תחת Webhooks'
              : 'הגדר URL זה כ-Webhook ב-WA Sender'}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--text-primary)]">הנחיות לשימוש בוואטסאפ</label>
        <textarea
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          placeholder="למשל: שלח הודעת וואטסאפ עם קישור תשלום בסוף כל שיחה שנסגרה בהצלחה"
          rows={4}
          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder:text-[var(--text-tertiary)]"
        />
        <p className="text-xs text-[var(--text-secondary)]">הנחיות דינאמיות לסוכן — מתי ואיך להשתמש ביכולת שליחת ווצאפ</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--text-primary)]">הודעות היסטוריה להקשר</label>
        <input
          type="number"
          min={0}
          max={100}
          value={contextMessages}
          onChange={e => setContextMessages(Number(e.target.value))}
          className="w-24 px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        />
        <p className="text-xs text-[var(--text-secondary)]">כמה הודעות וואטסאפ אחרונות לכלול בקונטקסט של שיחה חדשה (0–100)</p>
      </div>

      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
        {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        שמור
      </Button>
    </div>
  );
}
