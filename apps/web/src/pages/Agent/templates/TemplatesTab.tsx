import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Loader2, AlertTriangle, CheckCircle, Clock, XCircle, Trash2, Pencil, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/Toast';
import { cn } from '../../../lib/cn';
import TemplateBuilder from './TemplateBuilder';

interface WhatsappTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejectionReason: string | null;
  components: unknown[];
  createdAt: string;
}

interface Props {
  agentId: string;
  hasWabaConfig: boolean;
}

type StatusFilter = 'ALL' | 'APPROVED' | 'PENDING' | 'REJECTED';

const STATUS_CONFIG = {
  APPROVED: { label: 'מאושר', icon: CheckCircle, className: 'text-green-600 bg-green-50 border-green-200' },
  PENDING:  { label: 'ממתין', icon: Clock,       className: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
  REJECTED: { label: 'נדחה',  icon: XCircle,     className: 'text-red-600 bg-red-50 border-red-200' },
  PAUSED:   { label: 'מושהה', icon: Clock,       className: 'text-gray-600 bg-gray-50 border-gray-200' },
  DISABLED: { label: 'מושבת', icon: XCircle,     className: 'text-gray-600 bg-gray-50 border-gray-200' },
} as const;

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING:      'שיווק',
  UTILITY:        'שירות',
  AUTHENTICATION: 'אימות',
};

const FILTER_TABS: { id: StatusFilter; label: string }[] = [
  { id: 'ALL',      label: 'הכל' },
  { id: 'APPROVED', label: 'מאושר' },
  { id: 'PENDING',  label: 'ממתין' },
  { id: 'REJECTED', label: 'נדחה' },
];

function getBodyText(components: unknown[]): string {
  const body = (components as { type: string; text?: string }[]).find(c => c.type === 'BODY');
  return body?.text ?? '';
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG];
  if (!cfg) return <span className="text-xs text-[var(--text-secondary)]">{status}</span>;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border', cfg.className)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

export default function TemplatesTab({ agentId, hasWabaConfig }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [page, setPage] = useState(1);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<WhatsappTemplate | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['whatsapp-templates', agentId, filter, page],
    queryFn: () =>
      api.get(`/agents/${agentId}/whatsapp/templates`, {
        params: { status: filter, page, limit: 10 },
      }).then(r => r.data as { data: WhatsappTemplate[]; meta: { total: number; pages: number } }),
    staleTime: 60_000,
    enabled: hasWabaConfig,
  });

  const syncMutation = useMutation({
    mutationFn: () => api.post(`/agents/${agentId}/whatsapp/templates/sync`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-templates', agentId] });
      toast('תבניות סונכרנו בהצלחה', 'success');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(msg ?? 'שגיאה בסנכרון', 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (templateId: string) => api.delete(`/agents/${agentId}/whatsapp/templates/${templateId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-templates', agentId] });
      toast('התבנית נמחקה', 'success');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(msg ?? 'שגיאה במחיקה', 'error');
    },
  });

  function openCreate() {
    setEditTemplate(null);
    setBuilderOpen(true);
  }

  function openEdit(tpl: WhatsappTemplate) {
    setEditTemplate(tpl);
    setBuilderOpen(true);
  }

  function handleBuilderClose(submitted: boolean) {
    setBuilderOpen(false);
    setEditTemplate(null);
    if (submitted) {
      qc.invalidateQueries({ queryKey: ['whatsapp-templates', agentId] });
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">תבניות הודעות</h3>
          <p className="text-xs text-[var(--text-secondary)]">ניהול תבניות WhatsApp לשליחה יזומה</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || !hasWabaConfig}
          >
            {syncMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <RefreshCw className="w-4 h-4" />}
            סנכרן
          </Button>
          <Button size="sm" onClick={openCreate} disabled={!hasWabaConfig}>
            <Plus className="w-4 h-4" />
            תבנית חדשה
          </Button>
        </div>
      </div>

      {/* Missing config banner */}
      {!hasWabaConfig && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>נדרש WABA ID ו-App ID — הגדר אותם בטאב וואטסאפ כדי לנהל תבניות</span>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-0.5 p-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] w-fit">
        {FILTER_TABS.map(f => (
          <button
            key={f.id}
            onClick={() => { setFilter(f.id); setPage(1); }}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              filter === f.id
                ? 'bg-[var(--accent)] text-white shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-[var(--text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : !data?.data.length ? (
        <div className="text-center py-12 text-[var(--text-secondary)] text-sm">
          {filter === 'ALL' ? 'אין תבניות עדיין — צור תבנית חדשה או סנכרן מ-Meta' : `אין תבניות עם סטטוס "${FILTER_TABS.find(f => f.id === filter)?.label}"`}
        </div>
      ) : (
        <div className="space-y-2">
          {data.data.map(tpl => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              onEdit={() => openEdit(tpl)}
              onDelete={() => deleteMutation.mutate(tpl.id)}
              isDeleting={deleteMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.meta.pages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-[var(--text-secondary)]">
            {data.meta.total} תבניות סה"כ
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="text-xs text-[var(--text-secondary)] px-2">
              {page} / {data.meta.pages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(data.meta.pages, p + 1))}
              disabled={page === data.meta.pages}
              className="p-1.5 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Template Builder modal */}
      {builderOpen && (
        <TemplateBuilder
          agentId={agentId}
          initialTemplate={editTemplate}
          onClose={handleBuilderClose}
        />
      )}
    </div>
  );
}

function TemplateCard({
  template,
  onEdit,
  onDelete,
  isDeleting,
}: {
  template: WhatsappTemplate;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const bodyText = getBodyText(template.components);
  const isApproved = template.status === 'APPROVED';
  const isRejected = template.status === 'REJECTED';

  return (
    <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[var(--text-primary)] font-mono">{template.name}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border)]">
              {CATEGORY_LABELS[template.category] ?? template.category}
            </span>
            <span className="text-xs text-[var(--text-tertiary)]">{template.language}</span>
          </div>
          {bodyText && (
            <p className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-2">{bodyText}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={template.status} />
          {!isApproved && (
            <button
              onClick={onEdit}
              className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title="ערוך"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="p-1.5 rounded hover:bg-red-50 text-[var(--text-secondary)] hover:text-red-600 transition-colors disabled:opacity-40"
            title="מחק"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {isRejected && template.rejectionReason && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700">
          <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>סיבת דחייה: {template.rejectionReason}</span>
        </div>
      )}
    </div>
  );
}
