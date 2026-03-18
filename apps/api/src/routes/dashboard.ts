import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@voice/db';
import { AppError } from '../middleware/error-handler';

const router = Router();

const querySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  agentId: z.string().uuid().optional(),
});

router.get('/', async (req, res) => {
  const user = req.user!;
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, 'INVALID_PARAMS', 'Invalid query parameters');

  const { from, to, agentId } = parsed.data;

  // Build agent ID filter based on role
  let agentIds: string[] | null = null;

  if (agentId) {
    // Verify access if specific agent requested
    if (user.role === 'admin') {
      const agent = await prisma.agent.findFirst({ where: { id: agentId, userId: user.userId } });
      if (!agent) throw new AppError(403, 'FORBIDDEN', 'No access to this agent');
    }
    agentIds = [agentId];
  } else if (user.role === 'admin') {
    const agents = await prisma.agent.findMany({
      where: { userId: user.userId },
      select: { id: true },
    });
    agentIds = agents.map((a) => a.id);
    if (agentIds.length === 0) {
      return res.json({ data: emptyStats() });
    }
  }
  // super_admin with no agentId = all agents, agentIds stays null

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  const dateFilter = buildDateFilter(fromDate, toDate);
  const agentFilter = agentIds ? `AND c.agent_id = ANY(ARRAY[${agentIds.map((id) => `'${id}'`).join(',')}]::uuid[])` : '';

  const [callStats, appointmentCount] = await Promise.all([
    prisma.$queryRawUnsafe<CallStatsRow[]>(`
      SELECT
        COUNT(*) FILTER (WHERE c.direction = 'inbound')::int                                AS inbound_calls,
        COALESCE(SUM(c.duration_sec) FILTER (WHERE c.direction = 'inbound'), 0)::int        AS inbound_sec,
        COUNT(*) FILTER (WHERE c.direction = 'outbound')::int                               AS outbound_calls,
        COALESCE(SUM(c.duration_sec) FILTER (WHERE c.direction = 'outbound'), 0)::int       AS outbound_sec,
        COUNT(*)::int                                                                        AS total_calls,
        COALESCE(SUM(c.duration_sec), 0)::int                                               AS total_sec,
        COALESCE(AVG(c.duration_sec) FILTER (WHERE c.status = 'completed'), 0)::int         AS avg_sec,
        COUNT(*) FILTER (WHERE c.direction = 'outbound' AND c.status != 'completed')::int   AS outbound_no_answer,
        COUNT(*) FILTER (WHERE c.direction = 'outbound' AND c.status = 'completed')::int    AS outbound_answered
      FROM calls c
      WHERE c.status != 'queued'
      ${agentFilter}
      ${dateFilter}
    `),
    prisma.$queryRawUnsafe<AppointmentRow[]>(`
      SELECT COUNT(*)::int AS count
      FROM appointments a
      WHERE 1=1
      ${agentIds ? `AND a.agent_id = ANY(ARRAY[${agentIds.map((id) => `'${id}'`).join(',')}]::uuid[])` : ''}
      ${buildDateFilter(fromDate, toDate, 'a.created_at')}
    `),
  ]);

  const s = callStats[0];
  const totalOutbound = (s.outbound_answered ?? 0) + (s.outbound_no_answer ?? 0);
  const appointments = appointmentCount[0]?.count ?? 0;
  const completedCalls = s.outbound_answered + (callStats[0].inbound_calls ?? 0);

  res.json({
    data: {
      inboundCalls: s.inbound_calls,
      inboundMinutes: Math.round(s.inbound_sec / 60),
      outboundCalls: s.outbound_calls,
      outboundMinutes: Math.round(s.outbound_sec / 60),
      totalCalls: s.total_calls,
      totalMinutes: Math.round(s.total_sec / 60),
      avgDurationSec: s.avg_sec,
      appointmentsBooked: appointments,
      conversionRate: completedCalls > 0 ? Math.round((appointments / completedCalls) * 100) : 0,
      outboundNoAnswer: s.outbound_no_answer,
      outboundAnswerRate: totalOutbound > 0 ? Math.round((s.outbound_answered / totalOutbound) * 100) : 0,
    },
  });
});

function buildDateFilter(from: Date | null, to: Date | null, col = 'c.created_at'): string {
  const parts: string[] = [];
  if (from) parts.push(`AND ${col} >= '${from.toISOString()}'`);
  if (to) parts.push(`AND ${col} <= '${to.toISOString()}'`);
  return parts.join(' ');
}

function emptyStats() {
  return {
    inboundCalls: 0, inboundMinutes: 0,
    outboundCalls: 0, outboundMinutes: 0,
    totalCalls: 0, totalMinutes: 0,
    avgDurationSec: 0, appointmentsBooked: 0,
    conversionRate: 0, outboundNoAnswer: 0, outboundAnswerRate: 0,
  };
}

interface CallStatsRow {
  inbound_calls: number;
  inbound_sec: number;
  outbound_calls: number;
  outbound_sec: number;
  total_calls: number;
  total_sec: number;
  avg_sec: number;
  outbound_no_answer: number;
  outbound_answered: number;
}

interface AppointmentRow {
  count: number;
}

export default router;
