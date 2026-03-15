import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

const POLL_INTERVAL_MS = 5_000;
const SSE_TIMEOUT_MS = 10_000; // if no heartbeat/event in 10s, treat SSE as dead

function getAccessToken(): string | null {
  try {
    const raw = localStorage.getItem('auth_tokens');
    if (!raw) return null;
    const { accessToken } = JSON.parse(raw);
    return accessToken ?? null;
  } catch {
    return null;
  }
}

export function useAgentEvents(agentId: string | undefined, enabled: boolean) {
  const qc = useQueryClient();
  const sseAliveRef = useRef(false);

  useEffect(() => {
    if (!agentId || !enabled) return;

    sseAliveRef.current = false;

    const token = getAccessToken();
    const base = `${api.defaults.baseURL}/agents/${agentId}/events`;
    const url = token ? `${base}?token=${encodeURIComponent(token)}` : base;
    const sse = new EventSource(url);

    const markAlive = () => { sseAliveRef.current = true; };

    sse.addEventListener('call_created', (e) => {
      markAlive();
      try {
        const { call } = JSON.parse(e.data);
        qc.setQueryData(['agent-calls', agentId], (prev: any) => {
          if (!prev) return prev;
          if (prev.data.some((c: any) => c.id === call.id)) return prev;
          return {
            ...prev,
            data: [call, ...prev.data],
            meta: { ...prev.meta, total: (prev.meta?.total || 0) + 1 },
          };
        });
      } catch (err) {
        console.error('Failed to parse call_created event', err);
      }
    });

    sse.addEventListener('call_updated', (e) => {
      markAlive();
      try {
        const { call } = JSON.parse(e.data);
        qc.setQueryData(['agent-calls', agentId], (prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            data: prev.data.map((c: any) => (c.id === call.id ? { ...c, ...call } : c)),
          };
        });
      } catch (err) {
        console.error('Failed to parse call_updated event', err);
      }
    });

    sse.addEventListener('recording_ready', (e) => {
      markAlive();
      try {
        const { call } = JSON.parse(e.data);
        qc.setQueryData(['agent-calls', agentId], (prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            data: prev.data.map((c: any) => (c.id === call.id ? { ...c, ...call } : c)),
          };
        });
      } catch (err) {
        console.error('Failed to parse recording_ready event', err);
      }
    });

    // Heartbeat from server keeps alive marker fresh
    sse.addEventListener('message', markAlive);
    sse.onerror = () => { sseAliveRef.current = false; };

    // Mark alive once connected
    sse.onopen = markAlive;

    // Fallback: poll every 5s if SSE hasn't received anything in SSE_TIMEOUT_MS
    const pollTimer = setInterval(() => {
      if (!sseAliveRef.current) {
        qc.invalidateQueries({ queryKey: ['agent-calls', agentId] });
      }
    }, POLL_INTERVAL_MS);

    // Give SSE time to establish before polling kicks in
    const warmupTimer = setTimeout(() => { sseAliveRef.current = sse.readyState === EventSource.OPEN; }, SSE_TIMEOUT_MS);

    return () => {
      sse.close();
      clearInterval(pollTimer);
      clearTimeout(warmupTimer);
    };
  }, [agentId, enabled, qc]);
}
