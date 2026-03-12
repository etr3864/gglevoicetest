import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { GEMINI_MODEL, DEFAULT_VOICE } from '../../lib/constants';
import { GeminiProvider, geminiKeyPool } from '../providers';
import { globalRegistry, type ToolContext } from '../tools';
import { getSession, endSession, addTranscript, type CallSession } from './session';
import { claim, expire } from './warmup';
import { hangupCall } from '../telnyx';
import { DeepgramTranscriber } from '../transcription';
import type { VoiceProvider, ProviderEvents, ProviderConfig } from '../providers/types';
import { mergeModelConfig, type ModelConfig } from '../providers/types';
import { buildContactContext } from '../contact-context';
import { buildSchedulingPrompt } from './prompt-builder';
import { redis } from '../../lib/redis';
import { audioWorkerPool } from '../../lib/audio';
import {
  INBOUND, OUTBOUND, DEEPGRAM, NEEDS_ENDIAN_SWAP, GEMINI,
  swapEndian16, diagnoseChunk, applyGain,
} from '../../lib/audio-config';

const log = createLogger('bridge');

interface ActiveConnection {
  provider: VoiceProvider | null;
  transcriber: DeepgramTranscriber | null;
  agentTranscriber: DeepgramTranscriber | null;
  greetingPreloaded: boolean;
}

const activeConnections = new Map<string, ActiveConnection>();

export function activeConnectionCount(): number {
  return activeConnections.size;
}

export function attachWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws/media' });

  subscribeToDisconnects();

  wss.on('connection', (ws) => {
    let callControlId: string | null = null;
    let streamStartTs = 0;
    let mediaChunkCount = 0;

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.event) {
          case 'start':
            callControlId = msg.start?.call_control_id;
            streamStartTs = Date.now();
            log.debug('Telnyx stream start', {
              callControlId,
              encoding: msg.start?.media_format?.encoding,
              sampleRate: msg.start?.media_format?.sample_rate,
            });
            if (callControlId) {
              await handleStreamStart(callControlId, streamStartTs, ws);
            }
            break;

          case 'media':
            if (msg.media?.payload && callControlId) {
              mediaChunkCount++;
              const rawBuf = Buffer.from(msg.media.payload, 'base64');

              if (mediaChunkCount <= 5 || mediaChunkCount % 500 === 0) {
                const diag = diagnoseChunk(rawBuf);
                log.debug('Inbound audio chunk', {
                  callControlId,
                  chunk: mediaChunkCount,
                  bytes: rawBuf.length,
                  peak: diag.peak,
                  status: diag.status,
                });
              }
              handleMedia(callControlId, rawBuf, mediaChunkCount);
            }
            break;

          case 'stop':
            teardown(callControlId);
            break;
        }
      } catch (err) {
        log.error('Error processing message', err);
      }
    });

    ws.on('close', () => teardown(callControlId));
    ws.on('error', (err) => log.error('Telnyx WS error', err));
  });
}

function handleMedia(callControlId: string, pcm: Buffer, chunk: number): void {
  const conn = activeConnections.get(callControlId);
  if (!conn) return;

  const audio = NEEDS_ENDIAN_SWAP ? swapEndian16(pcm) : pcm;

  if (conn.provider) {
    // Vertex AI requires 16kHz for input, but we receive 24kHz from Telnyx.
    // We must downsample it before sending to Gemini.
    audioWorkerPool.process(callControlId, audio);
  }
  if (conn.transcriber) {
    conn.transcriber.sendAudio(audio);
  }
}

// --- Stream Lifecycle ---

async function handleStreamStart(
  callControlId: string,
  streamStartTs: number,
  telnyxWs: WebSocket,
): Promise<void> {
  const session = await getSession(callControlId);
  if (!session) {
    log.warn('No session for stream', { callControlId });
    return;
  }

  if (telnyxWs.readyState !== WebSocket.OPEN) {
    log.warn('Telnyx disconnected during setup', { callControlId });
    return;
  }

  const conn = await resolveConnection(session, callControlId, streamStartTs, telnyxWs);
  if (!conn) return;

  activeConnections.set(callControlId, conn);

  if (conn.provider && !conn.greetingPreloaded) {
    conn.provider.startConversation();
  }

  // Register callback for downsampled audio from the worker pool
  audioWorkerPool.register(callControlId, (downsampledChunk) => {
    const activeConn = activeConnections.get(callControlId);
    if (activeConn?.provider) {
      activeConn.provider.sendAudio({
        data: downsampledChunk,
        format: 'pcm16',
        sampleRate: GEMINI.inputRate, // 16000
      });
    }
  });
}

async function resolveConnection(
  session: CallSession,
  callControlId: string,
  streamStartTs: number,
  telnyxWs: WebSocket,
): Promise<ActiveConnection | null> {
  const claimed = await claim(session.callId);

  const sendToTelnyx = makeSendToTelnyx(callControlId, telnyxWs);

  const interruptRef = { enabled: false };

  if (claimed) {
    const transcriber = createTranscriber(callControlId);
    const agentTranscriber = createAgentTranscriber(callControlId);
    const events = buildProviderEvents(session, callControlId, telnyxWs, !!transcriber, agentTranscriber, sendToTelnyx, interruptRef);
    claimed.provider.setEvents(events);

    for (const chunk of claimed.preloadedAudio) {
      sendToTelnyx(chunk);
    }

    if (claimed.preloadedAudio.length > 0) {
      const totalBytes = claimed.preloadedAudio.reduce((s, b) => s + b.length, 0);
      const durationMs = Math.ceil((totalBytes / 2 / OUTBOUND.sampleRate) * 1000) + 300;
      setTimeout(() => { interruptRef.enabled = true; }, durationMs);
    }

    log.info('Connection ready', {
      callId: session.callId,
      type: 'warm',
      elapsed: Date.now() - streamStartTs,
      preloadedChunks: claimed.preloadedAudio.length,
    });
    return { provider: claimed.provider, transcriber, agentTranscriber, greetingPreloaded: true };
  }

  const transcriber = createTranscriber(callControlId);
  const agentTranscriber = createAgentTranscriber(callControlId);
  const events = buildProviderEvents(session, callControlId, telnyxWs, !!transcriber, agentTranscriber, sendToTelnyx, interruptRef);
  const provider = await connectProvider(session, events);
  log.info('Connection ready', { callId: session.callId, type: 'cold', elapsed: Date.now() - streamStartTs });

  if (telnyxWs.readyState !== WebSocket.OPEN) {
    log.warn('Telnyx disconnected during provider setup', { callControlId });
    provider?.disconnect();
    transcriber?.close();
    agentTranscriber?.close();
    return null;
  }

  return { provider, transcriber, agentTranscriber, greetingPreloaded: false };
}

function teardown(callControlId: string | null): void {
  if (!callControlId) return;

  audioWorkerPool.cleanup(callControlId);

  const conn = activeConnections.get(callControlId);
  if (conn) {
    conn.transcriber?.close();
    conn.agentTranscriber?.close();
    try { conn.provider?.disconnect(); } catch {}
    activeConnections.delete(callControlId);
  }

  expire(callControlId);
  endSession(callControlId).catch((err) => {
    log.error('Failed to end session', err, { callControlId });
  });
}

// --- Provider Setup ---

async function connectProvider(
  session: CallSession,
  events: ProviderEvents,
): Promise<VoiceProvider | null> {
  const [agent, contactCtx] = await Promise.all([
    prisma.agent.findUnique({ where: { id: session.agentId } }),
    session.contactPhone ? buildContactContext(session.contactPhone) : null,
  ]);

  if (!agent) {
    log.error('Agent not found', undefined, { agentId: session.agentId });
    return null;
  }

  let systemPrompt = agent.basePrompt || 'You are a helpful voice assistant.';
  if (contactCtx) systemPrompt += `\n\n${contactCtx.promptSection}`;
  systemPrompt += buildSchedulingPrompt(agent as any);

  const config: ProviderConfig = {
    apiKey: geminiKeyPool.next(),
    model: GEMINI_MODEL,
    voice: agent.voice || DEFAULT_VOICE,
    systemPrompt,
    openingMessage: (agent as Record<string, unknown>).openingMessage as string | undefined ?? undefined,
    modelConfig: mergeModelConfig((agent as Record<string, unknown>).modelConfig as Partial<ModelConfig> | undefined),
    tools: globalRegistry.getDefinitions(),
  };

  const provider = new GeminiProvider();
  try {
    await provider.connect(config, events);
    return provider;
  } catch (err) {
    log.error('Failed to connect Gemini', err, { callId: session.callId });
    return null;
  }
}

// --- Transcription ---

function createTranscriber(callControlId: string): DeepgramTranscriber | null {
  const transcriber = new DeepgramTranscriber(async (result) => {
    if (!result.isFinal || !result.text.trim()) return;


    await addTranscript(callControlId, {
      speaker: 'customer',
      text: result.text,
      timestamp: new Date(Date.now() - result.durationSec * 1000),
      isFinal: true,
    });
  });

  return transcriber.connect({ sampleRate: DEEPGRAM.customerRate }) ? transcriber : null;
}

function createAgentTranscriber(callControlId: string): DeepgramTranscriber | null {
  const transcriber = new DeepgramTranscriber(async (result) => {
    if (!result.isFinal || !result.text.trim()) return;
    await addTranscript(callControlId, {
      speaker: 'agent',
      text: result.text,
      timestamp: new Date(Date.now() - result.durationSec * 1000),
      isFinal: true,
    });
  });

  return transcriber.connect({ sampleRate: DEEPGRAM.agentRate }) ? transcriber : null;
}

// --- Provider Events ---

function makeSendToTelnyx(callControlId: string, telnyxWs: WebSocket): (payload: Buffer) => void {
  let outboundChunkCount = 0;
  return (payload: Buffer) => {
    if (telnyxWs.readyState !== WebSocket.OPEN) return;
    outboundChunkCount++;
    const amplified = applyGain(payload, OUTBOUND.gain);
    telnyxWs.send(JSON.stringify({
      event: 'media',
      media: { payload: amplified.toString('base64') },
    }));
  };
}

function buildProviderEvents(
  session: CallSession,
  callControlId: string,
  telnyxWs: WebSocket,
  hasDeepgram: boolean,
  agentTranscriber: DeepgramTranscriber | null,
  sendToTelnyx: (payload: Buffer) => void,
  interruptRef: { enabled: boolean },
): ProviderEvents {
  const toolContext: ToolContext = {
    callId: session.callId,
    agentId: session.agentId,
    contactPhone: session.contactPhone || undefined,
  };

  return {
    onReady: () => {},

    onAudio: (chunk: { data: Buffer }) => {
      if (chunk.data.length > 0) {
        sendToTelnyx(chunk.data);
        agentTranscriber?.sendAudio(chunk.data);
      }
    },

    onTranscript: async (entry) => {
      if (entry.speaker === 'customer' || !hasDeepgram) {
        await addTranscript(callControlId, entry);
      }
    },

    onToolCall: async (call) => {
      const result = await globalRegistry.execute(call, toolContext);
      handleToolAction(result.result, callControlId);
      return result;
    },

    onError: (err) => {
      log.error('Provider error', err, { callId: session.callId });
      hangupCall(callControlId).catch(() => {});
      teardown(callControlId);
    },

    onClose: () => {
      teardown(callControlId);
    },

    onInterrupt: () => {
      if (!interruptRef.enabled) return;
      if (telnyxWs.readyState === WebSocket.OPEN) {
        telnyxWs.send(JSON.stringify({ event: 'clear' }));
      }
    },

    onTurnComplete: () => {
      interruptRef.enabled = true;
    },
  };
}

function handleToolAction(result: unknown, callControlId: string): void {
  if (!result || typeof result !== 'object') return;
  const action = (result as Record<string, unknown>).action;

  if (action === 'end_call') {
    setTimeout(() => hangupCall(callControlId), 2000);
  }
}

// --- Debug ---

export function simulateCrashForTesting(): boolean {
  for (const [id, conn] of activeConnections) {
    if (conn.provider instanceof GeminiProvider) {
      conn.provider.simulateCrash();
      return true;
    }
  }
  return false;
}

// --- Redis Disconnect Subscription ---

function subscribeToDisconnects(): void {
  const subscriber = redis.duplicate();
  subscriber.subscribe('call:disconnect', (err) => {
    if (err) log.error('Failed to subscribe to call:disconnect', err);
  });

  subscriber.on('message', (channel, message) => {
    if (channel === 'call:disconnect') {
      teardown(message);
    }
  });
}
