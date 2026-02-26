import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Database, Trash2, ChevronRight, ChevronLeft, RefreshCw,
  Bot, Users, BookUser, Phone, MessageSquare, CalendarCheck,
  X, CheckSquare, Square, MinusSquare,
} from 'lucide-react';
import api from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../lib/cn';

const TABLES = [
  { key: 'agents', label: 'Agents', icon: Bot },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'contacts', label: 'Contacts', icon: BookUser },
  { key: 'calls', label: 'Calls', icon: Phone },
  { key: 'appointments', label: 'Appointments', icon: CalendarCheck },
  { key: 'utterances', label: 'Utterances', icon: MessageSquare },
];

const STATUS_COLORS: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  active: 'success', inactive: 'neutral', completed: 'success',
  scheduled: 'info', cancelled: 'danger', no_show: 'warning',
  failed: 'danger', queued: 'neutral', in_call: 'warning',
  calling: 'info',
};

export default function AdminPage() {
  const qc = useQueryClient();
  const [table, setTable] = useState('agents');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailRow, setDetailRow] = useState<Record<string, unknown> | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-table', table, page],
    queryFn: () => api.get(`/admin/table/${table}?page=${page}&limit=20`).then(r => r.data),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/table/${table}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-table', table] });
      setSelected(prev => { const next = new Set(prev); next.delete(''); return next; });
    },
  });

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => api.post(`/admin/table/${table}/bulk-delete`, { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-table', table] });
      setSelected(new Set());
    },
  });

  const rows: any[] = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1;
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  const allOnPageSelected = rows.length > 0 && rows.every((r: any) => selected.has(r.id));
  const someSelected = selected.size > 0;

  function switchTable(key: string) {
    setTable(key);
    setPage(1);
    setSelected(new Set());
  }

  function toggleRow(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allOnPageSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        rows.forEach((r: any) => next.delete(r.id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        rows.forEach((r: any) => next.add(r.id));
        return next;
      });
    }
  }

  function handleBulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`למחוק ${ids.length} רשומות?`)) return;
    bulkDelete.mutate(ids);
  }

  const tabCounts = useMemo(() => meta?.total, [meta]);

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {someSelected ? (
            <>
              <Button variant="danger" size="sm" onClick={handleBulkDelete} disabled={bulkDelete.isPending}>
                <Trash2 className="w-4 h-4" />
                מחק {selected.size} נבחרים
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                בטל בחירה
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => qc.invalidateQueries({ queryKey: ['admin-table', table] })}
              >
                <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
                רענן
              </Button>
              {meta && (
                <span className="text-sm text-[var(--text-muted)]">{meta.total} רשומות</span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-[var(--text-primary)]">Database</h2>
          <Database className="w-5 h-5 text-blue-400" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {TABLES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => switchTable(key)}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px',
              table === key
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            {label}
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-[var(--text-secondary)]">טוען...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-[var(--text-secondary)]">טבלה ריקה</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]">
                  <th className="px-3 py-2.5 w-10 border-l border-[var(--border)]">
                    <button onClick={toggleAll} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                      {allOnPageSelected
                        ? <CheckSquare className="w-4 h-4 text-blue-400" />
                        : someSelected
                          ? <MinusSquare className="w-4 h-4 text-blue-400" />
                          : <Square className="w-4 h-4" />
                      }
                    </button>
                  </th>
                  {columns.map(col => (
                    <th
                      key={col}
                      className="px-3 py-2.5 text-right font-medium text-[var(--text-secondary)] whitespace-nowrap uppercase text-xs tracking-wider border-l border-[var(--border)]"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any) => (
                  <tr
                    key={row.id}
                    className={cn(
                      'transition-colors cursor-pointer border-b border-[var(--border)]/50',
                      selected.has(row.id) ? 'bg-blue-500/10' : 'hover:bg-[var(--bg-hover)]'
                    )}
                    onClick={() => setDetailRow(row)}
                  >
                    <td className="px-3 py-2.5 border-l border-[var(--border)]/30" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleRow(row.id)}
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        {selected.has(row.id)
                          ? <CheckSquare className="w-4 h-4 text-blue-400" />
                          : <Square className="w-4 h-4" />
                        }
                      </button>
                    </td>
                    {columns.map(col => (
                      <td
                        key={col}
                        className="px-3 py-2.5 max-w-[200px] truncate text-[var(--text-primary)] border-l border-[var(--border)]/30"
                        dir="ltr"
                      >
                        {renderCell(col, row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-between">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronRight className="w-4 h-4" />
              הקודם
            </Button>
            <span className="text-sm text-[var(--text-muted)]">
              עמוד {page} מתוך {totalPages}
            </span>
            <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              הבא
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        )}
      </Card>

      {/* Detail Modal */}
      {detailRow && (
        <DetailModal row={detailRow} onClose={() => setDetailRow(null)} onDelete={(id) => {
          remove.mutate(id);
          setDetailRow(null);
        }} />
      )}
    </div>
  );
}

// --- Detail Modal ---

function DetailModal({ row, onClose, onDelete }: {
  row: Record<string, unknown>;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-card)] z-10">
          <div className="flex items-center gap-2">
            <Button variant="danger" size="sm" onClick={() => { if (confirm('למחוק?')) onDelete(row.id as string); }}>
              <Trash2 className="w-3.5 h-3.5" />
              מחק
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-[var(--text-muted)]">{shortId(row.id as string)}</span>
            <button onClick={onClose} className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          {Object.entries(row).map(([key, value]) => (
            <div key={key} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{key}</span>
              <div className="text-sm text-[var(--text-primary)] break-all" dir="ltr">
                {renderDetailValue(key, value)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Cell Rendering ---

function renderCell(col: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-[var(--text-muted)]">—</span>;

  if (col === 'status') {
    const variant = STATUS_COLORS[value as string] ?? 'neutral';
    return <Badge variant={variant}>{String(value)}</Badge>;
  }

  if (col === 'id' || col.endsWith('Id') || col.endsWith('_id')) {
    return <span className="font-mono text-xs text-[var(--text-muted)]">{shortId(String(value))}</span>;
  }

  if (isDateString(value)) {
    return formatDate(value as string);
  }

  if (typeof value === 'object') {
    return <span className="text-[var(--text-muted)] text-xs">{JSON.stringify(value).slice(0, 60)}…</span>;
  }

  const str = String(value);
  if (str.length > 80) return str.slice(0, 80) + '…';
  return str;
}

function renderDetailValue(key: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-[var(--text-muted)]">—</span>;

  if (key === 'status') {
    const variant = STATUS_COLORS[value as string] ?? 'neutral';
    return <Badge variant={variant}>{String(value)}</Badge>;
  }

  if (isDateString(value)) {
    return formatDate(value as string);
  }

  if (typeof value === 'object') {
    return (
      <pre className="bg-[var(--bg-primary)] rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return String(value);
}

// --- Helpers ---

function shortId(id: string): string {
  if (!id || id.length <= 8) return id;
  return id.slice(0, 8) + '…';
}

function isDateString(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
