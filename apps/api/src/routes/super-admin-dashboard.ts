import { Router } from 'express';
import { z } from 'zod';
import { prisma, Prisma } from '@voice/db';
import { requireSuperAdmin } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { calculateCosts, type CostBreakdownIls } from '../services/dashboard/cost-calculator';

const router = Router();

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

router.get('/', requireSuperAdmin, async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, 'INVALID_PARAMS', 'Invalid query parameters');

  const { from, to } = parsed.data;
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  if (fromDate && isNaN(fromDate.getTime())) throw new AppError(400, 'INVALID_PARAMS', 'Invalid from date');
  if (toDate && isNaN(toDate.getTime())) throw new AppError(400, 'INVALID_PARAMS', 'Invalid to date');

  const [pricing, agents, usageRows] = await Promise.all([
    prisma.pricingConfig.upsert({ where: { id: 'singleton' }, create: { id: 'singleton' }, update: {} }),
    prisma.agent.findMany({
      select: { id: true, name: true, user: { select: { name: true, companyName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    fetchUsageByAgent(fromDate, toDate),
  ]);

  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const usageMap = groupUsageByAgent(usageRows);

  const agentResults = await Promise.all(
    agents.map(async (agent) => {
      const usage = usageMap.get(agent.id);
      const costs = usage ? calculateCosts(usage, pricing) : zeroCosts();
      const perf = await fetchPerformance(agent.id, fromDate, toDate);
      const totalMin = perf.totalMinutes;
      const clientName = agent.user ? (agent.user.name || agent.user.companyName || agent.user.email) : null;

      return {
        id: agent.id,
        name: agent.name,
        clientName,
        calls: perf.totalCalls,
        minutes: totalMin,
        totalCostIls: costs.totalCost,
        costPerMinIls: totalMin > 0 ? round2(costs.totalCost / totalMin) : 0,
        performance: perf,
        costs: {
          ...costs,
          costPerCallIls: perf.totalCalls > 0 ? round2(costs.totalCost / perf.totalCalls) : 0,
          costPerMinIls: totalMin > 0 ? round2(costs.totalCost / totalMin) : 0,
        },
      };
    })
  );

  agentResults.sort((a, b) => b.totalCostIls - a.totalCostIls);

  const summary = {
    totalCostIls: round2(agentResults.reduce((s, a) => s + a.totalCostIls, 0)),
    totalCalls: agentResults.reduce((s, a) => s + a.calls, 0),
    totalMinutes: agentResults.reduce((s, a) => s + a.minutes, 0),
    avgCostPerMinIls: 0 as number,
  };
  summary.avgCostPerMinIls = summary.totalMinutes > 0 ? round2(summary.totalCostIls / summary.totalMinutes) : 0;

  res.json({ data: { summary, agents: agentResults } });
});

// --- Usage fetching ---

interface UsageRow {
  agent_id: string;
  total_audio_input_tokens: bigint;
  total_audio_output_tokens: bigint;
  total_text_input_tokens: bigint;
  total_text_output_tokens: bigint;
  total_summary_tokens: bigint;
  total_embedding_tokens: bigint;
  total_billed_sec: bigint;
  total_recording_sec: bigint;
  total_deepgram_sec: bigint;
}

async function fetchUsageByAgent(from: Date | null, to: Date | null) {
  const conditions = ['1=1'];
  if (from) {
    const ym = from.toISOString().slice(0, 7);
    conditions.push(`year_month >= '${ym}'`);
  }
  if (to) {
    const ym = to.toISOString().slice(0, 7);
    conditions.push(`year_month <= '${ym}'`);
  }

  return prisma.$queryRawUnsafe<UsageRow[]>(`
    SELECT
      agent_id,
      SUM(total_audio_input_tokens)::bigint AS total_audio_input_tokens,
      SUM(total_audio_output_tokens)::bigint AS total_audio_output_tokens,
      SUM(total_text_input_tokens)::bigint AS total_text_input_tokens,
      SUM(total_text_output_tokens)::bigint AS total_text_output_tokens,
      SUM(total_summary_tokens)::bigint AS total_summary_tokens,
      SUM(total_embedding_tokens)::bigint AS total_embedding_tokens,
      SUM(total_billed_sec)::bigint AS total_billed_sec,
      SUM(total_recording_sec)::bigint AS total_recording_sec,
      SUM(total_deepgram_sec)::bigint AS total_deepgram_sec
    FROM agent_usage_monthly
    WHERE ${conditions.join(' AND ')}
    GROUP BY agent_id
  `);
}

function groupUsageByAgent(rows: UsageRow[]) {
  const map = new Map<string, {
    totalAudioInputTokens: number; totalAudioOutputTokens: number;
    totalTextInputTokens: number; totalTextOutputTokens: number;
    totalSummaryTokens: number; totalEmbeddingTokens: number;
    totalBilledSec: number; totalRecordingSec: number; totalDeepgramSec: number;
  }>();
  for (const r of rows) {
    map.set(r.agent_id, {
      totalAudioInputTokens: Number(r.total_audio_input_tokens),
      totalAudioOutputTokens: Number(r.total_audio_output_tokens),
      totalTextInputTokens: Number(r.total_text_input_tokens),
      totalTextOutputTokens: Number(r.total_text_output_tokens),
      totalSummaryTokens: Number(r.total_summary_tokens),
      totalEmbeddingTokens: Number(r.total_embedding_tokens),
      totalBilledSec: Number(r.total_billed_sec),
      totalRecordingSec: Number(r.total_recording_sec),
      totalDeepgramSec: Number(r.total_deepgram_sec),
    });
  }
  return map;
}

// --- Performance fetching (same logic as admin dashboard, per-agent) ---

interface PerformanceStats {
  inboundCalls: number; inboundMinutes: number;
  outboundCalls: number; outboundMinutes: number;
  totalCalls: number; totalMinutes: number;
  avgDurationSec: number; appointmentsBooked: number;
  conversionRate: number; outboundNoAnswer: number; outboundAnswerRate: number;
}

async function fetchPerformance(agentId: string, from: Date | null, to: Date | null): Promise<PerformanceStats> {
  const dateFilter = from || to ? { ...(from && { gte: from }), ...(to && { lte: to }) } : undefined;

  const base: Prisma.CallWhereInput = { agentId, status: { not: 'queued' }, createdAt: dateFilter };
  const apptWhere: Prisma.AppointmentWhereInput = { agentId, ...(dateFilter && { createdAt: dateFilter }) };

  const [inAgg, outAgg, outAnswered, outNoAnswer, avgAgg, appts] = await Promise.all([
    prisma.call.aggregate({ where: { ...base, direction: 'inbound' }, _count: { id: true }, _sum: { durationSec: true } }),
    prisma.call.aggregate({ where: { ...base, direction: 'outbound' }, _count: { id: true }, _sum: { durationSec: true } }),
    prisma.call.count({ where: { ...base, direction: 'outbound', status: 'completed' } }),
    prisma.call.count({ where: { ...base, direction: 'outbound', status: { not: 'completed' } } }),
    prisma.call.aggregate({ where: { ...base, status: 'completed' }, _avg: { durationSec: true } }),
    prisma.appointment.count({ where: apptWhere }),
  ]);

  const inboundCalls = inAgg._count.id;
  const outboundCalls = outAgg._count.id;
  const inSec = inAgg._sum.durationSec ?? 0;
  const outSec = outAgg._sum.durationSec ?? 0;
  const totalCalls = inboundCalls + outboundCalls;
  const totalSec = inSec + outSec;
  const totalOutbound = outAnswered + outNoAnswer;
  const completed = outAnswered + inboundCalls;

  return {
    inboundCalls,
    inboundMinutes: Math.round(inSec / 60),
    outboundCalls,
    outboundMinutes: Math.round(outSec / 60),
    totalCalls,
    totalMinutes: Math.round(totalSec / 60),
    avgDurationSec: Math.round(avgAgg._avg.durationSec ?? 0),
    appointmentsBooked: appts,
    conversionRate: completed > 0 ? Math.round((appts / completed) * 100) : 0,
    outboundNoAnswer: outNoAnswer,
    outboundAnswerRate: totalOutbound > 0 ? Math.round((outAnswered / totalOutbound) * 100) : 0,
  };
}

function zeroCosts(): CostBreakdownIls {
  return { geminiAudioCost: 0, geminiTextCost: 0, embeddingCost: 0, telnyxCallCost: 0, telnyxRecordingCost: 0, deepgramCost: 0, totalCost: 0 };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export default router;
