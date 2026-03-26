import { useState, useCallback, type RefObject, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Search, PhoneOutgoing, PhoneIncoming, PhoneMissed,
  MessageSquare, Activity, Loader2, Play, Pause, Download, X as XIcon,
} from 'lucide-react';
import api from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatDuration } from '../../lib/format';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

type DirectionFilter = 'all' | 'inbound' | 'outbound' | 'no_answer';

const DIRECTION_FILTERS: { key: DirectionFilter; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'outbound', label: 'יוצאות' },
  { key: 'inbound', label: 'נכנסות' },
  { key: 'no_answer', label: '📵 לא נענו' },
];

interface CallsTabProps {
  agentId: string;
  callsData: any;
  callSearch: string;
  setCallSearch: (v: string) => void;
  playingCallId: string | null;
  setPlayingCallId: (id: string | null) => void;
  audioRef: RefObject<HTMLAudioElement | null>;
  onShowOutbound: () => void;
  onSelectCall: (id: string) => void;
}

export default function CallsTab({
  agentId, callsData, callSearch, setCallSearch,
  playingCallId, setPlayingCallId, audioRef,
  onShowOutbound, onSelectCall,
}: CallsTabProps) {
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const searchLower = callSearch.toLowerCase();
  const filtered = (callsData?.data ?? []).filter((c: any) => {
    if (directionFilter === 'no_answer') {
      if (!(c.direction === 'outbound' && c.status === 'no_answer')) return false;
    } else if (directionFilter !== 'all' && c.direction !== directionFilter) return false;
    if (!callSearch || callSearch.length < 3) return true;
    return (
      c.contact?.phone?.includes(callSearch) ||
      c.contact?.name?.toLowerCase().includes(searchLower)
    );
  });

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
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlayingCallId(null);
      audio.onerror = async () => {
        try {
          const retry = await api.get(`/agents/${agentId}/calls/${call.id}/recording`);
          audio.src = retry.data.data.url;
          audio.play();
        } catch {
          setPlayingCallId(null);
        }
      };
      await audio.play();
      setPlayingCallId(call.id);
    } catch {
      setPlayingCallId(null);
    }
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={callSearch}
            onChange={e => setCallSearch(e.target.value)}
            placeholder="חיפוש לפי מספר / שם..."
            dir="rtl"
            className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] pr-9 pl-9 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
          />
          {callSearch && (
            <button onClick={() => setCallSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden shrink-0">
          {DIRECTION_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setDirectionFilter(key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                directionFilter === key
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="text-sm text-[var(--text-muted)] shrink-0">
          {filtered.length} שיחות
        </span>
        <Button size="sm" onClick={onShowOutbound}>
          <PhoneOutgoing className="w-3.5 h-3.5" />
          שיחה יוצאת
        </Button>
      </div>

      <Card>
        <div className="divide-y divide-[var(--border)]">
          {!filtered.length && (
            <div className="px-6 py-12 text-center">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 text-[var(--text-muted)]" />
              <p className="text-[var(--text-secondary)]">{callSearch.length >= 3 ? 'לא נמצאו תוצאות' : 'אין שיחות עדיין'}</p>
            </div>
          )}
          {filtered.map((call: any) => (
            <div
              key={call.id}
              className="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
              onClick={() => onSelectCall(call.id)}
            >
              <div className="flex items-center gap-3">
                <Badge variant={
                  call.status === 'completed' ? 'success' :
                  call.status === 'failed' ? 'danger' :
                  call.status === 'no_answer' ? 'neutral' :
                  call.status === 'in_call' ? 'warning' :
                  call.status === 'ringing' ? 'warning' : 'info'
                }>
                  {call.status === 'in_call' && <Activity className="w-3 h-3 inline mr-1 animate-pulse" />}
                  {call.status === 'ringing' && <Activity className="w-3 h-3 inline mr-1 animate-pulse" />}
                  {call.status === 'calling' ? 'מחייג...' :
                   call.status === 'ringing' ? 'מצלצל...' :
                   call.status === 'in_call' ? 'בשיחה' :
                   call.status === 'completed' ? 'הושלמה' :
                   call.status === 'failed' ? 'נכשלה' :
                   call.status === 'no_answer' ? 'לא נענתה' :
                   call.status === 'queued' ? 'ממתין' : call.status}
                </Badge>
                <span title={
                  call.status === 'no_answer' ? 'יוצאת — לא נענתה' :
                  call.direction === 'inbound' ? 'שיחה נכנסת' : 'שיחה יוצאת'
                }>
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
                  <span className="text-xs text-[var(--text-muted)]">
                    {call.transcriptSaved ? 'תמלול זמין' : 'מעבד...'}
                  </span>
                )}
                {call.recordingStatus === 'processing' && (
                  <Loader2 className="w-3.5 h-3.5 text-[var(--text-muted)] animate-spin" />
                )}
                {call.recordingStatus === 'ready' && (
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={e => playRecording(e, call)}
                      className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                      title={playingCallId === call.id ? 'עצור' : 'נגן הקלטה'}
                    >
                      {playingCallId === call.id
                        ? <Pause className="w-3.5 h-3.5" />
                        : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={e => downloadRecording(e, call)}
                      className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                      title="הורד MP3"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {call.contact?.name || call.contact?.phone || 'לא ידוע'}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {new Date(call.createdAt).toLocaleString('he-IL')}
                </p>
              </div>
            </div>
          ))}
        </div>
        {callsData?.meta && callsData.meta.total > (callsData.data?.length ?? 0) && (
          <div className="px-5 py-3 border-t border-[var(--border)] text-center">
            <span className="text-xs text-[var(--text-muted)]">
              מציג {callsData.data.length} מתוך {callsData.meta.total}
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}
