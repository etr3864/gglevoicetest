import { prisma } from '@voice/db';
import type { ToolDefinition } from '../providers/types';
import type { ToolContext } from './registry';
import { sendMessage, sendTemplateMessage, hasRecentInbound } from '../whatsapp/whatsapp.service';
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

export const SEND_WHATSAPP_TEMPLATE_DEFINITION: ToolDefinition = {
  name: 'send_whatsapp_template',
  description: 'Send a WhatsApp template message when a template is required (24h window has passed). Call this after receiving template_required from send_whatsapp.',
  parameters: {
    template_name: { type: 'string', description: 'Exact template name from the list' },
    language: { type: 'string', description: 'Template language code (e.g. he, en_US)' },
    variables: { type: 'object', description: 'Key-value pairs for template variables, e.g. {"1": "John", "2": "Monday"}' },
    media_item_id: { type: 'string', description: 'Media library item ID if template has a media header (optional)' },
  },
  required: ['template_name', 'language', 'variables'],
};

export async function handleSendWhatsapp(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  const text = typeof args.message === 'string' ? args.message.trim() : '';
  if (!text) return { sent: false, reason: 'Empty message' };
  if (!ctx.contactPhone) return { sent: false, reason: 'No contact phone in context' };

  const windowOpen = await hasRecentInbound(ctx.agentId, ctx.contactPhone);
  if (!windowOpen) {
    const templates = await getApprovedTemplates(ctx.agentId);
    if (templates.length === 0) {
      return { sent: false, reason: 'No recent customer message (24h window closed) and no approved templates available' };
    }
    return { sent: false, template_required: true, templates };
  }

  try {
    await sendMessage(ctx.agentId, ctx.contactPhone, text, ctx.callId);
    return { sent: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown error';
    log.warn('send_whatsapp failed', { agentId: ctx.agentId, reason });
    return { sent: false, reason: 'WhatsApp connection issue', verbalize: 'יש לי בעיה זמנית עם החיבור לוואטסאפ, אני אנסה שוב בקרוב.' };
  }
}

export async function handleSendWhatsappTemplate(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  const templateName = typeof args.template_name === 'string' ? args.template_name : '';
  const language = typeof args.language === 'string' ? args.language : '';
  const variables = (args.variables && typeof args.variables === 'object' && !Array.isArray(args.variables))
    ? (args.variables as Record<string, string>)
    : {};
  const mediaItemId = typeof args.media_item_id === 'string' ? args.media_item_id : undefined;

  if (!templateName || !language) return { sent: false, reason: 'Missing template_name or language' };
  if (!ctx.contactPhone) return { sent: false, reason: 'No contact phone in context' };

  try {
    await sendTemplateMessage(ctx.agentId, ctx.contactPhone, templateName, language, variables, mediaItemId, ctx.callId);
    return { sent: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown error';
    log.warn('send_whatsapp_template failed', { agentId: ctx.agentId, templateName, reason });
    return { sent: false, reason };
  }
}

async function getApprovedTemplates(agentId: string) {
  const templates = await prisma.whatsappTemplate.findMany({
    where: { agentId, status: 'APPROVED' },
    select: { name: true, language: true, category: true, description: true, components: true },
  });

  return templates.map((t) => {
    const comps = t.components as Array<{ type: string; text?: string; format?: string; buttons?: unknown[] }>;
    const body = comps.find((c) => c.type === 'BODY');
    const header = comps.find((c) => c.type === 'HEADER');
    const footer = comps.find((c) => c.type === 'FOOTER');
    const buttonsComp = comps.find((c) => c.type === 'BUTTONS');

    return {
      name: t.name,
      language: t.language,
      category: t.category,
      description: t.description ?? '',
      header: header ? { format: header.format, text: header.text } : null,
      body: body?.text ?? '',
      footer: footer?.text ?? null,
      buttons: buttonsComp?.buttons ?? [],
    };
  });
}
