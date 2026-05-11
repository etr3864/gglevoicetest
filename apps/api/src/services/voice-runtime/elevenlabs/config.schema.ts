import { z } from 'zod';

export const ElevenLabsConfigSchema = z.object({
  voiceId: z.string().min(1),
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.8),
  speed: z.number().min(0.7).max(1.2).default(1.0),
  expressiveMode: z.boolean().default(true),
  temperature: z.number().min(0).max(1).default(0.5),
  turnTimeout: z.number().int().min(1).max(30).default(7),
  turnEagerness: z.enum(['low', 'normal', 'high']).default('normal'),
  silenceEndCallTimeout: z.number().int().min(-1).max(600).default(-1),
  softTimeoutSeconds: z.number().int().min(0).max(600).optional(),
  softTimeoutMessage: z.string().max(500).optional(),
});

export type ElevenLabsConfig = z.infer<typeof ElevenLabsConfigSchema>;

export const DEFAULT_ELEVENLABS_CONFIG: ElevenLabsConfig = {
  voiceId: '',
  stability: 0.5,
  similarityBoost: 0.8,
  speed: 1.0,
  expressiveMode: true,
  temperature: 0.5,
  turnTimeout: 7,
  turnEagerness: 'normal',
  silenceEndCallTimeout: -1,
};
