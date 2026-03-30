import { useState, useCallback, useEffect, useRef, type RefObject, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Search, PhoneOutgoing, PhoneIncoming, PhoneMissed,
  MessageSquare, Activity, Loader2, Play, Pause, Download, X as XIcon,
  ChevronLeft, ChevronRight, FileDown,
} from 'lucide-react';
import api from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatDuration, formatCallDate } from '../../lib/format';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { TimeRangeFilter } from '../Dashboard/components/TimeRangeFilter';
import { useCallsData, type DirectionFilter } from '../../hooks/useCallsData';
import { useAgentEvents } from '../../hooks/useAgentEvents';
import { useAuth } from '../../hooks/useAuth';

const DIRECTION_FILTERS: { key: DirectionFilter; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'outbound', label: 'יוצאות' },
  { key: 'inbound', label: 'נכנסות' },
  { key: 'no_answer', label: 'לא נענו' },
];

interface CallsTabProps {
  agentId: string;
  playingCallId: string | null;
  setPlayingCallId: (id: string | null) => void;
  audioRef: RefObject<HTMLAudioElement | null>;
  onShowOutbound: () => void;
  onSelectCall: (id: string) => void;
}

interface CallRowProps {
  call: any;
  agentId: string;
  isPlaying: boolean;
  onPlay: (e: ReactMouseEvent) => void;
  onDownload: (e: ReactMouseEvent) => void;
  onSelect: () => void;
}

function CallRow({ call, isPlaying, onPlay, onDownload, onSelect }: CallRowProps) {
  return (
    <div
      className="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
      onClick={onSelect}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant={
          call.status === 'completed' ? 'success' : call.status === 'failed' ? 'danger' :
          call.status === 'no_answer' ? 'neutral' :
          call.status === 'in_call' || call.status === 'ringing' ? 'warning' : 'info'
        }>
          {(call.status === 'in_call' || call.status === 'ringing') && (
            <Activity className="w-3 h-3 inline mr-1 animate-pulse" />
          )}
          {call.status === 'calling' ? 'מחייג...' : call.status === 'ringing' ? 'מצלצל...' :
           call.status === 'in_call' ? 'בשיחה' : call.status === 'completed' ? 'הושלמה' :
           call.status === 'failed' ? 'נכשלה' : call.status === 'no_answer' ? 'לא נענתה' :
           call.status === 'queued' ? 'ממתין' : call.status}
        </Badge>
        <span title={call.status === 'no_answer' ? 'יוצאת — לא נענתה' : call.direction === 'inbound' ? 'שיחה נכנסת' : 'שיחה יוצאת'}>
          {call.status === 'no_answer'
            ? <PhoneMissed className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            : call.direction === 'inbound'
              ? <PhoneIncoming className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              : <PhoneOutgoing className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />}
        </span>
        {call.callType === 'followup' && (
          <span className="text-xs font-medium text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded">פולואפ</span>
        )}
        {call.retryCount > 0 && <Badge variant="warning">חויג שנית</Badge>}
        {call.durationSec != null && (
          <span className="text-xs text-[var(--text-muted)]">{formatDuration(call.durationSec)}</span>
        )}
        {call.status === 'completed' && (
          <span className="text-xs text-[var(--text-muted)]">{call.transcriptSaved ? 'תמלול זמין' : 'מעבד...'}</span>
        )}
        {call.recordingStatus === 'processing' && (
          <Loader2 className="w-3.5 h-3.5 text-[var(--text-muted)] animate-spin" />
        )}
        {call.recordingStatus === 'ready' && (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <button onClick={onPlay} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--accent)] transition-colors" title={isPlaying ? 'עצור' : 'נגן הקלטה'}>
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button onClick={onDownload} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title="הורד MP3">
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      <div className="text-left">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {call.contact?.name || call.contact?.phone || 'לא ידוע'}
        </p>
        <p className="text-xs text-[var(--text-muted)]">{formatCallDate(call.createdAt)}</p>
      </div>
    </div>
  );
}

function EmptyState({ q, preset, direction, clearFilters }: { q: string; preset: string; direction: DirectionFilter; clearFilters: () => void }) {
  const hasFilters = q.length >= 3 || direction !== 'all' || preset !== 'all';
  return (
    <div className="px-6 py-12 text-center space-y-3">
      <MessageSquare className="w-10 h-10 mx-auto text-[var(--text-muted)]" />
      <p className="text-[var(--text-secondary)]">{hasFilters ? 'לא נמצאו שיחות בטווח שנבחר' : 'אין שיחות עדיין'}</p>
      {hasFilters && (
        <button onClick={clearFilters} className="text-sm text-[var(--accent)] hover:underline">
          חפש בהכל
        </button>
      )}
    </div>
  );
}

export default function CallsTab({
  agentId, playingCallId, setPlayingCallId, audioRef, onShowOutbound, onSelectCall,
}: CallsTabProps) {
  const {
    query, refetch, preset, setPreset, customRange, setCustomRange,
    direction, setDirection, q, setQ, page, goPage, clearFilters,
    from, to, apiDirection, activeQ,
  } = useCallsData(agentId);

  const { isEmployee } = useAuth();
  const [newCallsCount, setNewCallsCount] = useState(0);
  const seenCallIds = useRef(new Set<string>());
  const [isExporting, setIsExporting] = useState(false);

  function handleNewCall(call: any) {
    if (!seenCallIds.current.has(call.id)) setNewCallsCount(n => n + 1);
  }

  useAgentEvents(agentId, true, handleNewCall);

  function handleViewNew() {
    setNewCallsCount(0);
    seenCallIds.current.clear();
    goPage(1);
    refetch();
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      const res = await api.get(`/agents/${agentId}/calls/export`, {
        params: { from, to, direction: apiDirection, q: activeQ || undefined },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `calls-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  const playRecording = useCallback(async (e: ReactMouseEvent, call: any) => {
    e.stopPropagation();
    if (playingCallId === call.id) {
      audioRef.current?.pause();
      setPlayingCallId(null);
      return;
    }
    try {
      const res = await api.get(`/agents/${agentId}/calls/${call.id}/recording`);
      const url = res.data.data.url;
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlayingCallId(null);
      audio.onerror = async () => {
        try {
          const retry = await api.get(`/agents/${agentId}/calls/${call.id}/recording`);
          audio.src = retry.data.data.url;
          audio.play();
        } catch { setPlayingCallId(null); }
      };
      await audio.play();
      setPlayingCallId(call.id);
    } catch { setPlayingCallId(null); }
  }, [agentId, playingCallId, audioRef, setPlayingCallId]);

  const downloadRecording = useCallback(async (e: ReactMouseEvent, call: any) => {
    e.stopPropagation();
    try {
      const res = await api.get(`/agents/${agentId}/calls/${call.id}/recording/download`);
      const a = document.createElement('a');
      a.href = res.data.data.url;
      a.download = `call-${call.id}.mp3`;
      a.click();
    } catch {}
  }, [agentId]);

  const calls: any[] = query.data?.data ?? [];
  const total: number = query.data?.meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="חיפוש לפי מספר / שם..."
            dir="rtl"
            className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] pr-9 pl-9 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
          />
          {q && (
            <button onClick={() => setQ('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden shrink-0">
          {DIRECTION_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setDirection(key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                direction === key
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" onClick={onShowOutbound}>
            <PhoneOutgoing className="w-3.5 h-3.5" />
            שיחה יוצאת
          </Button>
          {!isEmployee && (
            <Button size="sm" variant="secondary" onClick={handleExport} disabled={isExporting}>
              {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
              ייצוא
            </Button>
          )}
        </div>
      </div>

      {/* Time range filter */}
      <TimeRangeFilter
        preset={preset}
        onPresetChange={setPreset}
        customRange={customRange}
        onCustomRangeChange={setCustomRange}
      />

      {/* New calls banner — sticky so it's visible even when scrolled down */}
      {newCallsCount > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-sm backdrop-blur-sm">
          <span className="text-[var(--accent)] font-medium">יש {newCallsCount} שיחות חדשות</span>
          <button onClick={handleViewNew} className="text-[var(--accent)] font-medium hover:underline">
            צפייה
          </button>
        </div>
      )}

      {/* Meta row */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--text-muted)] flex items-center gap-1.5">
          {query.isFetching && !query.isPlaceholderData && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {total.toLocaleString('he-IL')} שיחות
        </span>
        {totalPages > 1 && (
          <span className="text-xs text-[var(--text-muted)]">עמוד {page} מתוך {totalPages}</span>
        )}
      </div>

      {/* List */}
      <Card>
        {query.isPending ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" /></div>
        ) : calls.length === 0 ? (
          <EmptyState q={q} preset={preset} direction={direction} clearFilters={clearFilters} />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {calls.map((call: any) => (
              <CallRow
                key={call.id}
                call={call}
                agentId={agentId}
                isPlaying={playingCallId === call.id}
                onPlay={e => playRecording(e, call)}
                onDownload={e => downloadRecording(e, call)}
                onSelect={() => onSelectCall(call.id)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => goPage(page - 1)}>
            <ChevronRight className="w-4 h-4" />
            הקודם
          </Button>
          <span className="text-sm text-[var(--text-secondary)] min-w-[80px] text-center">
            {page} / {totalPages}
          </span>
          <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => goPage(page + 1)}>
            הבא
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
