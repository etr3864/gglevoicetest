import { Router } from 'express';
import { prisma } from '@voice/db';

const router = Router();

router.get('/contacts/:contactId/whatsapp', async (req, res) => {
  const { contactId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const cursor = req.query.cursor as string | undefined;

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { phone: true },
  });

  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const where = cursor
    ? { contactPhone: contact.phone, id: { lt: cursor } }
    : { contactPhone: contact.phone };

  const messages = await prisma.whatsappMessage.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    select: {
      id: true,
      agentId: true,
      direction: true,
      status: true,
      content: true,
      providerMessageId: true,
      callId: true,
      createdAt: true,
    },
  });

  const hasMore = messages.length > limit;
  const data = hasMore ? messages.slice(0, limit) : messages;
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  res.json({ data: data.reverse(), nextCursor });
});

export default router;
