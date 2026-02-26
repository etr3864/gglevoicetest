import { z } from 'zod';

export const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  basePrompt: z.string().max(25000).optional(),
});

const timeSlotSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
}).nullable();

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  basePrompt: z.string().max(25000).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  voice: z.string().max(50).optional(),
  phoneNumber: z.string().max(20).nullable().optional(),
  telnyxPhoneId: z.string().max(100).nullable().optional(),
  telnyxAppId: z.string().max(100).nullable().optional(),
  activeHours: z.record(timeSlotSchema).nullable().optional(),
  calendarInstructions: z.string().max(5000).nullable().optional(),
  businessHours: z.record(timeSlotSchema).nullable().optional(),
});
