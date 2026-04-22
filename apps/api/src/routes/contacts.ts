import { Router } from 'express';
import { prisma } from '@voice/db';
import { updateContactSchema } from '@voice/shared';
import { AppError } from '../middleware/error-handler';
import { assertAgentAccess, requireSuperAdmin } from '../middleware/auth';

const router = Router();

router.get('/agents/:id/contacts', async (req, res) => {
  const agentId = req.params.id;
  await assertAgentAccess(agentId, req.user!);

  const contacts = await prisma.contact.findMany({
    where: { agentId },
    orderBy: { lastCallAt: 'desc' },
    include: {
      contactFollowups: {
        where: { agentId, status: { in: ['PENDING', 'SCHEDULED', 'EXECUTING'] } },
        select: { status: true, currentStepOrder: true, scheduledFor: true },
        take: 1,
      },
    },
  });

  res.json({ data: contacts });
});

router.get('/contacts/:id', async (req, res) => {
  const contact = await prisma.contact.findUnique({ where: { id: req.params.id } });
  if (!contact) throw new AppError(404, 'NOT_FOUND', 'Contact not found');

  if (req.user?.role !== 'super_admin') {
    const ownerUserId = req.user?.role === 'employee' && req.user?.parentId ? req.user.parentId : req.user?.userId;
    const hasAccess = await prisma.agent.findFirst({
      where: { id: contact.agentId, userId: ownerUserId },
      select: { id: true },
    });
    if (!hasAccess) throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: contact });
});

router.get('/contacts/:id/appointments', async (req, res) => {
  const contact = await prisma.contact.findUnique({ where: { id: req.params.id }, select: { id: true, agentId: true } });
  if (!contact) throw new AppError(404, 'NOT_FOUND', 'Contact not found');

  if (req.user?.role !== 'super_admin') {
    const ownerUserId = req.user?.role === 'employee' && req.user?.parentId ? req.user.parentId : req.user?.userId;
    const hasAccess = await prisma.agent.findFirst({
      where: { id: contact.agentId, userId: ownerUserId },
      select: { id: true },
    });
    if (!hasAccess) throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const appointments = await prisma.appointment.findMany({
    where: { contactId: req.params.id },
    orderBy: { startTime: 'desc' },
    take: 20,
  });
  res.json({ data: appointments });
});

router.patch('/contacts/:id', requireSuperAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  const body = updateContactSchema.parse(req.body);
  const contact = await prisma.contact.update({ where: { id }, data: body });
  res.json({ data: contact });
});

router.delete('/contacts/:id', requireSuperAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  await prisma.contact.delete({ where: { id } });
  res.json({ data: { success: true } });
});

export default router;
