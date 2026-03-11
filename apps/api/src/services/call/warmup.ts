import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { GEMINI_MODEL, DEFAULT_VOICE } from '../../lib/constants';
import { GeminiProvider, geminiKeyPool } from '../providers';
import { globalRegistry } from '../tools';
import type { DeepgramTranscriber } from '../transcription';
import { buildContactContext } from '../contact-context';
import { buildSchedulingPrompt } from './prompt-builder';
import type { VoiceProvider, ProviderConfig, ProviderEvents } from '../providers/types';
import { mergeModelConfig, type ModelConfig } from '../providers/types';

const log = createLogger('warmup');

const WARMUP_TTL_MS = 60_000;
const CLAIM_WAIT_MS = 5_000;

interface WarmEntry {
  provider: VoiceProvider;
  transcriber: DeepgramTranscriber | null;
  timer: NodeJS.Timeout;
  preloadedAudio: Buffer[];
}

const pending = new Map<string, Promise<WarmEntry | null>>();
const ready = new Map<string, WarmEntry>();

const BASE_NO_OP_EVENTS: Omit<ProviderEvents, 'onReady' | 'onAudio'> = {
  onTranscript: () => {},
  onToolCall: async (call) => ({ callId: call.id, result: null, error: 'Not connected yet' }),
  onError: () => {},
  onClose: () => {},
};

export async function warmup(callId: string, agentId: string, contactPhone: string | null): Promise<void> {
  if (pending.has(callId) || ready.has(callId)) return;

  const promise = doWarmup(callId, agentId, contactPhone);
  pending.set(callId, promise);

  try {
    const entry = await promise;
    pending.delete(callId);
    if (entry) {
      ready.set(callId, entry);
    }
  } catch {
    pending.delete(callId);
  }
}

export async function claim(callId: string): Promise<WarmEntry | null> {
  const entry = ready.get(callId);
  if (entry) {
    ready.delete(callId);
    clearTimeout(entry.timer);
    return entry;
  }

  const pendingPromise = pending.get(callId);
  if (!pendingPromise) return null;

  const result = await Promise.race([
    pendingPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), CLAIM_WAIT_MS)),
  ]);

  if (result) {
    ready.delete(callId);
    pending.delete(callId);
    clearTimeout(result.timer);
    return result;
  }

  return null;
}

export function expire(callId: string): void {
  const entry = ready.get(callId);
  if (entry) {
    ready.delete(callId);
    clearTimeout(entry.timer);
    cleanupEntry(entry);
  }

  pending.delete(callId);
}

// --- Internal ---

async function doWarmup(
  callId: string,
  agentId: string,
  contactPhone: string | null,
): Promise<WarmEntry | null> {
  const t0 = Date.now();
  const config = await buildProviderConfig(agentId, contactPhone);
  log.info('[WU-1] config built', { callId, elapsed: Date.now() - t0 });
  if (!config) return null;

  const preloadedAudio: Buffer[] = [];
  const provider = new GeminiProvider();

  const warmupEvents: ProviderEvents = {
    ...BASE_NO_OP_EVENTS,
    onReady: () => {
      provider.startConversation();
      log.info('[WU-3] startConversation sent', { callId });
    },
    onAudio: (chunk) => {
      preloadedAudio.push(chunk.data);
    },
  };

  try {
    await provider.connect(config, warmupEvents);
    log.info('[WU-2] gemini connected', { callId, elapsed: Date.now() - t0 });
  } catch (err) {
    log.error('Warmup failed', err, { callId, elapsed: Date.now() - t0 });
    return null;
  }

  const timer = setTimeout(() => {
    log.warn('Warmup expired', { callId });
    expire(callId);
  }, WARMUP_TTL_MS);

  return { provider, transcriber: null, timer, preloadedAudio };
}

async function buildProviderConfig(
  agentId: string,
  contactPhone: string | null,
): Promise<ProviderConfig | null> {
  const [agent, contactCtx] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agentId } }),
    contactPhone ? buildContactContext(contactPhone) : null,
  ]);

  if (!agent) {
    log.error('Agent not found for warmup', undefined, { agentId });
    return null;
  }

  let systemPrompt = agent.basePrompt || 'You are a helpful voice assistant.';
  if (contactCtx) systemPrompt += `\n\n${contactCtx.promptSection}`;
  systemPrompt += buildSchedulingPrompt(agent as any);

  return {
    apiKey: geminiKeyPool.next(),
    model: GEMINI_MODEL,
    voice: agent.voice || DEFAULT_VOICE,
    systemPrompt,
    openingMessage: (agent as Record<string, unknown>).openingMessage as string | undefined ?? undefined,
    modelConfig: mergeModelConfig((agent as Record<string, unknown>).modelConfig as Partial<ModelConfig> | undefined),
    tools: globalRegistry.getDefinitions(),
  };
}

function cleanupEntry(entry: WarmEntry): void {
  try { entry.provider.disconnect(); } catch {}
  entry.transcriber?.close();
}
