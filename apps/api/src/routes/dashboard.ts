import { Router } from 'express';
import { z } from 'zod';
import { prisma, Prisma } from '@voice/db';
import { AppError } from '../middleware/error-handler';

const router = Router();

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  agentId: z.string().uuid().optional(),
});

router.get('/', async (req, res) => {
  const user = req.user!;
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, 'INVALID_PARAMS', 'Invalid query parameters');

  const { from, to, agentId } = parsed.data;
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  if (fromDate && isNaN(fromDate.getTime())) throw new AppError(400, 'INVALID_PARAMS', 'Invalid from date');
  if (toDate && isNaN(toDate.getTime())) throw new AppError(400, 'INVALID_PARAMS', 'Invalid to date');

  // Resolve agent IDs based on role
  let agentIds: string[] | null = null;

  if (agentId) {
    if (user.role === 'admin') {
      const agent = await prisma.agent.findFirst({ where: { id: agentId, userId: user.userId } });
      if (!agent) throw new AppError(403, 'FORBIDDEN', 'No access to this agent');
    }
    agentIds = [agentId];
  } else if (user.role === 'admin') {
    const agents = await prisma.agent.findMany({ where: { userId: user.userId }, select: { id: true } });
    agentIds = agents.map((a) => a.id);
    if (agentIds.length === 0) return res.json({ data: emptyStats() });
  }

  const callWhere = buildCallWhere(agentIds, fromDate, toDate);
  const apptWhere = buildApptWhere(agentIds, fromDate, toDate);

  const [inboundAgg, outboundAllAgg, outboundAnsweredCount, outboundNoAnswerCount, avgAgg, appointmentCount] =
    await Promise.all([
      prisma.call.aggregate({
        where: { ...callWhere, direction: 'inbound' },
        _count: { id: true },
        _sum: { durationSec: true },
      }),
      prisma.call.aggregate({
        where: { ...callWhere, direction: 'outbound' },
        _count: { id: true },
        _sum: { durationSec: true },
      }),
      prisma.call.count({ where: { ...callWhere, direction: 'outbound', status: 'completed' } }),
      prisma.call.count({ where: { ...callWhere, direction: 'outbound', status: { not: 'completed' } } }),
      prisma.call.aggregate({
        where: { ...callWhere, status: 'completed' },
        _avg: { durationSec: true },
      }),
      prisma.appointment.count({ where: apptWhere }),
    ]);

  const inboundCalls = inboundAgg._count.id;
  const inboundSec = inboundAgg._sum.durationSec ?? 0;
  const outboundCalls = outboundAllAgg._count.id;
  const outboundSec = outboundAllAgg._sum.durationSec ?? 0;
  const totalCalls = inboundCalls + outboundCalls;
  const totalSec = inboundSec + outboundSec;
  const avgDurationSec = Math.round(avgAgg._avg.durationSec ?? 0);
  const totalOutbound = outboundAnsweredCount + outboundNoAnswerCount;
  const completedCalls = outboundAnsweredCount + inboundCalls;

  res.json({
    data: {
      inboundCalls,
      inboundMinutes: Math.round(inboundSec / 60),
      outboundCalls,
      outboundMinutes: Math.round(outboundSec / 60),
      totalCalls,
      totalMinutes: Math.round(totalSec / 60),
      avgDurationSec,
      appointmentsBooked: appointmentCount,
      conversionRate: completedCalls > 0 ? Math.round((appointmentCount / completedCalls) * 100) : 0,
      outboundNoAnswer: outboundNoAnswerCount,
      outboundAnswerRate: totalOutbound > 0 ? Math.round((outboundAnsweredCount / totalOutbound) * 100) : 0,
    },
  });
});

function buildCallWhere(
  agentIds: string[] | null,
  from: Date | null,
  to: Date | null,
): Prisma.CallWhereInput {
  const where: Prisma.CallWhereInput = { status: { not: 'queued' } };
  if (agentIds) where.agentId = { in: agentIds };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }
  return where;
}

function buildApptWhere(
  agentIds: string[] | null,
  from: Date | null,
  to: Date | null,
): Prisma.AppointmentWhereInput {
  const where: Prisma.AppointmentWhereInput = {};
  if (agentIds) where.agentId = { in: agentIds };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }
  return where;
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

export default router;
