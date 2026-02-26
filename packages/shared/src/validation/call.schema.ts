import { z } from 'zod';

const israeliPhone = z.string().regex(/^\+972\d{8,9}$/, 'Must be Israeli phone: +972...');

export const createOutboundCallSchema = z.object({
  phone: israeliPhone,
  contact_name: z.string().max(100).optional(),
  gender: z.enum(['male', 'female', 'unknown']).optional(),
  context: z.record(z.unknown()).optional(),
});
