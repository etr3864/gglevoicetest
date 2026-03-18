import { Router } from 'express';
import { prisma } from '@voice/db';
import { reminderQueue } from '../lib/queue';
import { AppError } from '../middleware/error-handler';
import { assertAgentAccess } from '../middleware/auth';

const router = Router();

router.get('/:agentId/reminders', async (req, res) => {
  await assertAgentAccess(req.params.agentId, req.user!);

  const { agentId } = req.params;
  const status = req.query.status as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);

  const where = {
    agentId,
    ...(status ? { status } : {}),
  };

  const [reminders, total] = await Promise.all([
    prisma.scheduledReminder.findMany({
      where,
      orderBy: { scheduledFor: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        appointment: { select: { title: true, startTime: true } },
        contact: { select: { name: true, phone: true } },
        call: { select: { status: true, durationSec: true } },
      },
    }),
    prisma.scheduledReminder.count({ where }),
  ]);

  res.json({ data: reminders, meta: { total, page, limit } });
});

router.post('/:agentId/reminders/:reminderId/trigger', async (req, res) => {
  await assertAgentAccess(req.params.agentId, req.user!);

  const { agentId, reminderId } = req.params;
  const reminder = await prisma.scheduledReminder.findUnique({ where: { id: reminderId } });
  if (!reminder || reminder.agentId !== agentId) throw new AppError(404, 'NOT_FOUND', 'Reminder not found');
  if (reminder.status === 'CALLING') throw new AppError(409, 'ALREADY_CALLING', 'Reminder call is already in progress');
  if (reminder.status === 'COMPLETED') throw new AppError(409, 'ALREADY_COMPLETED', 'Reminder already completed');
  if (reminder.status === 'CANCELLED') throw new AppError(409, 'CANCELLED', 'Reminder is cancelled');

  await prisma.scheduledReminder.update({
    where: { id: reminderId },
    data: { status: 'PENDING' },
  });

  await reminderQueue.add(
    'call',
    { reminderId },
    { jobId: `reminder-${reminderId}-manual-${Date.now()}` },
  );

  res.json({ data: { triggered: true, reminderId } });
});

router.post('/:agentId/reminders/:reminderId/cancel', async (req, res) => {
  await assertAgentAccess(req.params.agentId, req.user!);

  const { agentId, reminderId } = req.params;
  const reminder = await prisma.scheduledReminder.findUnique({ where: { id: reminderId } });
  if (!reminder || reminder.agentId !== agentId) throw new AppError(404, 'NOT_FOUND', 'Reminder not found');
  if (reminder.status === 'CANCELLED') throw new AppError(409, 'ALREADY_CANCELLED', 'Reminder is already cancelled');
  if (reminder.status === 'COMPLETED') throw new AppError(409, 'ALREADY_COMPLETED', 'Cannot cancel completed reminder');

  if (reminder.bullmqJobId) {
    try { await reminderQueue.remove(reminder.bullmqJobId); } catch {}
  }

  await prisma.scheduledReminder.update({
    where: { id: reminderId },
    data: { status: 'CANCELLED' },
  });

  res.json({ data: { cancelled: true, reminderId } });
});

export default router;
