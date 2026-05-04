import { z } from 'zod';

const modelConfigSchema = z.object({
  generation: z.object({
    temperature: z.number().min(0).max(2),
    maxOutputTokens: z.number().int().min(1).max(8192).optional(),
    topP: z.number().min(0).max(1).optional(),
    presencePenalty: z.number().min(-2).max(2).optional(),
    frequencyPenalty: z.number().min(-2).max(2).optional(),
  }).optional(),
  vad: z.object({
    prefixPaddingMs: z.number().int().min(0).max(500),
    silenceDurationMs: z.number().int().min(100).max(1500),
  }).optional(),
  silence: z.object({
    firstCheckSec: z.number().int().min(0).max(60),
    hangupSec: z.number().int().min(5).max(120),
    message: z.string().max(500).nullable().optional(),
  }).optional(),
}).optional();

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
  openingMessage: z.string().max(2000).nullable().optional(),
  inboundSystemPrompt: z.string().max(25000).nullable().optional(),
  inboundOpeningMessage: z.string().max(2000).nullable().optional(),
  summaryEnabled: z.boolean().optional(),
  summaryPrompt: z.string().max(10000).nullable().optional(),
  summaryMinDuration: z.number().int().min(0).max(3600).optional(),
  webhookUrl: z.string().url().max(500).nullable().optional(),
  webhookSecret: z.string().max(200).nullable().optional(),
  webhookRetryCount: z.number().int().min(0).max(10).optional(),
  webhookRetryDelay: z.number().int().min(1).max(3600).optional(),
  appointmentWebhookUrl: z.string().url().max(500).nullable().optional(),
  appointmentWebhookSecret: z.string().max(200).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  voice: z.string().max(50).optional(),
  phoneNumber: z.string().max(20).nullable().optional(),
  telnyxPhoneId: z.string().max(100).nullable().optional(),
  telnyxAppId: z.string().max(100).nullable().optional(),
  activeHours: z.record(timeSlotSchema).nullable().optional(),
  calendarInstructions: z.string().max(5000).nullable().optional(),
  businessHours: z.record(timeSlotSchema).nullable().optional(),
  calendarConfig: z.record(z.unknown()).nullable().optional(),
  modelConfig: modelConfigSchema,
  whatsappProvider: z.enum(['meta', 'wasender']).nullable().optional(),
  whatsappConfig: z.record(z.unknown()).nullable().optional(),
  whatsappInstructions: z.string().max(5000).nullable().optional(),
  whatsappContextMessages: z.number().int().min(0).max(100).optional(),
  ambientSoundType: z.enum(['NONE', 'OFFICE', 'CAFE', 'RESTAURANT', 'CITY', 'PEOPLE_TALKING']).optional(),
  ambientSoundVolume: z.number().min(0).max(0.5).optional(),
});
