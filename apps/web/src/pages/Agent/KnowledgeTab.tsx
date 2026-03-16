import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload, FileText, Trash2, Loader2, CheckCircle, XCircle,
  BookOpen, AlertCircle, Database,
} from 'lucide-react';
import api from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { cn } from '../../lib/cn';

interface KnowledgeDocument {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  status: 'processing' | 'ready' | 'failed';
  errorMessage: string | null;
  createdAt: string;
}

interface KnowledgeBase {
  id: string;
  totalFiles: number;
  totalSizeBytes: number;
  documents: KnowledgeDocument[];
  vertexCorpusId: string;
}

interface UploadEntry {
  uid: string;
  fileName: string;
  size: number;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

interface Props {
  agentId: string;
}

const ALLOWED_TYPES: Record<string, true> = {
  'application/pdf': true,
  'text/plain': true,
  'text/html': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
};

const MAX_SIZE_BYTES = 50 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgeTab({ agentId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: kb, isLoading } = useQuery<KnowledgeBase | null>({
    queryKey: ['knowledge', agentId],
    queryFn: async () => {
      const res = await api.get(`/agents/${agentId}/knowledge/documents`);
      return res.data.data ?? null;
    },
    refetchInterval: (query) => {
      const docs = query.state.data?.documents ?? [];
      const hasProcessingDocs = docs.some((d) => d.status === 'processing');
      const isCorpusPending = query.state.data?.vertexCorpusId === 'pending';
      return hasProcessingDocs || isCorpusPending ? 4000 : false;
    },
  });

  const enableMutation = useMutation({
    mutationFn: () => api.post(`/agents/${agentId}/knowledge/enable`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge', agentId] }),
    onError: () => toast('לא ניתן להפעיל מאגר ידע', 'error'),
  });

  const disableMutation = useMutation({
    mutationFn: () => api.delete(`/agents/${agentId}/knowledge`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge', agentId] }),
    onError: () => toast('לא ניתן למחוק את המאגר', 'error'),
  });

  const uploadFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_TYPES[file.type]) {
        toast(`${file.name} — סוג קובץ לא נתמך. מותר: PDF, TXT, HTML, DOCX`, 'error');
        return;
      }
      if (file.size > MAX_SIZE_BYTES) {
        toast(`${file.name} — קובץ גדול מדי. מקסימום 50MB`, 'error');
        return;
      }

      const uid = crypto.randomUUID();
      setUploads((prev) => [...prev, { uid, fileName: file.name, size: file.size, progress: 0, status: 'uploading' }]);

      try {
        await api.post(`/agents/${agentId}/knowledge/documents`, file, {
          headers: { 'Content-Type': file.type, 'X-File-Name': file.name },
          onUploadProgress: (e) => {
            if (e.total) {
              const pct = Math.round((e.loaded / e.total) * 100);
              setUploads((prev) => prev.map((u) => (u.uid === uid ? { ...u, progress: pct } : u)));
            }
          },
        });
        setUploads((prev) => prev.map((u) => (u.uid === uid ? { ...u, status: 'done', progress: 100 } : u)));
        qc.invalidateQueries({ queryKey: ['knowledge', agentId] });
        setTimeout(() => setUploads((prev) => prev.filter((u) => u.uid !== uid)), 2500);
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'שגיאת העלאה';
        setUploads((prev) => prev.map((u) => (u.uid === uid ? { ...u, status: 'error', error: msg } : u)));
      }
    },
    [agentId, qc, toast],
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => Array.from(files).forEach(uploadFile),
    [uploadFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const deleteDoc = useCallback(
    async (docId: string) => {
      setDeleting((prev) => new Set(prev).add(docId));
      try {
        await api.delete(`/agents/${agentId}/knowledge/documents/${docId}`);
        qc.invalidateQueries({ queryKey: ['knowledge', agentId] });
      } catch {
        toast('לא ניתן למחוק את הקובץ', 'error');
      } finally {
        setDeleting((prev) => {
          const s = new Set(prev);
          s.delete(docId);
          return s;
        });
      }
    },
    [agentId, qc, toast],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-secondary)]" />
      </div>
    );
  }

  if (!kb) {
    return <EmptyState onEnable={() => enableMutation.mutate()} isPending={enableMutation.isPending} />;
  }

  const processingCount = kb.documents.filter((d) => d.status === 'processing').length;

  return (
    <div className="space-y-5">
      <KbHeader
        totalFiles={kb.totalFiles}
        totalSizeBytes={Number(kb.totalSizeBytes)}
        processingCount={processingCount}
        onDisable={() => {
          if (window.confirm('האם למחוק את כל מאגר הידע וכל המסמכים?')) {
            disableMutation.mutate();
          }
        }}
        isDisabling={disableMutation.isPending}
        isPending={kb.vertexCorpusId === 'pending'}
      />

      {kb.vertexCorpusId === 'pending' ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 bg-[var(--bg-hover)] rounded-xl border border-[var(--border)]">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
          <div className="text-center max-w-xs">
            <p className="font-medium text-[var(--text-primary)]">מקים מאגר ידע...</p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              זה עשוי לקחת מספר דקות בפעם הראשונה
            </p>
          </div>
        </div>
      ) : (
        <DropZone
          fileInputRef={fileInputRef}
          isDragging={isDragging}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      )}

      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((u) => (
            <UploadRow
              key={u.uid}
              entry={u}
              onDismiss={() => setUploads((prev) => prev.filter((x) => x.uid !== u.uid))}
            />
          ))}
        </div>
      )}

      {kb.documents.length > 0 ? (
        <div className="space-y-2">
          {kb.documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              isDeleting={deleting.has(doc.id)}
              onDelete={() => deleteDoc(doc.id)}
            />
          ))}
        </div>
      ) : (
        uploads.length === 0 && (
          <p className="text-center py-8 text-sm text-[var(--text-secondary)]">
            עדיין אין מסמכים — גרור קובץ או לחץ להעלאה
          </p>
        )
      )}
    </div>
  );
}

function EmptyState({ onEnable, isPending }: { onEnable: () => void; isPending: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <div className="w-16 h-16 rounded-2xl bg-[var(--bg-hover)] flex items-center justify-center">
        <BookOpen className="w-8 h-8 text-[var(--text-secondary)]" />
      </div>
      <div className="text-center max-w-xs">
        <p className="font-semibold text-[var(--text-primary)]">מאגר ידע</p>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          הפעל מאגר ידע כדי להעלות מסמכים שהסוכן ישתמש בהם בזמן שיחה
        </p>
      </div>
      <Button onClick={onEnable} disabled={isPending}>
        {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
        הפעל מאגר ידע
      </Button>
    </div>
  );
}

interface KbHeaderProps {
  totalFiles: number;
  totalSizeBytes: number;
  processingCount: number;
  onDisable: () => void;
  isDisabling: boolean;
  isPending?: boolean;
}

function KbHeader({ totalFiles, totalSizeBytes, processingCount, onDisable, isDisabling, isPending }: KbHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
          {isPending ? <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> : <Database className="w-4 h-4 text-emerald-400" />}
        </div>
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {isPending ? 'מקים מאגר...' : 'מאגר ידע פעיל'}
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            {totalFiles} קבצים · {formatBytes(totalSizeBytes)}
            {processingCount > 0 && (
              <span className="mr-2 text-yellow-400 inline-flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                {processingCount} מעובד...
              </span>
            )}
          </p>
        </div>
      </div>
      <Button variant="danger" size="sm" onClick={onDisable} disabled={isDisabling}>
        {isDisabling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
        מחק מאגר
      </Button>
    </div>
  );
}

interface DropZoneProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  isDragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onClick: () => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function DropZone({ fileInputRef, isDragging, onDragOver, onDragLeave, onDrop, onClick, onChange }: DropZoneProps) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={onClick}
      className={cn(
        'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200 select-none',
        isDragging
          ? 'border-emerald-500 bg-emerald-500/5 scale-[1.01]'
          : 'border-[var(--border)] hover:border-[var(--border-bright)] hover:bg-[var(--bg-hover)]',
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.txt,.html,.docx"
        className="hidden"
        onChange={onChange}
      />
      <Upload
        className={cn(
          'w-8 h-8 mx-auto mb-3 transition-colors',
          isDragging ? 'text-emerald-400' : 'text-[var(--text-secondary)]',
        )}
      />
      <p className="text-sm font-medium text-[var(--text-primary)]">גרור קבצים לכאן או לחץ לבחירה</p>
      <p className="text-xs text-[var(--text-secondary)] mt-1">PDF · TXT · HTML · DOCX · עד 50MB לקובץ · מספר קבצים במקביל</p>
    </div>
  );
}

function UploadRow({ entry, onDismiss }: { entry: UploadEntry; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
      <FileText className="w-4 h-4 shrink-0 text-[var(--text-secondary)]" />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate text-[var(--text-primary)]">{entry.fileName}</p>
        <p className="text-xs text-[var(--text-secondary)]">{formatBytes(entry.size)}</p>
        {entry.status === 'uploading' && (
          <div className="mt-1.5 h-1 bg-[var(--bg-hover)] rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${entry.progress}%` }}
            />
          </div>
        )}
        {entry.status === 'error' && (
          <p className="text-xs text-red-400 mt-0.5">{entry.error}</p>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        {entry.status === 'uploading' && (
          <>
            <span className="text-xs text-[var(--text-secondary)]">{entry.progress}%</span>
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
          </>
        )}
        {entry.status === 'done' && <CheckCircle className="w-4 h-4 text-emerald-400" />}
        {entry.status === 'error' && (
          <button onClick={onDismiss} className="hover:text-red-300 transition-colors">
            <XCircle className="w-4 h-4 text-red-400" />
          </button>
        )}
      </div>
    </div>
  );
}

const DOC_STATUS: Record<KnowledgeDocument['status'], {
  label: string;
  variant: 'success' | 'warning' | 'danger';
  spin: boolean;
}> = {
  ready: { label: 'מוכן', variant: 'success', spin: false },
  processing: { label: 'מעבד...', variant: 'warning', spin: true },
  failed: { label: 'נכשל', variant: 'danger', spin: false },
};

function DocumentRow({
  doc,
  isDeleting,
  onDelete,
}: {
  doc: KnowledgeDocument;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  const s = DOC_STATUS[doc.status];
  const StatusIcon = doc.status === 'ready' ? CheckCircle : doc.status === 'failed' ? AlertCircle : Loader2;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] group">
      <FileText className="w-4 h-4 shrink-0 text-[var(--text-secondary)]" />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate text-[var(--text-primary)]">{doc.fileName}</p>
        <p className="text-xs text-[var(--text-secondary)]">{formatBytes(Number(doc.fileSizeBytes))}</p>
        {doc.status === 'failed' && doc.errorMessage && (
          <p className="text-xs text-red-400 mt-0.5 truncate" title={doc.errorMessage}>{doc.errorMessage}</p>
        )}
      </div>
      <Badge variant={s.variant} className="shrink-0 gap-1">
        <StatusIcon className={cn('w-3 h-3', s.spin && 'animate-spin')} />
        {s.label}
      </Badge>
      <button
        onClick={onDelete}
        disabled={isDeleting}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/10 text-[var(--text-secondary)] hover:text-red-400 disabled:cursor-not-allowed"
        title="מחק קובץ"
      >
        {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
      </button>
    </div>
  );
}
