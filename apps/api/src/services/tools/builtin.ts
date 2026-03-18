import { prisma } from '@voice/db';
import { globalRegistry } from './registry';
import type { ToolContext } from './registry';
import { registerCalendarTools } from './calendar';
import { formatTimestamp } from '../../lib/date';
import { SEND_WHATSAPP_DEFINITION, handleSendWhatsapp } from './whatsapp-tool';

export function registerBuiltinTools(): void {
  registerCalendarTools();

  globalRegistry.register(SEND_WHATSAPP_DEFINITION, handleSendWhatsapp);
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
        const contact = await prisma.contact.findUnique({ where: { phone: ctx.contactPhone } });
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
      const contact = await prisma.contact.findUnique({ where: { phone: ctx.contactPhone } });
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
      name: 'update_contact',
      description: 'Update information about the current caller. Use whenever you learn new details like their name, email, or gender during the conversation.',
      parameters: {
        name: { type: 'string', description: 'Full name' },
        email: { type: 'string', description: 'Email address' },
        gender: { type: 'string', description: 'Gender: male / female' },
      },
    },
    async (args, ctx) => {
      if (!ctx.contactPhone) return { updated: false };
      const data: Record<string, string> = {};
      for (const key of ['name', 'email', 'gender'] as const) {
        if (typeof args[key] === 'string' && args[key].trim()) {
          data[key] = args[key].trim();
        }
      }
      if (Object.keys(data).length === 0) return { updated: false, reason: 'No fields provided' };
      await prisma.contact.update({
        where: { phone: ctx.contactPhone },
        data,
      });
      return { updated: true, fields: Object.keys(data) };
    }
  );
}
