import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload, Trash2, AlertCircle, CheckCircle2, Loader2,
  Image, Video, File, Pencil, Check, X, RefreshCw,
  Settings2, ChevronDown, ChevronUp, CheckSquare, Square,
} from 'lucide-react';
import api from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { useToast } from '../../components/ui/Toast';
import { cn } from '../../lib/cn';

interface MediaItem {
  id: string;
  mediaType: 'image' | 'video' | 'file';
  name: string;
  description: string;
  caption: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  fileSizeBytes: number;
  originalSizeBytes: number;
  wasCompressed: boolean;
  mimeType: string;
  status: 'processing' | 'ready' | 'error';
  errorMsg: string | null;
  createdAt: string;
}

interface MediaSettings {
  mediaEnabled: boolean;
  mediaInstructions: string | null;
  mediaAnalysisInstructions: string | null;
}

type SubTab = 'image' | 'video' | 'file' | 'settings';

const SUB_TABS: { key: SubTab; label: string; icon: typeof Image; accept: string }[] = [
  { key: 'image', label: 'תמונות',  icon: Image, accept: '.jpg,.jpeg,.png,.webp' },
  { key: 'video', label: 'סרטונים', icon: Video, accept: '.mp4,.mov,.avi,.mkv,.webm' },
  { key: 'file',  label: 'קבצים',   icon: File,  accept: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt' },
];

export default function MediaTab({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [subTab, setSubTab] = useState<SubTab>('image');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeSubTab = SUB_TABS.find((t) => t.key === subTab);

  const { data: counts } = useQuery<Record<string, number>>({
    queryKey: ['media-counts', agentId],
    queryFn: () => api.get(`/agents/${agentId}/media/counts`).then((r) => r.data.data),
  });

  const { data: items = [], isLoading } = useQuery<MediaItem[]>({
    queryKey: ['media', agentId, subTab],
    queryFn: () => api.get(`/agents/${agentId}/media?type=${subTab}`).then((r) => r.data.data),
    enabled: subTab !== 'settings',
    refetchInterval: (q) => {
      const data = q.state.data;
      return Array.isArray(data) && data.some((i) => i.status === 'processing') ? 3_000 : false;
    },
  });

  const { data: settings } = useQuery<MediaSettings>({
    queryKey: ['media-settings', agentId],
    queryFn: () => api.get(`/agents/${agentId}/media/settings`).then((r) => r.data.data),
    enabled: subTab === 'settings',
  });

  useEffect(() => { setSelected(new Set()); }, [subTab]);

  const upload = useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      return api.post(`/agents/${agentId}/media`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', agentId, subTab] });
      qc.invalidateQueries({ queryKey: ['media-counts', agentId] });
      toast('הקבצים הועלו ומעובדים', 'success');
    },
    onError: (err: any) => toast(err?.response?.data?.message || 'שגיאה בהעלאה', 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/agents/${agentId}/media/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', agentId, subTab] });
      qc.invalidateQueries({ queryKey: ['media-counts', agentId] });
      toast('נמחק', 'success');
    },
    onError: () => toast('שגיאה במחיקה', 'error'),
  });

  const bulkRemove = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.delete(`/agents/${agentId}/media/${id}`))),
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['media', agentId, subTab] });
      qc.invalidateQueries({ queryKey: ['media-counts', agentId] });
      toast(`נמחקו ${selected.size} פריטים`, 'success');
    },
    onError: () => toast('שגיאה במחיקה', 'error'),
  });

  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/agents/${agentId}/media/${id}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media', agentId, subTab] }),
    onError: () => toast('שגיאה', 'error'),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) upload.mutate(files);
    e.target.value = '';
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.id)));
  }

  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">ספריית מדיה</h3>
          <p className="text-sm text-zinc-400 mt-0.5">תמונות, סרטונים וקבצים לשליחה אוטומטית בשיחות</p>
        </div>
        {activeSubTab && (
          <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={upload.isPending} className="gap-2">
            {upload.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            העלה
          </Button>
        )}
        <input ref={fileInputRef} type="file" multiple accept={activeSubTab?.accept ?? ''} onChange={handleFileChange} className="hidden" />
      </div>

      <div className="flex gap-1 border-b border-zinc-700/60">
        {SUB_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
              subTab === key ? 'border-violet-500 text-violet-400' : 'border-transparent text-zinc-400 hover:text-white',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {counts?.[key] != null && counts[key] > 0 && (
              <span className={cn(
                'min-w-[18px] h-[18px] rounded-full text-[10px] font-semibold flex items-center justify-center px-1',
                subTab === key ? 'bg-violet-500/20 text-violet-300' : 'bg-zinc-700 text-zinc-400',
              )}>
                {counts[key]}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={() => setSubTab('settings')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ml-auto',
            subTab === 'settings' ? 'border-violet-500 text-violet-400' : 'border-transparent text-zinc-400 hover:text-white',
          )}
        >
          <Settings2 className="w-3.5 h-3.5" />
          הגדרות
        </button>
      </div>

      {subTab === 'settings' ? (
        <SettingsPanel agentId={agentId} settings={settings ?? null} />
      ) : isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>
      ) : items.length === 0 ? (
        <EmptyState type={subTab} onUpload={() => fileInputRef.current?.click()} />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <button onClick={toggleSelectAll} className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors">
              {allSelected ? <CheckSquare className="w-4 h-4 text-violet-400" /> : <Square className="w-4 h-4" />}
              {allSelected ? 'בטל בחירה' : 'בחר הכל'}
            </button>
            {selected.size > 0 && (
              <button
                onClick={() => { if (confirm(`למחוק ${selected.size} פריטים?`)) bulkRemove.mutate([...selected]); }}
                disabled={bulkRemove.isPending}
                className="flex items-center gap-1.5 text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
              >
                {bulkRemove.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                מחק נבחרים ({selected.size})
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3">
            {items.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                agentId={agentId}
                isSelected={selected.has(item.id)}
                onToggleSelect={() => toggleSelect(item.id)}
                onDelete={() => remove.mutate(item.id)}
                onRetry={() => retry.mutate(item.id)}
                isDeleting={remove.isPending && remove.variables === item.id}
                isRetrying={retry.isPending && retry.variables === item.id}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MediaCard({
  item, agentId, isSelected, onToggleSelect, onDelete, onRetry, isDeleting, isRetrying,
}: {
  item: MediaItem;
  agentId: string;
  isSelected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onRetry: () => void;
  isDeleting: boolean;
  isRetrying: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: item.name, description: item.description, caption: item.caption ?? '' });

  useEffect(() => {
    if (!editing) {
      setForm({ name: item.name, description: item.description, caption: item.caption ?? '' });
    }
  }, [item.name, item.description, item.caption, editing]);

  const update = useMutation({
    mutationFn: () => api.patch(`/agents/${agentId}/media/${item.id}`, {
      name: form.name,
      description: form.description,
      caption: form.caption || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', agentId] });
      setEditing(false);
      toast('עודכן', 'success');
    },
    onError: () => toast('שגיאה בעדכון', 'error'),
  });

  const preview = item.mediaType === 'image' ? item.previewUrl : item.thumbnailUrl;

  return (
    <div className={cn(
      'border rounded-xl overflow-hidden transition-colors',
      isSelected ? 'bg-violet-500/10 border-violet-500/40' : 'bg-zinc-800/60 border-zinc-700/50',
    )}>
      {item.status === 'processing' && <ProcessingBar />}

      <div className="flex gap-3 p-3">
        <div className="relative w-14 h-14 shrink-0">
          <div className="w-14 h-14 rounded-lg bg-zinc-700/60 flex items-center justify-center overflow-hidden">
            {preview ? (
              <img src={preview} alt={item.name} className="w-full h-full object-cover" />
            ) : (
              <MediaTypeIcon type={item.mediaType} />
            )}
          </div>
          <button
            onClick={onToggleSelect}
            className="absolute -top-1 -right-1 w-5 h-5 rounded flex items-center justify-center bg-zinc-900/80 hover:bg-zinc-800 transition-colors"
          >
            {isSelected
              ? <CheckSquare className="w-4 h-4 text-violet-400" />
              : <Square className="w-4 h-4 text-zinc-500 hover:text-zinc-300" />
            }
          </button>
        </div>

        <div className="flex-1 min-w-0">
          {editing ? (
            <EditForm
              form={form}
              onChange={setForm}
              onSave={() => update.mutate()}
              onCancel={() => { setEditing(false); setForm({ name: item.name, description: item.description, caption: item.caption ?? '' }); }}
              isSaving={update.isPending}
            />
          ) : (
            <MetaDisplay item={item} />
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge status={item.status} />
          <div className="flex items-center gap-1">
            {item.status === 'error' && (
              <button onClick={onRetry} disabled={isRetrying} className="p-1.5 rounded text-zinc-500 hover:text-amber-400 hover:bg-amber-400/10 transition-colors">
                {isRetrying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </button>
            )}
            {item.status === 'ready' && !editing && (
              <button onClick={() => setEditing(true)} className="p-1.5 rounded text-zinc-500 hover:text-violet-400 hover:bg-violet-400/10 transition-colors">
                <Pencil className="w-4 h-4" />
              </button>
            )}
            <button onClick={onDelete} disabled={isDeleting} className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40">
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
          <span className="text-[10px] text-zinc-600">{formatBytes(item.fileSizeBytes)}{item.wasCompressed ? ' (דחוס)' : ''}</span>
        </div>
      </div>
    </div>
  );
}

function MetaDisplay({ item }: { item: MediaItem }) {
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-medium text-white truncate">{item.name}</p>
      {item.description && <p className="text-xs text-zinc-400 line-clamp-2" dir="rtl">{item.description}</p>}
      {item.caption && <p className="text-xs text-zinc-500 italic truncate" dir="rtl">"{item.caption}"</p>}
      {item.status === 'error' && item.errorMsg && (
        <p className="text-xs text-red-400 truncate">{item.errorMsg}</p>
      )}
    </div>
  );
}

function EditForm({
  form, onChange, onSave, onCancel, isSaving,
}: {
  form: { name: string; description: string; caption: string };
  onChange: (f: typeof form) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <input
        className="w-full bg-zinc-700/60 border border-zinc-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-violet-500"
        value={form.name}
        onChange={(e) => onChange({ ...form, name: e.target.value })}
        placeholder="שם"
        dir="rtl"
      />
      <textarea
        className="w-full bg-zinc-700/60 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-violet-500 resize-none"
        value={form.description}
        onChange={(e) => onChange({ ...form, description: e.target.value })}
        placeholder="תיאור (לחיפוש סמנטי)"
        rows={2}
        dir="rtl"
      />
      <input
        className="w-full bg-zinc-700/60 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-violet-500"
        value={form.caption}
        onChange={(e) => onChange({ ...form, caption: e.target.value })}
        placeholder="כיתוב ברירת מחדל (אופציונלי)"
        dir="rtl"
      />
      <div className="flex gap-1 justify-end">
        <button onClick={onCancel} className="p-1 rounded text-zinc-500 hover:text-white transition-colors"><X className="w-3.5 h-3.5" /></button>
        <button onClick={onSave} disabled={isSaving} className="p-1 rounded text-green-400 hover:text-green-300 transition-colors disabled:opacity-40">
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

function SettingsPanel({ agentId, settings }: { agentId: string; settings: MediaSettings | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState({
    mediaEnabled: settings?.mediaEnabled ?? true,
    mediaInstructions: settings?.mediaInstructions ?? '',
    mediaAnalysisInstructions: settings?.mediaAnalysisInstructions ?? '',
  });

  const save = useMutation({
    mutationFn: () => api.patch(`/agents/${agentId}/media/settings`, {
      mediaEnabled: form.mediaEnabled,
      mediaInstructions: form.mediaInstructions || null,
      mediaAnalysisInstructions: form.mediaAnalysisInstructions || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media-settings', agentId] });
      toast('הגדרות נשמרו', 'success');
    },
    onError: () => toast('שגיאה בשמירה', 'error'),
  });

  if (!settings) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-4 py-3">
        <div>
          <p className="text-sm font-medium text-white">אפשר שליחת מדיה</p>
          <p className="text-xs text-zinc-400 mt-0.5">הסוכן יוכל לשלוח קבצים מדיה בזמן שיחה</p>
        </div>
        <Toggle checked={form.mediaEnabled} onChange={(v) => setForm({ ...form, mediaEnabled: v })} />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-300">הנחיות לסוכן</label>
        <textarea
          className="w-full bg-zinc-800/60 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 resize-none"
          value={form.mediaInstructions}
          onChange={(e) => setForm({ ...form, mediaInstructions: e.target.value })}
          placeholder="מתי ואיך לשלוח מדיה..."
          rows={3}
          dir="rtl"
        />
      </div>

      <div className="border border-zinc-700/50 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <span>הגדרות ניתוח מתקדמות</span>
          {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showAdvanced && (
          <div className="px-4 pb-4 space-y-2 border-t border-zinc-700/50">
            <p className="text-xs text-zinc-500 mt-3">הנחיות ל-AI בעת ניתוח קבצים ותמונות (שפה, מיקוד, סגנון)</p>
            <textarea
              className="w-full bg-zinc-800/60 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 resize-none"
              value={form.mediaAnalysisInstructions}
              onChange={(e) => setForm({ ...form, mediaAnalysisInstructions: e.target.value })}
              placeholder="לדוגמה: נתח באנגלית, התמקד במחירים..."
              rows={3}
              dir="rtl"
            />
          </div>
        )}
      </div>

      <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full">
        {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'שמור הגדרות'}
      </Button>
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

function StatusBadge({ status }: { status: MediaItem['status'] }) {
  if (status === 'ready') return <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="w-3 h-3" />מוכן</span>;
  if (status === 'error') return <span className="flex items-center gap-1 text-xs text-red-400"><AlertCircle className="w-3 h-3" />שגיאה</span>;
  return <span className="flex items-center gap-1 text-xs text-amber-400"><Loader2 className="w-3 h-3 animate-spin" />מעבד...</span>;
}

function MediaTypeIcon({ type }: { type: MediaItem['mediaType'] }) {
  if (type === 'image') return <Image className="w-6 h-6 text-blue-400" />;
  if (type === 'video') return <Video className="w-6 h-6 text-purple-400" />;
  return <File className="w-6 h-6 text-orange-400" />;
}

function EmptyState({ type, onUpload }: { type: SubTab; onUpload: () => void }) {
  const labels: Record<SubTab, string> = {
    image: 'תמונות (JPG, PNG)',
    video: 'סרטונים (MP4, MOV)',
    file: 'קבצים (PDF, DOCX, XLSX)',
    settings: '',
  };
  return (
    <button
      onClick={onUpload}
      className="w-full border-2 border-dashed border-zinc-700 rounded-xl p-10 text-center hover:border-violet-500/60 hover:bg-violet-500/5 transition-colors group"
    >
      <Upload className="w-8 h-8 text-zinc-600 group-hover:text-violet-400 mx-auto mb-3 transition-colors" />
      <p className="text-sm font-medium text-zinc-400 group-hover:text-white transition-colors">העלה קבצים</p>
      <p className="text-xs text-zinc-600 mt-1">{labels[type]}</p>
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
