import { useState, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import api from '../lib/api';
import { presetToRange, type TimePreset } from '../pages/Dashboard/components/TimeRangeFilter';
import type { DateRange } from '../components/ui/DateRangePicker';

export type DirectionFilter = 'all' | 'inbound' | 'outbound' | 'no_answer';

export function useCallsData(agentId: string | undefined) {
  const [preset, setPreset] = useState<TimePreset>('today');
  const [customRange, setCustomRange] = useState<DateRange>({ from: null, to: null });
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const { from, to } = presetToRange(preset, customRange);
  const activeQ = q.length >= 3 ? q : undefined;
  const apiDirection = direction === 'all' ? undefined : direction;

  // reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [from, to, direction, q]);

  const query = useQuery({
    queryKey: ['calls', agentId, { from, to, direction: apiDirection, q: activeQ ?? '', page }],
    queryFn: () =>
      api.get(`/agents/${agentId}/calls`, {
        params: { from, to, direction: apiDirection, q: activeQ, page, limit: 25 },
      }).then(r => r.data),
    enabled: !!agentId,
    placeholderData: keepPreviousData,
  });

  return {
    query,
    refetch: query.refetch,
    preset,
    setPreset,
    customRange,
    setCustomRange,
    direction,
    setDirection,
    q,
    setQ,
    page,
    goPage: setPage,
    clearFilters: () => { setPreset('all'); setDirection('all'); setQ(''); },
    from,
    to,
    apiDirection,
    activeQ: activeQ ?? '',
  };
}
