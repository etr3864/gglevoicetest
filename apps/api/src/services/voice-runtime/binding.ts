import { prisma, Prisma } from '@voice/db';
import type { ZodSchema } from 'zod';
import type { VoiceProviderId } from './types';

const configSchemas = new Map<VoiceProviderId, ZodSchema>();

export function registerConfigSchema(provider: VoiceProviderId, schema: ZodSchema): void {
  configSchemas.set(provider, schema);
}

export async function getActiveBinding(agentId: string, provider: VoiceProviderId) {
  if (provider === 'gemini_live') return null;
  return prisma.voiceProviderBinding.findUnique({
    where: { agentId_provider: { agentId, provider } },
  });
}

export async function upsertBinding(
  agentId: string,
  provider: VoiceProviderId,
  data: {
    externalId?: string;
    config?: Prisma.InputJsonValue;
    syncStatus?: string;
    syncError?: string | null;
  },
) {
  if (data.config !== undefined && data.config !== null) {
    const schema = configSchemas.get(provider);
    if (schema) {
      const result = schema.safeParse(data.config);
      if (!result.success) {
        throw new Error(`Invalid ${provider} config: ${result.error.message}`);
      }
    }
  }

  const isSynced = data.syncStatus === 'synced';
  return prisma.voiceProviderBinding.upsert({
    where: { agentId_provider: { agentId, provider } },
    create: {
      agentId,
      provider,
      externalId: data.externalId,
      config: data.config ?? Prisma.JsonNull,
      syncStatus: data.syncStatus ?? 'synced',
      syncError: data.syncError ?? null,
      syncedAt: isSynced ? new Date() : null,
    },
    update: {
      ...(data.externalId !== undefined && { externalId: data.externalId }),
      ...(data.config !== undefined && { config: data.config }),
      ...(data.syncStatus !== undefined && { syncStatus: data.syncStatus }),
      ...(data.syncError !== undefined && { syncError: data.syncError }),
      ...(isSynced && { syncedAt: new Date() }),
    },
  });
}
