import { Router } from 'express';
import { prisma } from '@voice/db';
import { AppError } from '../middleware/error-handler';
import { assertAgentAccess } from '../middleware/auth';
import { redis } from '../lib/redis';
import { followupQueue } from '../lib/queue';

const router = Router({ mergeParams: true });

type Params = { agentId: string; stepId?: string; followupId?: string; contactId?: string };

const MAX_GENERAL_INSTRUCTION = 2000;
const MAX_STEP_INSTRUCTION = 1000;
const MAX_OPENING_MESSAGE = 500;
const MIN_DELAY_MINUTES = 30;

// --- Config ---

router.get('/followup/config', async (req, res) => {
  const { agentId } = req.params as Params;
  await assertAgentAccess(agentId, req.user!);

  const config = await prisma.followupConfig.findUnique({
    where: { agentId },
    include: { steps: { orderBy: { order: 'asc' } } },
  });

  res.json({ data: config });
});

router.put('/followup/config', async (req, res) => {
  const { agentId } = req.params as Params;
  await assertAgentAccess(agentId, req.user!);

  const { enabled, generalInstruction, activeHoursStart, activeHoursEnd, smartTimingEnabled, smartTimingMinCalls, minCallbackMinutes, callbackOpeningMessage } =
    req.body;

  if (generalInstruction && generalInstruction.length > MAX_GENERAL_INSTRUCTION) {
    throw new AppError(400, 'VALIDATION_ERROR', `generalInstruction max ${MAX_GENERAL_INSTRUCTION} chars`);
  }
  if (activeHoursStart && activeHoursEnd && activeHoursStart >= activeHoursEnd) {
    throw new AppError(400, 'VALIDATION_ERROR', 'activeHoursStart must be before activeHoursEnd');
  }
  if (minCallbackMinutes !== undefined && (minCallbackMinutes < 1 || minCallbackMinutes > 1440)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'minCallbackMinutes must be between 1 and 1440');
  }
  if (callbackOpeningMessage && callbackOpeningMessage.length > MAX_OPENING_MESSAGE) {
    throw new AppError(400, 'VALIDATION_ERROR', `callbackOpeningMessage max ${MAX_OPENING_MESSAGE} chars`);
  }

  const config = await prisma.followupConfig.upsert({
    where: { agentId },
    create: {
      agentId,
      enabled: enabled ?? false,
      generalInstruction: generalInstruction ?? '',
      activeHoursStart: activeHoursStart ?? '09:00',
      activeHoursEnd: activeHoursEnd ?? '21:00',
      smartTimingEnabled: smartTimingEnabled ?? true,
      smartTimingMinCalls: smartTimingMinCalls ?? 3,
      minCallbackMinutes: minCallbackMinutes ?? 5,
      callbackOpeningMessage: callbackOpeningMessage ?? null,
    },
    update: {
      ...(enabled !== undefined && { enabled }),
      ...(generalInstruction !== undefined && { generalInstruction }),
      ...(activeHoursStart !== undefined && { activeHoursStart }),
      ...(activeHoursEnd !== undefined && { activeHoursEnd }),
      ...(smartTimingEnabled !== undefined && { smartTimingEnabled }),
      ...(smartTimingMinCalls !== undefined && { smartTimingMinCalls }),
      ...(minCallbackMinutes !== undefined && { minCallbackMinutes }),
      ...(callbackOpeningMessage !== undefined && { callbackOpeningMessage }),
    },
    include: { steps: { orderBy: { order: 'asc' } } },
  });

  res.json({ data: config });
});

// --- Steps (static route first, then dynamic) ---

router.post('/followup/steps', async (req, res) => {
  const { agentId } = req.params as Params;
  await assertAgentAccess(agentId, req.user!);

  const { delayMinutes, instruction, openingMessage } = req.body;

  if (!delayMinutes || delayMinutes < MIN_DELAY_MINUTES) {
    throw new AppError(400, 'VALIDATION_ERROR', `delayMinutes must be >= ${MIN_DELAY_MINUTES}`);
  }
  if (!instruction || typeof instruction !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', 'instruction is required');
  }
  if (instruction.length > MAX_STEP_INSTRUCTION) {
    throw new AppError(400, 'VALIDATION_ERROR', `instruction max ${MAX_STEP_INSTRUCTION} chars`);
  }
  if (openingMessage && openingMessage.length > MAX_OPENING_MESSAGE) {
    throw new AppError(400, 'VALIDATION_ERROR', `openingMessage max ${MAX_OPENING_MESSAGE} chars`);
  }

  const config = await prisma.followupConfig.findUnique({ where: { agentId } });
  if (!config) throw new AppError(404, 'NOT_FOUND', 'Followup config not found. Create config first.');

  let step;
  try {
    const result = await prisma.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX("order") as max FROM "followup_steps" WHERE "followup_config_id" = ${config.id}
    `;
    const nextOrder = (result[0]?.max ?? 0) + 1;
    step = await prisma.followupStep.create({
      data: { followupConfigId: config.id, order: nextOrder, delayMinutes, instruction, openingMessage: openingMessage ?? null },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw new AppError(409, 'CONFLICT', 'Step order conflict, please retry');
    }
    throw err;
  }

  res.status(201).json({ data: step });
});

router.put('/followup/steps/reorder', async (req, res) => {
  const { agentId } = req.params as Params;
  await assertAgentAccess(agentId, req.user!);

  const { stepIds } = req.body as { stepIds: string[] };
  if (!Array.isArray(stepIds) || stepIds.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'stepIds array is required');
  }

  const config = await prisma.followupConfig.findUnique({ where: { agentId } });
  if (!config) throw new AppError(404, 'NOT_FOUND', 'Followup config not found');

  const ownedSteps = await prisma.followupStep.findMany({
    where: { followupConfigId: config.id },
    select: { id: true },
  });
  const ownedIds = new Set(ownedSteps.map(s => s.id));
  if (stepIds.some(id => !ownedIds.has(id))) {
    throw new AppError(403, 'FORBIDDEN', 'One or more step IDs do not belong to this agent');
  }

  await prisma.$transaction(
    stepIds.map((id, idx) =>
      prisma.followupStep.update({
        where: { id },
        data: { order: idx + 1 },
      })
    )
  );

  const steps = await prisma.followupStep.findMany({
    where: { followupConfigId: config.id },
    orderBy: { order: 'asc' },
  });

  res.json({ data: steps });
});

router.put('/followup/steps/:stepId', async (req, res) => {
  const { agentId, stepId } = req.params as Params;
  await assertAgentAccess(agentId, req.user!);

  const { delayMinutes, instruction, openingMessage } = req.body;

  if (delayMinutes !== undefined && delayMinutes < MIN_DELAY_MINUTES) {
    throw new AppError(400, 'VALIDATION_ERROR', `delayMinutes must be >= ${MIN_DELAY_MINUTES}`);
  }
  if (instruction !== undefined && instruction.length > MAX_STEP_INSTRUCTION) {
    throw new AppError(400, 'VALIDATION_ERROR', `instruction max ${MAX_STEP_INSTRUCTION} chars`);
  }
  if (openingMessage !== undefined && openingMessage !== null && openingMessage.length > MAX_OPENING_MESSAGE) {
    throw new AppError(400, 'VALIDATION_ERROR', `openingMessage max ${MAX_OPENING_MESSAGE} chars`);
  }

  const step = await prisma.followupStep.findUnique({ where: { id: stepId } });
  if (!step) throw new AppError(404, 'NOT_FOUND', 'Step not found');

  const updated = await prisma.followupStep.update({
    where: { id: stepId },
    data: {
      ...(delayMinutes !== undefined && { delayMinutes }),
      ...(instruction !== undefined && { instruction }),
      ...(openingMessage !== undefined && { openingMessage }),
    },
  });

  res.json({ data: updated });
});

router.delete('/followup/steps/:stepId', async (req, res) => {
  const { agentId, stepId } = req.params as Params;
  await assertAgentAccess(agentId, req.user!);

  const step = await prisma.followupStep.findUnique({ where: { id: stepId } });
  if (!step) throw new AppError(404, 'NOT_FOUND', 'Step not found');

  await prisma.followupStep.delete({ where: { id: stepId } });

  res.json({ data: { deleted: true } });
});

// --- Active followups ---

router.get('/followup/active', async (req, res) => {
  const { agentId } = req.params as Params;
  await assertAgentAccess(agentId, req.user!);

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const status = req.query.status as string | undefined;

  const where = {
    agentId,
    ...(status ? { status } : { status: { in: ['PENDING', 'SCHEDULED', 'EXECUTING'] } }),
  };

  const [followups, total] = await Promise.all([
    prisma.contactFollowup.findMany({
      where,
      orderBy: { scheduledFor: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        contact: { select: { name: true, phone: true } },
      },
    }),
    prisma.contactFollowup.count({ where }),
  ]);

  res.json({ data: followups, meta: { total, page, limit } });
});

router.post('/followup/active/:followupId/cancel', async (req, res) => {
  const { agentId, followupId } = req.params as Params;
  await assertAgentAccess(agentId, req.user!);

  const followup = await prisma.contactFollowup.findUnique({ where: { id: followupId } });
  if (!followup || followup.agentId !== agentId) {
    throw new AppError(404, 'NOT_FOUND', 'Followup not found');
  }
  if (followup.status === 'CANCELLED' || followup.status === 'COMPLETED' || followup.status === 'OPTED_OUT') {
    throw new AppError(409, 'INVALID_STATUS', `Cannot cancel followup with status ${followup.status}`);
  }

  if (followup.bullmqJobId) {
    try { await followupQueue.remove(followup.bullmqJobId); } catch {}
  }

  await prisma.contactFollowup.update({
    where: { id: followupId },
    data: { status: 'CANCELLED' },
  });

  res.json({ data: { cancelled: true } });
});

// --- Re-enable opted-out contact ---

router.post('/followup/contacts/:contactId/re-enable', async (req, res) => {
  const { agentId, contactId } = req.params as Params;
  await assertAgentAccess(agentId, req.user!);

  const result = await prisma.contactFollowup.updateMany({
    where: { contactId, agentId, status: 'OPTED_OUT' },
    data: { status: 'CANCELLED' },
  });

  if (result.count === 0) {
    throw new AppError(404, 'NOT_FOUND', 'No opted-out followup found for this contact');
  }

  res.json({ data: { reEnabled: true, updatedCount: result.count } });
});

// --- Upcoming (next 5 scheduled) ---

router.get('/followup/upcoming', async (req, res) => {
  const { agentId } = req.params as Params;
  await assertAgentAccess(agentId, req.user!);

  const upcoming = await prisma.contactFollowup.findMany({
    where: { agentId, status: 'SCHEDULED' },
    orderBy: { scheduledFor: 'asc' },
    take: 5,
    include: {
      contact: { select: { name: true, phone: true } },
    },
  });

  res.json({ data: upcoming });
});

// --- Stats (cached in Redis) ---

router.get('/followup/stats', async (req, res) => {
  const { agentId } = req.params as Params;
  await assertAgentAccess(agentId, req.user!);

  const cacheKey = `followup-stats:${agentId}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return res.json({ data: JSON.parse(cached) });
  }

  const [pending, scheduled, executing, completed, optedOut] = await Promise.all([
    prisma.contactFollowup.count({ where: { agentId, status: 'PENDING' } }),
    prisma.contactFollowup.count({ where: { agentId, status: 'SCHEDULED' } }),
    prisma.contactFollowup.count({ where: { agentId, status: 'EXECUTING' } }),
    prisma.contactFollowup.count({ where: { agentId, status: 'COMPLETED' } }),
    prisma.contactFollowup.count({ where: { agentId, status: 'OPTED_OUT' } }),
  ]);

  const stats = { pending, scheduled, executing, completed, optedOut };
  await redis.set(cacheKey, JSON.stringify(stats), 'EX', 300);

  res.json({ data: stats });
});

export default router;
