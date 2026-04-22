import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, FileText, Table2, Trash2, ChevronRight, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { cn } from '../../lib/cn';
import KnowledgeChunksDrawer from './KnowledgeChunksDrawer';

interface KnowledgeDocument {
  id: string;
  name: string;
  docType: 'text' | 'table';
  status: 'processing' | 'ready' | 'error';
  errorMsg: string | null;
  chunkCount: number;
  fileSizeBytes: number;
  createdAt: string;
}

const ACCEPTED = '.pdf,.docx,.doc,.txt,.csv,.xlsx,.xls';
const MAX_FILES = 30;

export default function KnowledgeTab({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const { toast: showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const { data: docs = [], isLoading } = useQuery<KnowledgeDocument[]>({
    queryKey: ['knowledge', agentId],
    queryFn: () => api.get(`/agents/${agentId}/knowledge`).then((r) => r.data.data),
    refetchInterval: 300_000,
  });

  const upload = useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      return api.post(`/agents/${agentId}/knowledge`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', agentId] });
      showToast('הקבצים הועלו ומתבצע עיבוד', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.message || 'שגיאה בהעלאת קבצים', 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => api.delete(`/agents/${agentId}/knowledge/${docId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', agentId] });
      showToast('המסמך נמחק', 'success');
    },
    onError: () => showToast('שגיאה במחיקת המסמך', 'error'),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_FILES);
    if (files.length > 0) upload.mutate(files);
    e.target.value = '';
  }

  const selectedDoc = docs.find((d) => d.id === selectedDocId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">בסיס ידע</h3>
          <p className="text-sm text-zinc-400 mt-0.5">
            העלה מסמכים וטבלאות — הסוכן ישתמש בהם לענות על שאלות
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
          className="gap-2"
        >
          {upload.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          העלה קבצים
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      <SupportedFormatsHint />

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
        </div>
      ) : docs.length === 0 ? (
        <EmptyState onUpload={() => fileInputRef.current?.click()} />
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              onViewChunks={() => setSelectedDocId(doc.id)}
              onDelete={() => deleteMutation.mutate(doc.id)}
              isDeleting={deleteMutation.isPending && deleteMutation.variables === doc.id}
            />
          ))}
        </div>
      )}

      {selectedDoc && (
        <KnowledgeChunksDrawer
          agentId={agentId}
          document={selectedDoc}
          onClose={() => setSelectedDocId(null)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DocumentRow({
  doc,
  onViewChunks,
  onDelete,
  isDeleting,
}: {
  doc: KnowledgeDocument;
  onViewChunks: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  return (
    <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl overflow-hidden">
      {doc.status === 'processing' && <ProcessingBar />}
      <div className="flex items-center gap-3 px-4 py-3">
        <DocTypeIcon docType={doc.docType} />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{doc.name}</p>
          <div className="flex items-center gap-3 mt-0.5">
            <StatusBadge status={doc.status} errorMsg={doc.errorMsg} />
            {doc.status === 'ready' && (
              <span className="text-xs text-zinc-500">{doc.chunkCount} קטעים</span>
            )}
            <span className="text-xs text-zinc-600">{formatBytes(doc.fileSizeBytes)}</span>
          </div>
          {doc.status === 'error' && doc.errorMsg && (
            <p className="text-xs text-red-400 mt-1 truncate">{doc.errorMsg}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {doc.status === 'ready' && (
            <button
              onClick={onViewChunks}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-zinc-700/50 transition-colors"
            >
              קטעים
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40"
          >
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProcessingBar() {
  return (
    <div className="h-0.5 bg-zinc-700 overflow-hidden">
      <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-violet-400 to-transparent animate-shimmer" />
    </div>
  );
}

function StatusBadge({ status, errorMsg }: { status: KnowledgeDocument['status']; errorMsg: string | null }) {
  if (status === 'ready') {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-400">
        <CheckCircle2 className="w-3 h-3" />
        מוכן
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-red-400">
        <AlertCircle className="w-3 h-3" />
        שגיאה
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-amber-400">
      <Loader2 className="w-3 h-3 animate-spin" />
      מעבד...
    </span>
  );
}

function DocTypeIcon({ docType }: { docType: 'text' | 'table' }) {
  return docType === 'table'
    ? <Table2 className="w-5 h-5 text-blue-400 shrink-0" />
    : <FileText className="w-5 h-5 text-violet-400 shrink-0" />;
}

function SupportedFormatsHint() {
  return (
    <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-3">
      <p className="text-xs text-zinc-500 text-right">
        <span className="text-zinc-400 font-medium">מסמכים:</span> PDF, DOCX, TXT
        &nbsp;·&nbsp;
        <span className="text-zinc-400 font-medium">טבלאות:</span> CSV, XLSX
        &nbsp;·&nbsp;
        עד 30 קבצים, 10MB לקובץ
      </p>
    </div>
  );
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <button
      onClick={onUpload}
      className="w-full border-2 border-dashed border-zinc-700 rounded-xl p-10 text-center hover:border-violet-500/60 hover:bg-violet-500/5 transition-colors group"
    >
      <Upload className="w-8 h-8 text-zinc-600 group-hover:text-violet-400 mx-auto mb-3 transition-colors" />
      <p className="text-sm font-medium text-zinc-400 group-hover:text-white transition-colors">
        העלה את המסמכים הראשונים
      </p>
      <p className="text-xs text-zinc-600 mt-1">PDF, DOCX, TXT, CSV, XLSX</p>
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
