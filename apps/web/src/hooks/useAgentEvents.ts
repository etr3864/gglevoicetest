import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

const POLL_INTERVAL_MS = 5_000;
const SSE_TIMEOUT_MS = 10_000;

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

export function useAgentEvents(
  agentId: string | undefined,
  enabled: boolean,
  onNewCall?: (call: any) => void,
) {
  const qc = useQueryClient();
  const sseAliveRef = useRef(false);
  // keep callback ref stable to avoid reconnecting SSE on every render
  const onNewCallRef = useRef(onNewCall);
  onNewCallRef.current = onNewCall;

  useEffect(() => {
    if (!agentId || !enabled) return;

    sseAliveRef.current = false;

    const token = getAccessToken();
    const base = `${api.defaults.baseURL}/agents/${agentId}/events`;
    const url = token ? `${base}?token=${encodeURIComponent(token)}` : base;
    const sse = new EventSource(url);

    const markAlive = () => { sseAliveRef.current = true; };

    // map-only: updates existing call in any cached page; never inserts
    const updateInCache = (call: any) => {
      qc.setQueriesData(
        { queryKey: ['calls', agentId], exact: false },
        (prev: any) => prev
          ? { ...prev, data: prev.data.map((c: any) => c.id === call.id ? { ...c, ...call } : c) }
          : prev,
      );
    };

    sse.addEventListener('call_created', (e) => {
      markAlive();
      try { onNewCallRef.current?.(JSON.parse(e.data).call); } catch {}
    });

    sse.addEventListener('call_updated', (e) => {
      markAlive();
      try { updateInCache(JSON.parse(e.data).call); } catch {}
    });

    sse.addEventListener('recording_ready', (e) => {
      markAlive();
      try { updateInCache(JSON.parse(e.data).call); } catch {}
    });

    sse.addEventListener('message', markAlive);
    sse.onerror = () => { sseAliveRef.current = false; };
    sse.onopen = markAlive;

    const pollTimer = setInterval(() => {
      if (!sseAliveRef.current) {
        qc.invalidateQueries({ queryKey: ['calls', agentId], exact: false });
      }
    }, POLL_INTERVAL_MS);

    const warmupTimer = setTimeout(() => {
      sseAliveRef.current = sse.readyState === EventSource.OPEN;
    }, SSE_TIMEOUT_MS);

    return () => {
      sse.close();
      clearInterval(pollTimer);
      clearTimeout(warmupTimer);
    };
  }, [agentId, enabled, qc]);
}
