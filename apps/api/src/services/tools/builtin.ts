import { prisma } from '@voice/db';
import { globalRegistry } from './registry';
import type { ToolContext } from './registry';
import { registerCalendarTools } from './calendar';
import { registerFollowupTools } from './followup-tools';
import { formatTimestamp } from '../../lib/date';
import { SEND_WHATSAPP_DEFINITION, handleSendWhatsapp, SEND_WHATSAPP_TEMPLATE_DEFINITION, handleSendWhatsappTemplate } from './whatsapp-tool';
import {
  SEARCH_KNOWLEDGE_DEFINITION, handleSearchKnowledge,
  QUERY_TABLE_DEFINITION, handleQueryTable,
} from './knowledge-tool';
import { SEND_MEDIA_DEFINITION, handleSendMedia } from './media-tool';

export { SEARCH_KNOWLEDGE_DEFINITION, handleSearchKnowledge, QUERY_TABLE_DEFINITION, handleQueryTable };
export { SEND_MEDIA_DEFINITION };

export function registerBuiltinTools(): void {
  registerCalendarTools();
  registerFollowupTools();

  globalRegistry.register(SEND_WHATSAPP_DEFINITION, handleSendWhatsapp);
  globalRegistry.register(SEND_WHATSAPP_TEMPLATE_DEFINITION, handleSendWhatsappTemplate);
  globalRegistry.register(SEARCH_KNOWLEDGE_DEFINITION, handleSearchKnowledge);
  globalRegistry.register(QUERY_TABLE_DEFINITION, handleQueryTable);
  globalRegistry.register(SEND_MEDIA_DEFINITION, handleSendMedia);
  globalRegistry.register(
    {
      name: 'end_call',
      description: 'End the current phone call gracefully. Use when the conversation is complete or the customer wants to hang up.',
      parameters: {
        reason: {
          type: 'string',
          description: 'Reason for ending the call',
        },
      },
      required: ['reason'],
    },
    async (args, ctx) => {
      return { action: 'end_call', reason: args.reason };
    }
  );

  globalRegistry.register(
    {
      name: 'transfer_call',
      description: 'Transfer the call to a human operator or another department.',
      parameters: {
        department: {
          type: 'string',
          description: 'Department or person to transfer to',
        },
        reason: {
          type: 'string',
          description: 'Reason for transfer',
        },
      },
      required: ['department'],
    },
    async (args, _ctx) => {
      return { action: 'transfer_call', department: args.department, reason: args.reason };
    }
  );

  globalRegistry.register(
    {
      name: 'save_note',
      description: 'Save an important note or piece of information from the conversation. Use to record key details like names, dates, requests.',
      parameters: {
        content: {
          type: 'string',
          description: 'Note content to save',
        },
      },
      required: ['content'],
    },
    async (args, ctx) => {
      if (ctx.contactPhone) {
        const contact = await prisma.contact.findFirst({ where: { phone: ctx.contactPhone, agentId: ctx.agentId } });
        if (contact) {
          const existing = contact.notes || '';
          const timestamp = formatTimestamp(new Date());
          const newNotes = `${existing}\n[${timestamp}] ${args.content}`.trim();
          await prisma.contact.update({
            where: { id: contact.id },
            data: { notes: newNotes },
          });
          return { saved: true };
        }
      }
      return { saved: false, reason: 'No contact found' };
    }
  );

  globalRegistry.register(
    {
      name: 'get_contact_info',
      description: 'Retrieve information about the current caller from the database.',
      parameters: {},
    },
    async (_args, ctx) => {
      if (!ctx.contactPhone) return { found: false };
      const contact = await prisma.contact.findFirst({ where: { phone: ctx.contactPhone, agentId: ctx.agentId } });
      if (!contact) return { found: false };
      return {
        found: true,
        name: contact.name,
        email: contact.email,
        totalCalls: contact.totalCalls,
        notes: contact.notes,
      };
    }
  );

  globalRegistry.register(
    {
      name: 'save_contact',
      description:
        'Save or update contact details for the current caller when you learn new information during the conversation. ' +
        'Provide any details you know — name, email, gender. All fields are optional.',
      parameters: {
        name:   { type: 'string', description: 'Full name' },
        email:  { type: 'string', description: 'Email address' },
        gender: { type: 'string', description: 'male / female' },
        notes:  { type: 'string', description: 'Any relevant notes about this contact' },
      },
    },
    async (args, ctx) => {
      if (!ctx.contactPhone) return { saved: false, reason: 'no_phone' };
      const data: Record<string, string> = {};
      for (const key of ['name', 'email', 'gender', 'notes'] as const) {
        if (typeof args[key] === 'string' && (args[key] as string).trim()) {
          data[key] = (args[key] as string).trim();
        }
      }
      const contact = await prisma.contact.upsert({
        where:  { phone_agentId: { phone: ctx.contactPhone, agentId: ctx.agentId } },
        create: { phone: ctx.contactPhone, agentId: ctx.agentId, ...data },
        update: data,
        select: { id: true, name: true },
      });
      return { saved: true, contactId: contact.id, name: contact.name ?? null };
    }
  );

  globalRegistry.register(
    {
      name: 'update_contact',
      description: 'Update information about the current caller. Use whenever you learn new details like their name, email, or gender during the conversation.',
      parameters: {
        name:   { type: 'string', description: 'Full name' },
        email:  { type: 'string', description: 'Email address' },
        gender: { type: 'string', description: 'Gender: male / female' },
      },
    },
    async (args, ctx) => {
      if (!ctx.contactPhone) return { updated: false };
      const data: Record<string, string> = {};
      for (const key of ['name', 'email', 'gender'] as const) {
        if (typeof args[key] === 'string' && (args[key] as string).trim()) {
          data[key] = (args[key] as string).trim();
        }
      }
      if (Object.keys(data).length === 0) return { updated: false, reason: 'No fields provided' };
      await prisma.contact.upsert({
        where:  { phone_agentId: { phone: ctx.contactPhone, agentId: ctx.agentId } },
        create: { phone: ctx.contactPhone, agentId: ctx.agentId, ...data },
        update: data,
      });
      return { updated: true, fields: Object.keys(data) };
    }
  );
}
