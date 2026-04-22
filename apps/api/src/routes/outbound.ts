import { Router } from 'express';
import { prisma, Prisma } from '@voice/db';
import { createOutboundCallSchema } from '@voice/shared';
import { outboundQueue, OUTBOUND_PRIORITY } from '../lib/queue';
import { AppError } from '../middleware/error-handler';
import { apikeyMiddleware } from '../middleware/apikey';
import { normalizePhone } from '../lib/phone';
import { publishCallEvent } from '../services/events/pubsub';

const router = Router();

router.post('/v1/calls', apikeyMiddleware, async (req, res) => {
  const body = createOutboundCallSchema.parse(req.body);
  const agent = req.agent!;

  if (!agent.phoneNumber) throw new AppError(400, 'NO_PHONE', 'Agent has no phone number assigned');

  const phone = normalizePhone(body.phone);

  const contact = await prisma.contact.upsert({
    where: { phone_agentId: { phone, agentId: agent.id } },
    update: {
      ...(body.contact_name && { name: body.contact_name }),
      ...(body.gender && { gender: body.gender }),
    },
    create: {
      phone,
      agentId: agent.id,
      name: body.contact_name || null,
      gender: body.gender || null,
      metadata: body.context ? (body.context as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });

  const call = await prisma.call.create({
    data: {
      agentId: agent.id,
      contactId: contact.id,
      direction: 'outbound',
      status: 'queued',
      context: body.context ? (body.context as Prisma.InputJsonValue) : Prisma.DbNull,
    },
    include: { contact: { select: { phone: true, name: true } } },
  });

  await publishCallEvent(agent.id, 'call_created', { call });

  const priority = body.call_priority === 'campaign' ? OUTBOUND_PRIORITY.campaign : OUTBOUND_PRIORITY.lead;
  await outboundQueue.add(
    'dial',
    { callId: call.id, agentId: agent.id, contactId: contact.id, phone, context: body.context },
    { attempts: 2, backoff: { type: 'fixed', delay: 8000 }, priority },
  );

  res.status(201).json({ data: { call_id: call.id, status: 'queued' } });
});

export default router;
