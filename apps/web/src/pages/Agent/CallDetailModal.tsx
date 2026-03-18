import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Trash2, Clock, Phone, Play, Pause, Download, RefreshCw, FileText, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import api from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../lib/cn';

interface Props {
  callId: string;
  onClose: () => void;
}

export default function CallDetailModal({ callId, onClose }: Props) {
  const qc = useQueryClient();

  const { data: call } = useQuery({
    queryKey: ['call', callId],
    queryFn: () => api.get(`/calls/${callId}`).then(r => r.data.data),
  });

  const { data: utterances } = useQuery({
    queryKey: ['call-utterances', callId],
    queryFn: () => api.get(`/calls/${callId}/utterances`).then(r => r.data.data),
  });

  const { data: summaryData } = useQuery({
    queryKey: ['call-summary', callId],
    queryFn: () => api.get(`/calls/${callId}/summary`).then(r => r.data.data),
    enabled: call?.status === 'completed',
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/calls/${callId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-calls'] });
      onClose();
    },
  });

  const agentId = call?.agent?.id;
  const hasRecording = call?.recordingStatus === 'ready';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Button variant="danger" size="sm" onClick={() => { if (confirm('למחוק שיחה זו?')) remove.mutate(); }}>
              <Trash2 className="w-3.5 h-3.5" />
              מחק
            </Button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-[var(--text-primary)]">פרטי שיחה</h3>
            <Phone className="w-4 h-4 text-[var(--text-muted)]" />
          </div>
        </div>

        {call && (
          <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Badge variant={
                call.status === 'completed' ? 'success' :
                call.status === 'failed' ? 'danger' : 'info'
              }>
                {call.status}
              </Badge>
              <span title={call.direction === 'inbound' ? 'שיחה נכנסת' : 'שיחה יוצאת'}>
                {call.direction === 'inbound'
                  ? <PhoneIncoming className="w-3.5 h-3.5 text-blue-400" />
                  : <PhoneOutgoing className="w-3.5 h-3.5 text-[var(--accent)]" />}
              </span>
              {call.durationSec != null && (
                <span className="flex items-center gap-1 text-[var(--text-muted)]">
                  <Clock className="w-3.5 h-3.5" />
                  {call.durationSec}s
                </span>
              )}
            </div>
            <div className="text-left">
              <span className="text-[var(--text-primary)] font-medium">
                {call.contact?.name || call.contact?.phone || 'לא ידוע'}
              </span>
              <span className="text-[var(--text-muted)] mr-2">
                {new Date(call.createdAt).toLocaleString('he-IL')}
              </span>
            </div>
          </div>
        )}

        {agentId && hasRecording && (
          <AudioPlayer callId={callId} agentId={agentId} />
        )}

        {call && !hasRecording && call.status === 'completed' && (
          <div className="px-5 py-2 border-b border-[var(--border)]">
            <p className="text-xs text-[var(--text-muted)] text-right">הקלטה לא זמינה</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {summaryData !== undefined && (
            <SummarySection callId={callId} summary={summaryData} />
          )}

          <div className="space-y-3">
          {!utterances?.length && (
            <div className="text-center py-8 text-[var(--text-muted)]">אין תמליל לשיחה זו</div>
          )}
          {utterances?.map((u: any) => (
            <div
              key={u.id}
              className={`flex ${u.speaker === 'agent' ? 'justify-start' : 'justify-end'}`}
            >
              <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                u.speaker === 'agent'
                  ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-[var(--text-primary)]'
                  : 'bg-blue-500/10 border border-blue-500/20 text-[var(--text-primary)]'
              }`}>
                <div className="flex items-center justify-between gap-4 mb-1">
                  <span className="text-xs text-[var(--text-muted)]">
                    {call ? new Date(new Date(call.startedAt || call.createdAt).getTime() + u.startMs).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                  </span>
                  <span className={`text-xs font-medium ${
                    u.speaker === 'agent' ? 'text-[var(--accent)]' : 'text-blue-400'
                  }`}>
                    {u.speaker === 'agent' ? 'סוכן' : 'לקוח'}
                  </span>
                </div>
                <p dir="rtl">{u.text}</p>
              </div>
            </div>
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummarySection({ callId, summary }: { callId: string; summary: any }) {
  const qc = useQueryClient();

  const retry = useMutation({
    mutationFn: () => api.post(`/calls/${callId}/summary/webhook-retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['call-summary', callId] }),
  });

  const WEBHOOK_BADGES: Record<string, { label: string; variant: 'success' | 'danger' | 'warning' | 'neutral' }> = {
    SENT: { label: 'Webhook נשלח', variant: 'success' },
    FAILED: { label: 'Webhook נכשל', variant: 'danger' },
    PENDING: { label: 'Webhook ממתין', variant: 'warning' },
    NONE: { label: '', variant: 'neutral' },
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)]/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {summary === null ? (
            <span className="text-xs text-[var(--text-muted)]">לא נוצר סיכום לשיחה זו</span>
          ) : (
            <>
              {summary.webhookStatus && summary.webhookStatus !== 'NONE' && (
                <Badge variant={WEBHOOK_BADGES[summary.webhookStatus]?.variant ?? 'neutral'}>
                  {WEBHOOK_BADGES[summary.webhookStatus]?.label}
                </Badge>
              )}
              {summary.webhookStatus === 'FAILED' && (
                <button
                  onClick={() => retry.mutate()}
                  disabled={retry.isPending}
                  className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <RefreshCw className={cn('w-3 h-3', retry.isPending && 'animate-spin')} />
                  שלח שנית
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <span className="text-xs font-medium text-[var(--text-secondary)]">סיכום</span>
        </div>
      </div>

      {summary?.summaryText && (
        <p className="text-sm text-[var(--text-primary)] leading-relaxed" dir="rtl">
          {summary.summaryText}
        </p>
      )}
    </div>
  );
}

function AudioPlayer({ callId, agentId }: { callId: string; agentId: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    api.get(`/agents/${agentId}/calls/${callId}/recording`)
      .then(r => setAudioUrl(r.data.data.url))
      .catch(() => {});
  }, [callId, agentId]);

  useEffect(() => {
    if (!audioUrl) return;
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    audio.onloadedmetadata = () => setDuration(audio.duration);
    audio.ontimeupdate = () => setProgress(audio.currentTime);
    audio.onended = () => setIsPlaying(false);
    audio.onerror = async () => {
      try {
        const res = await api.get(`/agents/${agentId}/calls/${callId}/recording`);
        setAudioUrl(res.data.data.url);
      } catch {}
    };

    return () => { audio.pause(); audioRef.current = null; };
  }, [audioUrl, callId, agentId]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const onSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!duration) return;
    setProgress((parseFloat(e.target.value) / 100) * duration);
  };

  const onSliderCommit = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const val = parseFloat((e.target as HTMLInputElement).value);
    audio.currentTime = (val / 100) * duration;
  };

  const downloadAudio = async () => {
    try {
      const res = await api.get(`/agents/${agentId}/calls/${callId}/recording/download`);
      const a = document.createElement('a');
      a.href = res.data.data.url;
      a.download = `call-${callId}.mp3`;
      a.click();
    } catch {}
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-3 bg-[var(--bg-primary)]/40">
      <button
        onClick={togglePlay}
        disabled={!audioUrl}
        className="w-8 h-8 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-[var(--accent)] hover:bg-[var(--accent)]/30 transition-colors disabled:opacity-40"
      >
        {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
      </button>

      <span className="text-xs text-[var(--text-muted)] w-10 text-right tabular-nums">{fmt(progress)}</span>

      <input
        type="range"
        min={0}
        max={100}
        value={duration ? (progress / duration) * 100 : 0}
        onChange={onSliderChange}
        onMouseUp={onSliderCommit}
        onTouchEnd={onSliderCommit}
        className="flex-1 accent-violet-500 h-1"
        disabled={!audioUrl || !duration}
      />

      <span className="text-xs text-[var(--text-muted)] w-10 tabular-nums">{fmt(duration)}</span>

      <button
        onClick={downloadAudio}
        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        title="הורד MP3"
      >
        <Download className="w-4 h-4" />
      </button>
    </div>
  );
}
