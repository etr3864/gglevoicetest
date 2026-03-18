import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Bot, Settings, ArrowLeft, Phone, Loader2, Search } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Toggle } from '../../components/ui/Toggle';
import { useToast } from '../../components/ui/Toast';

export default function AgentListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isSuperAdmin, isEmployee } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');

  const { data: agents, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents').then(r => r.data.data),
  });

  const filtered = useMemo(() => {
    if (!agents) return [];
    if (!search.trim()) return agents;
    const q = search.trim().toLowerCase();
    return agents.filter((a: any) => a.name?.toLowerCase().includes(q));
  }, [agents, search]);

  const create = useMutation({
    mutationFn: (data: { name: string }) => api.post('/agents', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      setShowCreate(false);
      setName('');
      toast('סוכן נוצר בהצלחה', 'success');
    },
    onError: () => toast('שגיאה ביצירת סוכן', 'error'),
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/agents/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
    onError: () => toast('שגיאה בעדכון סטטוס', 'error'),
  });

  const activeCount = agents?.filter((a: any) => a.status === 'active').length ?? 0;
  const totalCalls = agents?.reduce((sum: number, a: any) => sum + (a._count?.calls ?? 0), 0) ?? 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        {isSuperAdmin && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" />
            סוכן חדש
          </Button>
        )}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חפש סוכן..."
            className="w-full pr-9 pl-3 py-2 rounded-lg text-sm bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { value: agents?.length ?? 0, label: 'סוכנים', color: 'text-[var(--text-primary)]' },
          { value: activeCount, label: 'פעילים', color: 'text-[var(--accent)]' },
          { value: totalCalls, label: 'שיחות', color: 'text-blue-400' },
        ].map(({ value, label, color }) => (
          <Card key={label} className="p-5 text-center group hover:border-[var(--border-bright)] transition-colors">
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">{label}</p>
          </Card>
        ))}
      </div>

      {showCreate && isSuperAdmin && (
        <Card className="p-5 animate-slide-up">
          <form
            onSubmit={(e) => { e.preventDefault(); create.mutate({ name }); }}
            className="flex items-end gap-4"
          >
            <div className="flex-1">
              <Input
                label="שם הסוכן"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="לדוגמה: סוכן תמיכה"
                required
              />
            </div>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'יוצר...' : 'צור'}
            </Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>ביטול</Button>
          </form>
        </Card>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12 gap-2 text-[var(--text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>טוען סוכנים...</span>
        </div>
      )}

      <div className="space-y-3">
        {filtered?.map((agent: any) => (
          <Card
            key={agent.id}
            className="flex items-center justify-between px-5 py-4 hover:border-[var(--border-bright)] transition-colors"
          >
            <div className="flex items-center gap-3">
              {isSuperAdmin && (
                <button
                  onClick={() => navigate(`/agents/${agent.id}?tab=settings`)}
                  className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <Settings className="w-4 h-4" />
                </button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/agents/${agent.id}`)}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                הכנס
              </Button>
              {!isEmployee && (
                <Toggle
                  checked={agent.status === 'active'}
                  onChange={(checked) =>
                    toggleStatus.mutate({ id: agent.id, status: checked ? 'active' : 'inactive' })
                  }
                />
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[var(--text-primary)]">{agent.name}</span>
                  <span className={`w-2 h-2 rounded-full ${
                    agent.status === 'active' ? 'bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]' : 'bg-red-400'
                  }`} />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {agent.phoneNumber && (
                    <span className="text-xs text-[var(--text-muted)] flex items-center gap-1" dir="ltr">
                      <Phone className="w-3 h-3" />
                      {agent.phoneNumber}
                    </span>
                  )}
                  {(agent._count?.calls ?? 0) > 0 && (
                    <span className="text-xs text-[var(--text-muted)]">
                      {agent._count.calls} שיחות
                    </span>
                  )}
                </div>
              </div>
              <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center">
                <Bot className="w-5 h-5 text-[var(--accent)]" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {filtered?.length === 0 && !isLoading && (
        <div className="text-center py-16">
          <Bot className="w-16 h-16 mx-auto mb-4 text-[var(--text-muted)]" />
          <h3 className="text-lg font-medium text-[var(--text-primary)]">
            {search ? 'לא נמצאו סוכנים תואמים' : 'אין סוכנים עדיין'}
          </h3>
          {!search && isSuperAdmin && (
            <p className="text-[var(--text-secondary)] mt-1">צור סוכן חדש כדי להתחיל</p>
          )}
        </div>
      )}
    </div>
  );
}
