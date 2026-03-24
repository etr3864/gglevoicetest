// Warmup state is per-process (in-memory). Telnyx must route both the
// outbound-call webhook and the subsequent WebSocket stream to the same pod.
// Requires sticky load balancing (IP hash or session affinity on the LB).
import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { GEMINI_MODEL, DEFAULT_VOICE } from '../../lib/constants';
import { GeminiProvider, geminiKeyPool } from '../providers';
import { globalRegistry } from '../tools';
import type { DeepgramTranscriber } from '../transcription';
import { buildContactContext } from '../contact-context';
import { buildSchedulingPrompt, buildWhatsappPrompt, buildWhatsappContextSection, buildMediaPrompt, resolveDirectionalPrompts } from './prompt-builder';
import { SEND_WHATSAPP_DEFINITION } from '../tools/whatsapp-tool';
import { SEARCH_KNOWLEDGE_DEFINITION, handleSearchKnowledge, QUERY_TABLE_DEFINITION, handleQueryTable, SEND_MEDIA_DEFINITION } from '../tools/builtin';
import { getWarmupContext } from '../knowledge/knowledge.service';
import { getMediaContext } from '../media/media.service';
import type { VoiceProvider, ProviderConfig, ProviderEvents, ToolResult } from '../providers/types';
import { mergeModelConfig, type ModelConfig } from '../providers/types';

const log = createLogger('warmup');

const WARMUP_TTL_MS = 60_000;

function resolveVadSensitivity(vad: NonNullable<ModelConfig['vad']>): NonNullable<ModelConfig['vad']> {
  const prefix  = Math.min(Math.max(vad.prefixPaddingMs  ?? 0,   0),   500);
  const silence = Math.min(Math.max(vad.silenceDurationMs ?? 150, 100), 1500);
  return {
    ...vad,
    prefixPaddingMs:          prefix,
    silenceDurationMs:        silence,
    startOfSpeechSensitivity: prefix  > 150 ? 'START_SENSITIVITY_LOW' : 'START_SENSITIVITY_HIGH',
    endOfSpeechSensitivity:   silence > 400 ? 'END_SENSITIVITY_LOW'   : 'END_SENSITIVITY_HIGH',
  };
}
const CLAIM_WAIT_MS = 5_000;

// Gemini Live API system instruction limit is ~8192 tokens.
// Hebrew text uses ~1 token per 2-3 chars, so 18K chars ≈ 6-9K tokens.
// We strip the transcript history section first as it's least critical.
const MAX_SYSTEM_PROMPT_CHARS = 18_000;

function capSystemPrompt(prompt: string): string {
  if (prompt.length <= MAX_SYSTEM_PROMPT_CHARS) return prompt;
  const sectionStart = prompt.indexOf('--- Recent Conversations ---');
  if (sectionStart !== -1) {
    const sectionEnd = prompt.indexOf('\n\n---', sectionStart + 10);
    const trimmed = prompt.slice(0, sectionStart) + (sectionEnd !== -1 ? prompt.slice(sectionEnd) : '');
    if (trimmed.length <= MAX_SYSTEM_PROMPT_CHARS) return trimmed;
    return trimmed.slice(0, MAX_SYSTEM_PROMPT_CHARS);
  }
  return prompt.slice(0, MAX_SYSTEM_PROMPT_CHARS);
}

interface WarmEntry {
  provider: VoiceProvider;
  transcriber: DeepgramTranscriber | null;
  timer: NodeJS.Timeout;
  preloadedAudio: Buffer[];
}

const pending = new Map<string, Promise<WarmEntry | null>>();
const ready = new Map<string, WarmEntry>();

const BASE_NO_OP_EVENTS: Omit<ProviderEvents, 'onReady' | 'onAudio' | 'onToolCall'> = {
  onTranscript: () => {},
  onError: () => {},
  onClose: () => {},
};

export async function warmup(
  callId: string,
  agentId: string,
  contactPhone: string | null,
  callContext?: Record<string, unknown>,
  direction: 'inbound' | 'outbound' = 'outbound',
): Promise<void> {
  if (pending.has(callId) || ready.has(callId)) return;

  const promise = doWarmup(callId, agentId, contactPhone, callContext, direction);
  pending.set(callId, promise);

  try {
    const entry = await promise;
    if (!pending.has(callId)) {
      // expire() was called while warmup was in progress — discard to avoid leak
      if (entry) cleanupEntry(entry);
      return;
    }
    pending.delete(callId);
    if (entry) ready.set(callId, entry);
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

export async function drainWarmups(): Promise<void> {
  await Promise.allSettled([...pending.values()]);
  for (const entry of ready.values()) cleanupEntry(entry);
  ready.clear();
  pending.clear();
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

async function doWarmup(
  callId: string,
  agentId: string,
  contactPhone: string | null,
  callContext?: Record<string, unknown>,
  direction: 'inbound' | 'outbound' = 'outbound',
): Promise<WarmEntry | null> {
  const config = await buildProviderConfig(agentId, contactPhone, callContext, direction);
  if (!config) return null;

  const preloadedAudio: Buffer[] = [];
  const provider = new GeminiProvider();

  const warmupEvents: ProviderEvents = {
    ...BASE_NO_OP_EVENTS,
    onReady: () => { provider.startConversation(); },
    onAudio: (chunk) => { preloadedAudio.push(chunk.data); },
    onToolCall: (call) => {
      if (call.name === 'get_contact_info') {
        return fetchContactForWarmup(call.id, contactPhone);
      }
      log.warn('Unexpected tool call during warmup — ignoring', { tool: call.name });
      return Promise.resolve({ callId: call.id, result: null, error: 'Tool unavailable during warmup' });
    },
  };

  try {
    await provider.connect(config, warmupEvents);
  } catch (err) {
    log.error('Warmup failed', err, { callId });
    return null;
  }

  const timer = setTimeout(() => {
    log.warn('Warmup expired', { callId });
    expire(callId);
  }, WARMUP_TTL_MS);

  return { provider, transcriber: null, timer, preloadedAudio };
}

export async function buildProviderConfig(
  agentId: string,
  contactPhone: string | null,
  callContext?: Record<string, unknown>,
  direction: 'inbound' | 'outbound' = 'outbound',
): Promise<ProviderConfig | null> {
  const systemPromptOverride = callContext?.__systemPrompt as string | undefined;
  const openingMessageOverride = callContext?.__openingMessage as string | undefined;

  const [agent, contactCtx, knowledgeCtx, mediaCtx] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        voice: true,
        basePrompt: true,
        openingMessage: true,
        inboundSystemPrompt: true,
        inboundOpeningMessage: true,
        calendarConfig: true,
        calendarInstructions: true,
        businessHours: true,
        modelConfig: true,
        whatsappProvider: true,
        whatsappInstructions: true,
        whatsappContextMessages: true,
        mediaEnabled: true,
        mediaInstructions: true,
      },
    }),
    contactPhone && !systemPromptOverride ? buildContactContext(contactPhone) : null,
    !systemPromptOverride ? getWarmupContext(agentId).catch(() => null) : null,
    !systemPromptOverride ? getMediaContext(agentId).catch(() => null) : null,
  ]);

  if (!agent) {
    log.error('Agent not found for warmup', undefined, { agentId });
    return null;
  }

  let systemPrompt: string;
  let openingMessage: string | undefined;

  if (systemPromptOverride) {
    systemPrompt = systemPromptOverride;
    openingMessage = openingMessageOverride;
  } else {
    const resolved = resolveDirectionalPrompts(agent, direction);
    systemPrompt = resolved.baseSystemPrompt;
    openingMessage = resolved.openingMessage;

    if (contactCtx) systemPrompt += `\n\n${contactCtx.promptSection}`;
    if (callContext) {
      const publicEntries = Object.entries(callContext).filter(([k]) => !k.startsWith('__'));
      if (publicEntries.length > 0) {
        systemPrompt += '\n\n--- Call Context ---\n';
        systemPrompt += publicEntries
          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join('\n');
      }
    }
    systemPrompt += buildSchedulingPrompt(agent);

    if (agent.whatsappProvider) {
      systemPrompt += buildWhatsappPrompt(agent);
      if (contactPhone) {
        systemPrompt += await buildWhatsappContextSection(agentId, contactPhone, agent.whatsappContextMessages);
      }
    }

    if (knowledgeCtx?.promptSection) {
      systemPrompt += `\n\n${knowledgeCtx.promptSection}`;
    }

    if (mediaCtx && agent.mediaEnabled) {
      systemPrompt += buildMediaPrompt(agent, mediaCtx);
    }
  }

  const apiKey = geminiKeyPool.next();
  if (!apiKey) {
    log.error('No Gemini API keys available', undefined, { agentId });
    return null;
  }

  const knowledgeMeta = knowledgeCtx?.meta;
  const tools = globalRegistry.getDefinitions().filter((t) => {
    if (t.name === 'send_whatsapp') return !!agent.whatsappProvider;
    if (t.name === 'search_knowledge') return !!(knowledgeMeta?.hasTextDocs);
    if (t.name === 'query_table') return !!(knowledgeMeta?.hasTables);
    if (t.name === 'send_media') return !!(agent.mediaEnabled && agent.whatsappProvider && mediaCtx?.hasMedia);
    return true;
  });

  const modelConfig = mergeModelConfig(agent.modelConfig as Partial<ModelConfig> | undefined);
  if (modelConfig.vad) modelConfig.vad = resolveVadSensitivity(modelConfig.vad);

  return {
    apiKey,
    model: GEMINI_MODEL,
    voice: agent.voice || DEFAULT_VOICE,
    systemPrompt: capSystemPrompt(systemPrompt),
    openingMessage,
    modelConfig,
    tools,
  };
}

async function fetchContactForWarmup(toolCallId: string, contactPhone: string | null): Promise<ToolResult> {
  if (!contactPhone) return { callId: toolCallId, result: { found: false } };
  try {
    const contact = await prisma.contact.findUnique({ where: { phone: contactPhone } });
    if (!contact) return { callId: toolCallId, result: { found: false } };
    return {
      callId: toolCallId,
      result: { found: true, name: contact.name, email: contact.email, totalCalls: contact.totalCalls, notes: contact.notes },
    };
  } catch {
    return { callId: toolCallId, result: null, error: 'Failed to fetch contact' };
  }
}

function cleanupEntry(entry: WarmEntry): void {
  try {
    entry.provider.disconnect();
  } catch (err) {
    log.warn('Provider disconnect failed during warmup cleanup', { err: String(err) });
  }
  entry.transcriber?.close();
}
