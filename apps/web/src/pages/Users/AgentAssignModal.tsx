import { useState, useEffect } from 'react';
import { X, Plus, Minus, Bot, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '../../components/ui/Button';

interface Agent {
  id: string;
  name: string;
  phoneNumber: string | null;
  status: string;
}

interface Props {
  adminId: string;
  adminName: string;
  onClose: () => void;
}

export default function AgentAssignModal({ adminId, adminName, onClose }: Props) {
  const [assigned, setAssigned] = useState<Agent[]>([]);
  const [unassigned, setUnassigned] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function fetchAgents() {
    const [assignedRes, unassignedRes] = await Promise.all([
      api.get(`/auth/admins/${adminId}/agents`),
      api.get('/auth/agents/unassigned'),
    ]);
    setAssigned(assignedRes.data.data);
    setUnassigned(unassignedRes.data.data);
  }

  useEffect(() => {
    setLoading(true);
    fetchAgents().finally(() => setLoading(false));
  }, [adminId]);

  async function assign(agent: Agent) {
    setBusy(agent.id);
    try {
      await api.post(`/auth/admins/${adminId}/agents/${agent.id}`);
      setUnassigned(prev => prev.filter(a => a.id !== agent.id));
      setAssigned(prev => [...prev, agent]);
    } finally {
      setBusy(null);
    }
  }

  async function unassign(agent: Agent) {
    setBusy(agent.id);
    try {
      await api.delete(`/auth/admins/${adminId}/agents/${agent.id}`);
      setAssigned(prev => prev.filter(a => a.id !== agent.id));
      setUnassigned(prev => [...prev, agent]);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div className="text-right">
            <h3 className="font-semibold text-[var(--text-primary)]">שיוך סוכנים</h3>
            <p className="text-xs text-[var(--text-muted)]">{adminName}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-[var(--text-secondary)]">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>טוען...</span>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 divide-y divide-[var(--border)]">
            {/* Assigned agents */}
            <div className="px-5 py-3">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2 text-right">
                משויכים ({assigned.length})
              </p>
              {assigned.length === 0 && (
                <p className="text-sm text-[var(--text-muted)] text-center py-3">אין סוכנים משויכים</p>
              )}
              <div className="space-y-1.5">
                {assigned.map(agent => (
                  <div key={agent.id} className="flex items-center justify-between rounded-lg bg-[var(--accent)]/5 border border-[var(--accent)]/20 px-3 py-2">
                    <button
                      onClick={() => unassign(agent)}
                      disabled={busy === agent.id}
                      className="p-1 rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 transition-colors disabled:opacity-40"
                      title="הסר שיוך"
                    >
                      {busy === agent.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Minus className="w-3.5 h-3.5" />}
                    </button>
                    <div className="flex items-center gap-2 text-right">
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">{agent.name}</p>
                        {agent.phoneNumber && <p className="text-xs text-[var(--text-muted)]" dir="ltr">{agent.phoneNumber}</p>}
                      </div>
                      <div className="w-7 h-7 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center">
                        <Bot className="w-4 h-4 text-[var(--accent)]" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Unassigned agents */}
            <div className="px-5 py-3">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2 text-right">
                זמינים לשיוך ({unassigned.length})
              </p>
              {unassigned.length === 0 && (
                <p className="text-sm text-[var(--text-muted)] text-center py-3">אין סוכנים פנויים</p>
              )}
              <div className="space-y-1.5">
                {unassigned.map(agent => (
                  <div key={agent.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 hover:border-[var(--accent)]/30 transition-colors">
                    <button
                      onClick={() => assign(agent)}
                      disabled={busy === agent.id}
                      className="p-1 rounded hover:bg-[var(--accent)]/10 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors disabled:opacity-40"
                      title="שייך"
                    >
                      {busy === agent.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    </button>
                    <div className="flex items-center gap-2 text-right">
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">{agent.name}</p>
                        {agent.phoneNumber && <p className="text-xs text-[var(--text-muted)]" dir="ltr">{agent.phoneNumber}</p>}
                      </div>
                      <div className="w-7 h-7 rounded-lg bg-[var(--bg-hover)] flex items-center justify-center">
                        <Bot className="w-4 h-4 text-[var(--text-muted)]" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-[var(--border)] shrink-0 flex justify-start">
          <Button variant="secondary" size="sm" onClick={onClose}>סגור</Button>
        </div>
      </div>
    </div>
  );
}
