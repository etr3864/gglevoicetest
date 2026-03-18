import type { ToolDefinition } from '../providers/types';
import type { ToolContext } from './registry';
import { sendMessage } from '../whatsapp/whatsapp.service';
import { createLogger } from '../../lib/logger';

const log = createLogger('whatsapp-tool');

export const SEND_WHATSAPP_DEFINITION: ToolDefinition = {
  name: 'send_whatsapp',
  description: 'Send a WhatsApp message to the customer. Use when they ask for written info (payment links, addresses, confirmations) or when your instructions say to send.',
  parameters: {
    message: { type: 'string', description: 'Message content to send via WhatsApp' },
  },
  required: ['message'],
};

export async function handleSendWhatsapp(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const text = typeof args.message === 'string' ? args.message.trim() : '';
  if (!text) return { sent: false, reason: 'Empty message' };
  if (!ctx.contactPhone) return { sent: false, reason: 'No contact phone in context' };

  try {
    await sendMessage(ctx.agentId, ctx.contactPhone, text, ctx.callId);
    return { sent: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown error';
    log.warn('send_whatsapp failed — WhatsApp connection issue', { agentId: ctx.agentId, reason });
    return {
      sent: false,
      reason: 'WhatsApp connection issue',
      verbalize: 'יש לי בעיה זמנית עם החיבור לוואטסאפ, אני אנסה שוב בקרוב.',
    };
  }
}
