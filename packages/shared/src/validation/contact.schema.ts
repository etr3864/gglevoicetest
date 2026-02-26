import { z } from 'zod';

export const updateContactSchema = z.object({
  name: z.string().max(100).nullable().optional(),
  email: z.string().email().nullable().optional(),
  gender: z.enum(['male', 'female', 'unknown']).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});
