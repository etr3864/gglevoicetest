import crypto from 'crypto';
import { prisma, Prisma } from '@voice/db';
import { createLogger } from '../../../lib/logger';
import { upsertBinding, getActiveBinding } from '../binding';
import { ElevenLabsConfigSchema, DEFAULT_ELEVENLABS_CONFIG } from './config.schema';
import type { ElevenLabsConfig } from './config.schema';
import { buildAgentPayload } from './payload-builder';
import { createAgent, updateAgent, deleteAgent, listPhoneNumbers, assignAgentToPhoneNumber, ElevenLabsApiError } from './api-client';
import { buildProviderConfig } from '../../call/warmup';
import { updatePhoneNumberConnection } from '../../telnyx';

const log = createLogger('elevenlabs:provision');

function generateLlmToken(): string {
  return `elt_${crypto.randomBytes(32).toString('hex')}`;
}

export async function provisionAgent(agentId: string): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      name: true,
      customLlmToken: true,
      openingMessage: true,
      basePrompt: true,
      voiceProvider: true,
      phoneNumber: true,
      telnyxPhoneId: true,
    },
  });

  if (!agent) throw new Error(`Agent ${agentId} not found`);
  if (agent.voiceProvider !== 'elevenlabs') return;

  await upsertBinding(agentId, 'elevenlabs', {
    syncStatus: 'provisioning',
    syncError: null,
  });

  try {
    const token = await ensureCustomLlmToken(agentId, agent.customLlmToken);
    const config = await resolveElevenLabsConfig(agentId);
    const binding = await getActiveBinding(agentId, 'elevenlabs');

    const providerConfig = await buildProviderConfig(agentId, null, undefined, 'inbound');

    const payload = buildAgentPayload({
      name: agent.name,
      systemPrompt: providerConfig?.systemPrompt ?? agent.basePrompt ?? '',
      openingMessage: agent.openingMessage ?? 'שלום, במה אוכל לעזור?',
      customLlmToken: token,
      config,
      phoneNumber: agent.phoneNumber ?? undefined,
      environment: process.env.NODE_ENV,
    });

    let externalId: string;

    if (binding?.externalId) {
      await updateAgent(binding.externalId, payload);
      externalId = binding.externalId;
    } else {
      externalId = await createAgent(payload);
    }

    await upsertBinding(agentId, 'elevenlabs', {
      externalId,
      config: config as unknown as Prisma.InputJsonValue,
      syncStatus: 'synced',
      syncError: null,
    });

    await routePhoneToSipConnection(agent);
    await assignPhoneInElevenLabs(agent.phoneNumber, externalId);

    log.info('Agent provisioned', { agentId, externalId });
  } catch (err) {
    const errorMsg = err instanceof ElevenLabsApiError
      ? `ElevenLabs ${err.status}: ${err.detail}`
      : err instanceof Error ? err.message : 'Unknown error';

    await upsertBinding(agentId, 'elevenlabs', {
      syncStatus: 'failed',
      syncError: errorMsg,
    });

    log.error('Provisioning failed', err, { agentId });
    throw err;
  }
}

export async function deprovisionAgent(agentId: string): Promise<void> {
  const binding = await getActiveBinding(agentId, 'elevenlabs');
  if (!binding?.externalId) return;

  try {
    await deleteAgent(binding.externalId);
    log.info('Agent deprovisioned', { agentId, externalId: binding.externalId });
  } catch (err) {
    if (err instanceof ElevenLabsApiError && err.status === 404) {
      log.warn('ElevenLabs agent already deleted', { agentId });
    } else {
      log.error('Deprovisioning failed', err, { agentId });
      throw err;
    }
  }

  await upsertBinding(agentId, 'elevenlabs', {
    syncStatus: 'deleted',
    syncError: null,
  });
}

async function ensureCustomLlmToken(
  agentId: string,
  existing: string | null,
): Promise<string> {
  if (existing) return existing;

  const token = generateLlmToken();
  await prisma.agent.update({
    where: { id: agentId },
    data: { customLlmToken: token },
  });

  return token;
}

async function routePhoneToSipConnection(
  agent: { telnyxPhoneId: string | null; phoneNumber: string | null },
): Promise<void> {
  const sipConnectionId = process.env.TELNYX_SIP_CONNECTION_ID;
  if (!sipConnectionId || !agent.telnyxPhoneId) return;

  try {
    await updatePhoneNumberConnection(agent.telnyxPhoneId, sipConnectionId);
    log.info('Phone routed to SIP connection', { phoneId: agent.telnyxPhoneId });
  } catch (err) {
    log.error('Failed to route phone to SIP connection', err, {
      phoneId: agent.telnyxPhoneId,
    });
  }
}

async function assignPhoneInElevenLabs(
  phoneNumber: string | null,
  externalAgentId: string,
): Promise<void> {
  if (!phoneNumber) return;

  try {
    const numbers = await listPhoneNumbers();
    const normalized = phoneNumber.replace(/\s/g, '');
    const match = numbers.find((n) => n.phone_number.replace(/\s/g, '') === normalized);

    if (!match) {
      log.warn('Phone number not found in ElevenLabs — assign manually', { phoneNumber });
      return;
    }

    if (match.agent_id === externalAgentId) return;

    await assignAgentToPhoneNumber(match.phone_number_id, externalAgentId);
  } catch (err) {
    log.error('Failed to assign phone in ElevenLabs', err, { phoneNumber });
  }
}

async function resolveElevenLabsConfig(agentId: string): Promise<ElevenLabsConfig> {
  const binding = await getActiveBinding(agentId, 'elevenlabs');
  const raw = binding?.config as Record<string, unknown> | undefined;

  if (raw && Object.keys(raw).length > 0) {
    const parsed = ElevenLabsConfigSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    log.warn('Invalid binding config, using defaults', { agentId });
  }

  return { ...DEFAULT_ELEVENLABS_CONFIG };
}
