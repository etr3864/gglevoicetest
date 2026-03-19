import { useState } from 'react';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../../lib/cn';
import { AgentAccordion } from './AgentAccordion';
import type { SuperAdminAgent } from '../types';

interface AgentTableProps {
  agents: SuperAdminAgent[];
}

export function AgentTable({ agents }: AgentTableProps) {
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = agents.filter((a) => {
    const q = search.toLowerCase();
    return a.name.toLowerCase().includes(q) || (a.clientName?.toLowerCase().includes(q) ?? false);
  });

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
        <input
          type="text"
          placeholder="חיפוש סוכן או לקוח..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cn(
            'w-full pr-10 pl-4 py-2 rounded-lg border text-sm outline-none transition-colors',
            'border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)]',
            'placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]'
          )}
        />
      </div>

      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--bg-secondary)]/60 text-[var(--text-secondary)]">
              <th className="text-right px-4 py-3 font-medium w-8" />
              <th className="text-right px-4 py-3 font-medium">סוכן</th>
              <th className="text-right px-4 py-3 font-medium">לקוח</th>
              <th className="text-right px-4 py-3 font-medium">שיחות</th>
              <th className="text-right px-4 py-3 font-medium">דקות</th>
              <th className="text-right px-4 py-3 font-medium">עלות כוללת</th>
              <th className="text-right px-4 py-3 font-medium">עלות/דקה</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-[var(--text-muted)]">
                  {search ? 'לא נמצאו תוצאות' : 'אין סוכנים'}
                </td>
              </tr>
            ) : (
              filtered.map((a) => {
                const isExpanded = expandedId === a.id;
                return (
                  <AgentRow key={a.id} agent={a} isExpanded={isExpanded} onToggle={() => setExpandedId(isExpanded ? null : a.id)} />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AgentRow({ agent: a, isExpanded, onToggle }: { agent: SuperAdminAgent; isExpanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          'border-t border-[var(--border)] cursor-pointer transition-colors',
          isExpanded ? 'bg-[var(--accent)]/5' : 'hover:bg-[var(--bg-hover)]/40'
        )}
      >
        <td className="px-4 py-3">
          {isExpanded ? <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />}
        </td>
        <td className="px-4 py-3 font-medium">{a.name}</td>
        <td className="px-4 py-3 text-[var(--text-secondary)]">{a.clientName || '—'}</td>
        <td className="px-4 py-3 tabular-nums">{a.calls}</td>
        <td className="px-4 py-3 tabular-nums">{a.minutes}</td>
        <td className="px-4 py-3 tabular-nums font-medium">₪{a.totalCostIls.toFixed(2)}</td>
        <td className="px-4 py-3 tabular-nums">₪{a.costPerMinIls.toFixed(2)}</td>
      </tr>
      {isExpanded && (
        <tr className="bg-[var(--accent)]/5">
          <td colSpan={7}>
            <AgentAccordion performance={a.performance} costs={a.costs} />
          </td>
        </tr>
      )}
    </>
  );
}
