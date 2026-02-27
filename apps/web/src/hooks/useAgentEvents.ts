import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export function useAgentEvents(agentId: string | undefined, enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!agentId || !enabled) return;

    const url = `${api.defaults.baseURL}/agents/${agentId}/events`;
    const sse = new EventSource(url);

    sse.addEventListener('call_created', (e) => {
      try {
        const { call } = JSON.parse(e.data);
        qc.setQueryData(['agent-calls', agentId], (prev: any) => {
          if (!prev) return prev;
          // Avoid duplicates
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

    sse.onerror = () => {
      // EventSource automatically reconnects, but we can log it
      console.warn('SSE connection error, reconnecting...');
    };

    return () => {
      sse.close();
    };
  }, [agentId, enabled, qc]);
}
