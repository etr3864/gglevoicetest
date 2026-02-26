import { Router } from 'express';
import { prisma } from '@voice/db';
import { updateContactSchema } from '@voice/shared';
import { AppError } from '../middleware/error-handler';

const router = Router();

router.get('/agents/:id/contacts', async (req, res) => {
  const calls = await prisma.call.findMany({
    where: { agentId: req.params.id, contactId: { not: null } },
    select: { contactId: true },
    distinct: ['contactId'],
  });
  const contactIds = calls.map(c => c.contactId!);

  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds } },
    orderBy: { lastCallAt: 'desc' },
  });

  res.json({ data: contacts });
});

router.get('/contacts/:id', async (req, res) => {
  const contact = await prisma.contact.findUnique({ where: { id: req.params.id } });
  if (!contact) throw new AppError(404, 'NOT_FOUND', 'Contact not found');
  res.json({ data: contact });
});

router.get('/contacts/:id/appointments', async (req, res) => {
  const appointments = await prisma.appointment.findMany({
    where: { contactId: req.params.id },
    orderBy: { startTime: 'desc' },
    take: 20,
  });
  res.json({ data: appointments });
});

router.patch('/contacts/:id', async (req, res) => {
  const body = updateContactSchema.parse(req.body);
  const contact = await prisma.contact.update({ where: { id: req.params.id }, data: body });
  res.json({ data: contact });
});

router.delete('/contacts/:id', async (req, res) => {
  await prisma.contact.delete({ where: { id: req.params.id } });
  res.json({ data: { success: true } });
});

export default router;
