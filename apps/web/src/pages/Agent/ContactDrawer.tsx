import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Save, Trash2, Phone, Calendar, Clock, MessageSquare, ChevronUp } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { cn } from '../../lib/cn';

interface Props {
  contact: any;
  onClose: () => void;
}

interface WhatsappMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  status: string;
  content: string;
  createdAt: string;
}

const WA_STATUS_LABELS: Record<string, { label: string; variant: 'success' | 'warning' | 'neutral' }> = {
  sent: { label: 'נשלח', variant: 'success' },
  delivered: { label: 'נמסר', variant: 'success' },
  read: { label: 'נקרא', variant: 'success' },
  failed: { label: 'נכשל', variant: 'warning' },
  pending: { label: 'ממתין', variant: 'neutral' },
  inbound: { label: 'נכנסת', variant: 'neutral' },
};

const STATUS_LABELS: Record<string, { label: string; variant: 'success' | 'danger' | 'warning' | 'info' | 'neutral' }> = {
  scheduled: { label: 'מתוכנן', variant: 'info' },
  completed: { label: 'הושלם', variant: 'success' },
  cancelled: { label: 'בוטל', variant: 'danger' },
  no_show: { label: 'לא הגיע', variant: 'warning' },
};

export default function ContactDrawer({ contact, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: '', email: '', gender: '', notes: '' });

  useEffect(() => {
    if (contact) {
      setForm({
        name: contact.name || '',
        email: contact.email || '',
        gender: contact.gender || '',
        notes: contact.notes || '',
      });
    }
  }, [contact]);

  const { data: appointments } = useQuery({
    queryKey: ['contact-appointments', contact.id],
    queryFn: () => api.get(`/contacts/${contact.id}/appointments`).then(r => r.data.data),
    enabled: !!contact.id,
  });

  const [waCursor, setWaCursor] = useState<string | null | undefined>(undefined);
  const [waMessages, setWaMessages] = useState<WhatsappMessage[]>([]);
  const [hasMoreWa, setHasMoreWa] = useState(false);

  const { data: waPage, isFetching: waLoading } = useQuery({
    queryKey: ['contact-whatsapp', contact.id, waCursor],
    queryFn: async () => {
      const params = waCursor ? `?cursor=${waCursor}&limit=30` : '?limit=30';
      const res = await api.get(`/contacts/${contact.id}/whatsapp${params}`);
      return res.data as { data: WhatsappMessage[]; nextCursor: string | null };
    },
    enabled: !!contact.id,
  });

  useEffect(() => {
    if (!waPage) return;
    if (waCursor === undefined) {
      setWaMessages(waPage.data);
    } else {
      setWaMessages(prev => [...waPage.data, ...prev]);
    }
    setHasMoreWa(!!waPage.nextCursor);
  }, [waPage]);

  const update = useMutation({
    mutationFn: () => api.patch(`/contacts/${contact.id}`, {
      name: form.name || null,
      email: form.email || null,
      gender: form.gender || null,
      notes: form.notes || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-contacts'] });
      toast('איש קשר עודכן', 'success');
      onClose();
    },
    onError: () => toast('שגיאה בעדכון', 'error'),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/contacts/${contact.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-contacts'] });
      toast('איש קשר נמחק', 'success');
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-start bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[var(--bg-card)] border-l border-[var(--border)] w-full max-w-md h-full overflow-y-auto animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
            <X className="w-5 h-5" />
          </button>
          <h3 className="font-semibold text-[var(--text-primary)]">איש קשר</h3>
        </div>

        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2 justify-end">
          <span className="font-mono text-sm text-[var(--text-primary)]" dir="ltr">{contact.phone}</span>
          <Phone className="w-4 h-4 text-[var(--text-muted)]" />
        </div>

        <div className="px-5 py-3 border-b border-[var(--border)] grid grid-cols-3 gap-4 text-center text-sm">
          <div>
            <p className="text-lg font-bold text-[var(--text-primary)]">{contact.totalCalls}</p>
            <p className="text-xs text-[var(--text-muted)]">שיחות</p>
          </div>
          <div>
            <p className="text-lg font-bold text-[var(--text-primary)]">
              {Math.round(contact.totalDurationSec / 60)}
            </p>
            <p className="text-xs text-[var(--text-muted)]">דקות</p>
          </div>
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {contact.lastCallAt ? new Date(contact.lastCallAt).toLocaleDateString('he-IL') : '—'}
            </p>
            <p className="text-xs text-[var(--text-muted)]">שיחה אחרונה</p>
          </div>
        </div>

        {/* WhatsApp Section */}
        {waMessages.length > 0 && (
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <div className="flex items-center gap-2 justify-end mb-3">
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">WhatsApp</h4>
              <MessageSquare className="w-4 h-4 text-emerald-400" />
            </div>

            {hasMoreWa && (
              <button
                onClick={() => setWaCursor(waPage?.nextCursor ?? null)}
                disabled={waLoading}
                className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors mb-2 mx-auto"
              >
                <ChevronUp className="w-3 h-3" />
                {waLoading ? 'טוען...' : 'טען עוד'}
              </button>
            )}

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {waMessages.map(msg => {
                const isOut = msg.direction === 'outbound';
                const statusInfo = WA_STATUS_LABELS[msg.status] ?? WA_STATUS_LABELS.pending;
                return (
                  <div key={msg.id} className={cn('flex', isOut ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[80%] px-3 py-2 rounded-xl text-sm',
                      isOut ? 'bg-emerald-600/20 text-[var(--text-primary)]' : 'bg-[var(--bg-hover)] text-[var(--text-primary)]',
                    )}>
                      <p className="break-words">{msg.content}</p>
                      <div className={cn('flex items-center gap-1.5 mt-1', isOut ? 'justify-end' : 'justify-start')}>
                        <span className="text-xs text-[var(--text-muted)]">
                          {new Date(msg.createdAt).toLocaleString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isOut && (
                          <Badge variant={statusInfo.variant} className="text-xs py-0 px-1">
                            {statusInfo.label}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Appointments Section */}
        {appointments && appointments.length > 0 && (
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <div className="flex items-center gap-2 justify-end mb-3">
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">פגישות</h4>
              <Calendar className="w-4 h-4 text-[var(--text-muted)]" />
            </div>
            <div className="space-y-2">
              {appointments.map((apt: any) => {
                const statusInfo = STATUS_LABELS[apt.status] || STATUS_LABELS.scheduled;
                const isPast = new Date(apt.startTime) < new Date();
                return (
                  <div
                    key={apt.id}
                    className={`rounded-lg border border-[var(--border)] p-3 ${isPast ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                      <p className="text-sm font-medium text-[var(--text-primary)] text-right">{apt.title}</p>
                    </div>
                    <div className="flex items-center gap-2 justify-end text-xs text-[var(--text-muted)]">
                      <span>{apt.duration} דק׳</span>
                      <Clock className="w-3 h-3" />
                      <span>
                        {new Date(apt.startTime).toLocaleString('he-IL', {
                          day: 'numeric', month: 'short',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="px-5 py-5 space-y-4">
          <Input label="שם" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="שם איש הקשר" />
          <Input label="אימייל" type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} dir="ltr" placeholder="email@example.com" />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[var(--text-secondary)]">מגדר</label>
            <select
              value={form.gender}
              onChange={(e) => setForm(f => ({ ...f, gender: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
            >
              <option value="">לא הוגדר</option>
              <option value="male">זכר</option>
              <option value="female">נקבה</option>
              <option value="unknown">אחר</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[var(--text-secondary)]">הערות</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={4}
              className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 resize-none transition-colors"
              placeholder="הערות על איש הקשר..."
              dir="rtl"
            />
          </div>
        </div>

        <div className="px-5 pb-5 flex items-center gap-3">
          <Button onClick={() => update.mutate()} disabled={update.isPending}>
            <Save className="w-4 h-4" />
            {update.isPending ? 'שומר...' : 'שמור'}
          </Button>
          <Button variant="danger" onClick={() => { if (confirm('למחוק?')) remove.mutate(); }}>
            <Trash2 className="w-4 h-4" />
            מחק
          </Button>
        </div>
      </div>
    </div>
  );
}
