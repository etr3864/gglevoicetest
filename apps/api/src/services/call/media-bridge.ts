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
import {
  INBOUND, DEEPGRAM, NEEDS_ENDIAN_SWAP,
  swapEndian16, diagnoseChunk, peakAmplitude,
} from '../../lib/audio-config';
import { PlayoutBuffer } from '../../lib/playout-buffer';

const log = createLogger('bridge');

interface ActiveConnection {
  provider: VoiceProvider | null;
  transcriber: DeepgramTranscriber | null;
  agentTranscriber: DeepgramTranscriber | null;
  playoutBuffer: PlayoutBuffer | null;
}

const activeConnections = new Map<string, ActiveConnection>();

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
            log.info('Telnyx stream start', {
              callControlId,
              encoding: msg.start?.media_format?.encoding,
              sampleRate: msg.start?.media_format?.sample_rate,
              channels: msg.start?.media_format?.channels,
              streamId: msg.stream_id,
            });
            if (callControlId) {
              await handleStreamStart(callControlId, streamStartTs, ws);
            }
            break;

          case 'media':
            if (msg.media?.payload && callControlId) {
              mediaChunkCount++;
              const rawBuf = Buffer.from(msg.media.payload, 'base64');

              if (mediaChunkCount <= 10 || mediaChunkCount % 200 === 0) {
                const diag = diagnoseChunk(rawBuf);
                log.info('Inbound audio chunk', {
                  callControlId,
                  chunk: mediaChunkCount,
                  bytes: rawBuf.length,
                  peak: diag.peak,
                  status: diag.status,
                  head: rawBuf.subarray(0, 8).toString('hex'),
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
    conn.provider.sendAudio({ data: audio, format: 'pcm16', sampleRate: INBOUND.sampleRate });

    if (chunk === 1 || chunk % 100 === 0) {
      log.info('Audio sent to Gemini', {
        callControlId,
        chunk,
        bytes: audio.length,
        sampleRate: INBOUND.sampleRate,
      });
    }
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

  if (conn.provider) {
    conn.provider.startConversation();
  }
}

async function resolveConnection(
  session: CallSession,
  callControlId: string,
  streamStartTs: number,
  telnyxWs: WebSocket,
): Promise<ActiveConnection | null> {
  const claimed = await claim(session.callId);

  if (claimed) {
    const transcriber = createTranscriber(callControlId);
    const agentTranscriber = createAgentTranscriber(callControlId);
    const { events, playoutBuffer } = buildProviderEvents(session, callControlId, telnyxWs, !!transcriber, agentTranscriber);
    claimed.provider.setEvents(events);
    log.info('Warmup claimed', { callId: session.callId, elapsed: Date.now() - streamStartTs });
    return { provider: claimed.provider, transcriber, agentTranscriber, playoutBuffer };
  }

  const transcriber = createTranscriber(callControlId);
  const agentTranscriber = createAgentTranscriber(callControlId);
  const { events, playoutBuffer } = buildProviderEvents(session, callControlId, telnyxWs, !!transcriber, agentTranscriber);
  const provider = await connectProvider(session, events);
  log.info('Cold connect done', { callId: session.callId, elapsed: Date.now() - streamStartTs });

  if (telnyxWs.readyState !== WebSocket.OPEN) {
    log.warn('Telnyx disconnected during provider setup', { callControlId });
    provider?.disconnect();
    transcriber?.close();
    agentTranscriber?.close();
    playoutBuffer.destroy();
    return null;
  }

  return { provider, transcriber, agentTranscriber, playoutBuffer };
}

function teardown(callControlId: string | null): void {
  if (!callControlId) return;

  const conn = activeConnections.get(callControlId);
  if (conn) {
    conn.playoutBuffer?.destroy();
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

    log.info('Customer transcript received', {
      callControlId,
      text: result.text,
      confidence: result.confidence,
    });

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

function buildProviderEvents(
  session: CallSession,
  callControlId: string,
  telnyxWs: WebSocket,
  hasDeepgram: boolean,
  agentTranscriber: DeepgramTranscriber | null,
): { events: ProviderEvents; playoutBuffer: PlayoutBuffer } {
  const toolContext: ToolContext = {
    callId: session.callId,
    agentId: session.agentId,
    contactPhone: session.contactPhone || undefined,
  };

  let outboundChunkCount = 0;

  const sendToTelnyx = (payload: Buffer) => {
    if (telnyxWs.readyState !== WebSocket.OPEN) return;

    outboundChunkCount++;
    if (outboundChunkCount === 1) {
      log.info('First outbound chunk to Telnyx', {
        callControlId,
        bytes: payload.length,
        peak: peakAmplitude(payload, 'little'),
        head: payload.subarray(0, 8).toString('hex'),
      });
    }

    telnyxWs.send(JSON.stringify({
      event: 'media',
      media: { payload: payload.toString('base64') },
    }));
  };

  const playoutBuffer = new PlayoutBuffer(sendToTelnyx);

  const events: ProviderEvents = {
    onReady: () => {},

    onAudio: (chunk: { data: Buffer }) => {
      if (chunk.data.length > 0) {
        playoutBuffer.push(chunk.data);
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
      playoutBuffer.clear();
      if (telnyxWs.readyState === WebSocket.OPEN) {
        telnyxWs.send(JSON.stringify({ event: 'clear' }));
      }
    },

    onTurnComplete: () => {},
  };

  return { events, playoutBuffer };
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
