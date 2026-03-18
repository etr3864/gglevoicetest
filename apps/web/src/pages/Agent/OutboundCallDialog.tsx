import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, PhoneOutgoing } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';

interface Props {
  agentId: string;
  onClose: () => void;
}

export default function OutboundCallDialog({ agentId, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [phone, setPhone] = useState('');
  const [contactName, setContactName] = useState('');

  const dial = useMutation({
    mutationFn: () => api.post(`/agents/${agentId}/outbound`, {
      phone,
      contactName: contactName || undefined,
    }),
    onSuccess: () => {
      toast('השיחה בתור - מתחייגת בקרוב', 'success');
      qc.invalidateQueries({ queryKey: ['agent-calls', agentId] });
      onClose();
    },
    onError: (err: any) => {
      toast(err.response?.data?.message || 'שגיאה ביצירת שיחה', 'error');
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-sm animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-[var(--text-primary)]">שיחה יוצאת</h3>
            <PhoneOutgoing className="w-4 h-4 text-[var(--accent)]" />
          </div>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); dial.mutate(); }}
          className="px-5 py-5 space-y-4"
        >
          <Input
            label="מספר טלפון"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            dir="ltr"
            placeholder="+972501234567"
            required
          />
          <Input
            label="שם (אופציונלי)"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="שם איש הקשר"
          />
          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={dial.isPending || !phone.trim()}>
              <PhoneOutgoing className="w-4 h-4" />
              {dial.isPending ? 'מחייג...' : 'התחל שיחה'}
            </Button>
            <Button variant="ghost" type="button" onClick={onClose}>ביטול</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
