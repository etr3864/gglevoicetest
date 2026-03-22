import { useQuery } from '@tanstack/react-query';
import { X, Loader2 } from 'lucide-react';
import api from '../../lib/api';

interface Chunk {
  id: string;
  chunk_type: string;
  content: string;
  importance: number;
}

interface KnowledgeDocument {
  id: string;
  name: string;
  docType: 'text' | 'table';
}

const CHUNK_TYPE_LABELS: Record<string, string> = {
  summary: 'סיכום',
  parent: 'הורה',
  child: 'ילד',
};

const CHUNK_TYPE_COLORS: Record<string, string> = {
  summary: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  parent: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  child: 'bg-zinc-700/50 text-zinc-300 border-zinc-600/30',
};

export default function KnowledgeChunksDrawer({
  agentId,
  document: doc,
  onClose,
}: {
  agentId: string;
  document: KnowledgeDocument;
  onClose: () => void;
}) {
  const { data: chunks = [], isLoading } = useQuery<Chunk[]>({
    queryKey: ['knowledge-chunks', agentId, doc.id],
    queryFn: () => api.get(`/agents/${agentId}/knowledge/${doc.id}/chunks`).then((r) => r.data.data),
  });

  const grouped = groupByType(chunks);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h3 className="text-sm font-semibold text-white">{doc.name}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{chunks.length} קטעים</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
            </div>
          ) : (
            Object.entries(grouped).map(([type, typeChunks]) => (
              <div key={type}>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  {CHUNK_TYPE_LABELS[type] ?? type} ({typeChunks.length})
                </p>
                <div className="space-y-2">
                  {typeChunks.map((chunk) => (
                    <div
                      key={chunk.id}
                      className={`border rounded-lg p-3 text-xs text-right leading-relaxed ${CHUNK_TYPE_COLORS[type] ?? 'bg-zinc-800 text-zinc-300 border-zinc-700'}`}
                    >
                      {chunk.content}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function groupByType(chunks: Chunk[]): Record<string, Chunk[]> {
  const order = ['summary', 'parent', 'child'];
  const result: Record<string, Chunk[]> = {};
  for (const type of order) {
    const group = chunks.filter((c) => c.chunk_type === type);
    if (group.length > 0) result[type] = group;
  }
  return result;
}
