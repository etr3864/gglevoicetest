import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

const POLL_INTERVAL_MS = 5_000;
const SSE_RECONNECT_DELAY_MS = 3_000;
const SSE_RECONNECT_ON_TOKEN_MS = 100;

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

function buildSseUrl(agentId: string): string {
  const base = (api.defaults.baseURL ?? '').replace(/\/$/, '');
  return `${base}/agents/${agentId}/events`;
}

export function useAgentEvents(
  agentId: string | undefined,
  enabled: boolean,
  onNewCall?: (call: any) => void,
) {
  const qc = useQueryClient();
  const onNewCallRef = useRef(onNewCall);
  onNewCallRef.current = onNewCall;
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!agentId || !enabled) return;

    let destroyed = false;
    let connecting = false;
    let sseActive = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const updateInCache = (call: any) => {
      qc.setQueriesData(
        { queryKey: ['calls', agentId], exact: false },
        (prev: any) => prev
          ? { ...prev, data: prev.data.map((c: any) => c.id === call.id ? { ...c, ...call } : c) }
          : prev,
      );
    };

    const handleEvent = (type: string, data: string) => {
      try {
        const parsed = JSON.parse(data);
        if (type === 'call_created') {
          onNewCallRef.current?.(parsed.call);
          qc.invalidateQueries({ queryKey: ['calls', agentId], exact: false });
        }
        else if (type === 'call_updated' || type === 'recording_ready') {
          updateInCache(parsed.call);
          qc.invalidateQueries({ queryKey: ['calls', agentId], exact: false });
        }
        else if (type === 'reminder_updated') qc.invalidateQueries({ queryKey: ['agent-reminders', agentId] });
        else if (type === 'followup_updated') {
          qc.invalidateQueries({ queryKey: ['followup-stats', agentId] });
          qc.invalidateQueries({ queryKey: ['followup-active', agentId] });
        }
        else if (type === 'knowledge_updated') qc.invalidateQueries({ queryKey: ['knowledge', agentId] });
        else if (type === 'media_updated') qc.invalidateQueries({ queryKey: ['media', agentId] });
      } catch {}
    };

    const scheduleReconnect = (delay: number) => {
      if (destroyed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = async () => {
      if (destroyed || connecting) return;
      connecting = true;

      const token = getAccessToken();
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const response = await fetch(buildSseUrl(agentId), {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Accept: 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
          signal: abort.signal,
        });

        if (response.status === 401) {
          // Trigger token refresh via axios interceptor, then reconnect
          api.get('/auth/me').catch(() => {});
          connecting = false;
          scheduleReconnect(SSE_RECONNECT_DELAY_MS);
          return;
        }

        if (!response.ok || !response.body) {
          connecting = false;
          scheduleReconnect(SSE_RECONNECT_DELAY_MS);
          return;
        }

        sseActive = true;
        connecting = false;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const messages = buffer.split('\n\n');
          buffer = messages.pop() ?? '';

          for (const msg of messages) {
            if (!msg.trim()) continue;
            let eventType = 'message';
            let data = '';
            for (const line of msg.split('\n')) {
              if (line.startsWith('event:')) eventType = line.slice(6).trim();
              else if (line.startsWith('data:')) data = line.slice(5).trim();
            }
            if (data) handleEvent(eventType, data);
          }
        }

        reader.cancel().catch(() => {});
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          sseActive = false;
          connecting = false;
          return; // Reconnect handled by the aborter
        }
      }

      sseActive = false;
      connecting = false;
      scheduleReconnect(SSE_RECONNECT_DELAY_MS);
    };

    const onTokenRefreshed = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      abortRef.current?.abort();
      if (!destroyed) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, SSE_RECONNECT_ON_TOKEN_MS);
      }
    };
    window.addEventListener('token-refreshed', onTokenRefreshed);

    // Fallback poll: only fires when SSE is not active
    const pollTimer = setInterval(() => {
      if (!sseActive) {
        qc.invalidateQueries({ queryKey: ['calls', agentId], exact: false });
      }
    }, POLL_INTERVAL_MS);

    connect();

    return () => {
      destroyed = true;
      abortRef.current?.abort();
      clearInterval(pollTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener('token-refreshed', onTokenRefreshed);
    };
  }, [agentId, enabled, qc]);
}
