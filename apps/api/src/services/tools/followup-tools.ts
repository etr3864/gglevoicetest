import { prisma } from '@voice/db';
import { globalRegistry } from './registry';
import type { ToolContext } from './registry';
import { redis } from '../../lib/redis';
import { optOutContact } from '../followup/followup.cancel';

const DNC_FLAG_TTL = 3600;

export function registerFollowupTools(): void {
  globalRegistry.register(
    {
      name: 'mark_do_not_call',
      description:
        'Mark the current contact as "do not call". Use ONLY when the customer explicitly asks to stop receiving calls, ' +
        'e.g. "don\'t call me again", "remove me from the list", "stop calling".',
      parameters: {
        reason: {
          type: 'string',
          description: 'Brief reason from the customer',
        },
      },
      required: ['reason'],
    },
    async (args, ctx) => markDoNotCall(args.reason as string, ctx),
  );

  globalRegistry.register(
    {
      name: 'schedule_callback',
      description:
        'Schedule a callback when the customer asks to be called back at a specific time. ' +
        'Use when they say things like "call me tomorrow at 2pm", "try again in the evening".',
      parameters: {
        date: {
          type: 'string',
          description: 'Callback date in YYYY-MM-DD format',
        },
        time: {
          type: 'string',
          description: 'Callback time in HH:MM format (24h)',
        },
        reason: {
          type: 'string',
          description: 'Why the customer wants a callback',
        },
      },
      required: ['date', 'time'],
    },
    async (args, ctx) =>
      scheduleCallback(
        args.date as string,
        args.time as string,
        args.reason as string | undefined,
        ctx,
      ),
  );
}

async function markDoNotCall(reason: string, ctx: ToolContext): Promise<unknown> {
  await prisma.call.update({
    where: { id: ctx.callId },
    data: { disposition: 'do_not_call' },
  });

  await redis.set(`dnc:${ctx.callId}`, '1', 'EX', DNC_FLAG_TTL);

  if (ctx.contactPhone) {
    const contact = await prisma.contact.findUnique({ where: { phone: ctx.contactPhone } });
    if (contact) {
      optOutContact(contact.id, ctx.agentId).catch(() => {});
    }
  }

  return { marked: true, reason };
}

async function scheduleCallback(
  date: string,
  time: string,
  reason: string | undefined,
  ctx: ToolContext,
): Promise<unknown> {
  const callbackTime = new Date(`${date}T${time}:00`);
  if (isNaN(callbackTime.getTime())) {
    return { error: 'Invalid date or time format' };
  }

  await prisma.call.update({
    where: { id: ctx.callId },
    data: {
      disposition: 'callback_requested',
      callbackTime,
    },
  });

  return { scheduled: true, callbackTime: callbackTime.toISOString(), reason };
}
