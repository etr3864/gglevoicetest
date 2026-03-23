import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { searchMedia, getMediaItemById } from '../media/media.service';
import { getSignedUrl } from '../media/media-storage.service';
import { sendMediaMessage } from '../whatsapp/whatsapp.service';
import type { ToolDefinition } from '../providers/types';
import type { ToolHandler } from './registry';

const log = createLogger('media:tool');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MEDIA_PER_CALL = 10;

export const SEND_MEDIA_DEFINITION: ToolDefinition = {
  name: 'send_media',
  description:
    'Find and send a media file (image, video, document) to the customer via WhatsApp. ' +
    'Use when the customer asks for visual materials, price lists, documents or videos. ' +
    'Provide a descriptive query or the exact media ID from the media list. ' +
    'To send multiple items: call this tool separately for each one with a unique query or ID — never use an empty query.',
  parameters: {
    query: {
      type: 'string',
      description: 'Describe what to send (e.g. "price list", "product image", "tutorial video") or a media ID from the list.',
    },
    caption: {
      type: 'string',
      description: 'Optional custom message to send with the media. Overrides the default caption.',
    },
  },
  required: ['query'],
};

export const handleSendMedia: ToolHandler = async (args, ctx) => {
  const query = String(args.query ?? '').trim();
  const captionOverride = args.caption ? String(args.caption).trim() : undefined;

  if (!query) return { sent: false, reason: 'empty_query' };
  if (!ctx.contactPhone) return { sent: false, reason: 'no_contact_phone' };

  const agent = await prisma.agent.findUnique({
    where: { id: ctx.agentId },
    select: { mediaEnabled: true, whatsappProvider: true },
  });

  if (!agent?.mediaEnabled || !agent.whatsappProvider) {
    return { sent: false, reason: 'media_disabled' };
  }

  const sentCount = await prisma.whatsappMessage.count({
    where: { callId: ctx.callId, mediaItemId: { not: null } },
  });
  if (sentCount >= MAX_MEDIA_PER_CALL) {
    return { sent: false, reason: 'loop_protection' };
  }

  const item = UUID_RE.test(query)
    ? await getMediaItemById(ctx.agentId, query)
    : await searchMedia(ctx.agentId, query);

  if (!item) return { sent: false, reason: 'no_match' };

  const alreadySent = await prisma.whatsappMessage.findFirst({
    where: { callId: ctx.callId, mediaItemId: item.id },
  });
  if (alreadySent) return { sent: false, reason: 'already_sent_in_call', name: item.name };

  try {
    const mediaWithPath = await prisma.mediaItem.findUnique({
      where: { id: item.id },
      select: { id: true, mediaType: true, name: true, description: true, caption: true, gcsPath: true },
    });
    if (!mediaWithPath) return { sent: false, reason: 'not_found' };

    await sendMediaMessage(ctx.agentId, ctx.contactPhone, mediaWithPath, captionOverride, ctx.callId);

    log.info('Media sent', { agentId: ctx.agentId, itemId: item.id, name: item.name });
    return { sent: true, name: item.name, mediaType: item.mediaType };
  } catch (err) {
    log.error('Failed to send media', err, { agentId: ctx.agentId, itemId: item.id });
    return { sent: false, reason: 'send_failed' };
  }
};
