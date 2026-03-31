import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

const POLL_INTERVAL_MS = 5_000;
const SSE_RECONNECT_DELAY_MS = 3_000;

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
  const onNewCallRef = useRef(onNewCall);
  onNewCallRef.current = onNewCall;

  const [tokenKey, setTokenKey] = useState(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reconnect SSE immediately when token is refreshed by axios interceptor
  useEffect(() => {
    const handleTokenRefreshed = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setTokenKey((k) => k + 1);
    };
    window.addEventListener('token-refreshed', handleTokenRefreshed);
    return () => window.removeEventListener('token-refreshed', handleTokenRefreshed);
  }, []);

  useEffect(() => {
    if (!agentId || !enabled) return;

    const token = getAccessToken();
    const base = `${api.defaults.baseURL}/agents/${agentId}/events`;
    const url = token ? `${base}?token=${encodeURIComponent(token)}` : base;
    const sse = new EventSource(url);

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
      try { onNewCallRef.current?.(JSON.parse(e.data).call); } catch {}
    });

    sse.addEventListener('call_updated', (e) => {
      try { updateInCache(JSON.parse(e.data).call); } catch {}
    });

    sse.addEventListener('recording_ready', (e) => {
      try { updateInCache(JSON.parse(e.data).call); } catch {}
    });

    sse.onerror = () => {
      sse.close();
      // Ping the server — if token expired, axios interceptor refreshes it
      // and dispatches 'token-refreshed', which handles reconnect.
      // Schedule a fallback reconnect in case it was a transient network error.
      api.get('/auth/me').catch(() => {});
      if (!reconnectTimerRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          setTokenKey((k) => k + 1);
        }, SSE_RECONNECT_DELAY_MS);
      }
    };

    // fallback poll: only fires when SSE connection is actually down
    const pollTimer = setInterval(() => {
      if (sse.readyState !== EventSource.OPEN) {
        qc.invalidateQueries({ queryKey: ['calls', agentId], exact: false });
      }
    }, POLL_INTERVAL_MS);

    return () => {
      sse.close();
      clearInterval(pollTimer);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [agentId, enabled, qc, tokenKey]);
}
