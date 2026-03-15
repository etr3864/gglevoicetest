import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { GeminiProvider } from '../providers';
import { globalRegistry, type ToolContext } from '../tools';
import { getSession, endSession, addTranscript, type CallSession } from './session';
import { claim, expire, buildProviderConfig } from './warmup';
import { hangupCall, startRecording } from '../telnyx';
import { DeepgramTranscriber } from '../transcription';
import type { VoiceProvider, ProviderEvents } from '../providers/types';
import { publishCallEvent } from '../events/pubsub';
import { redis } from '../../lib/redis';
import {
  OUTBOUND, DEEPGRAM, NEEDS_ENDIAN_SWAP, GEMINI,
  swapEndian16, diagnoseChunk, applyGain, downsample24kTo16k,
} from '../../lib/audio-config';

const log = createLogger('bridge');

// provider is always non-null — connections that fail to build never reach activeConnections
interface ActiveConnection {
  provider: VoiceProvider;
  transcriber: DeepgramTranscriber | null;
  agentTranscriber: DeepgramTranscriber | null;
  greetingPreloaded: boolean;
  interruptRef: { enabled: boolean };
  downsampleCarry: Buffer;
}

interface BridgeContext {
  session: CallSession;
  callControlId: string;
  telnyxWs: WebSocket;
  hasDeepgram: boolean;
  agentTranscriber: DeepgramTranscriber | null;
  sendToTelnyx: (payload: Buffer) => void;
  interruptRef: { enabled: boolean };
}

const activeConnections = new Map<string, ActiveConnection>();
let disconnectSubscriber: ReturnType<typeof redis.duplicate> | null = null;


export function activeConnectionCount(): number {
  return activeConnections.size;
}

export function closeMediaBridge(): Promise<void> {
  return disconnectSubscriber ? disconnectSubscriber.quit().then(() => {}) : Promise.resolve();
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
              await initializeCallBridge(callControlId, streamStartTs, ws);
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
              handleMedia(callControlId, rawBuf);
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

function handleMedia(callControlId: string, pcm: Buffer): void {
  const conn = activeConnections.get(callControlId);
  if (!conn) return;

  const audio = NEEDS_ENDIAN_SWAP ? swapEndian16(pcm) : pcm;

  if (conn.interruptRef.enabled) {
    const { out, carry } = downsample24kTo16k(audio, conn.downsampleCarry);
    conn.downsampleCarry = carry;
    conn.provider.sendAudio({ data: out, format: 'pcm16', sampleRate: GEMINI.inputRate });
  }

  conn.transcriber?.sendAudio(audio);
}

// Delays sum to ~6.7s. First check is immediate (before first delay).
const SESSION_RETRY_DELAYS = [200, 500, 1000, 2000, 3000];

async function waitForSession(callControlId: string): Promise<CallSession | undefined> {
  for (const delay of SESSION_RETRY_DELAYS) {
    const session = await getSession(callControlId);
    if (session) return session;
    await new Promise((r) => setTimeout(r, delay));
  }
  // One final check after the last delay
  return getSession(callControlId);
}

async function initializeCallBridge(
  callControlId: string,
  streamStartTs: number,
  telnyxWs: WebSocket,
): Promise<void> {
  const session = await waitForSession(callControlId);
  if (!session) {
    log.error('No session for stream after retries — hanging up', undefined, { callControlId });
    hangupCall(callControlId).catch(() => {});
    return;
  }

  if (telnyxWs.readyState !== WebSocket.OPEN) {
    log.warn('Telnyx disconnected during setup', { callControlId });
    return;
  }

  const conn = await buildActiveConnection(session, callControlId, streamStartTs, telnyxWs);
  if (!conn) return;

  activeConnections.set(callControlId, conn);

  // Fire-and-forget: call is already active, DB/recording failure shouldn't block audio
  markInCallAndRecord(session, callControlId).catch((err) => {
    log.error('Failed to mark in_call / start recording', err, { callId: session.callId });
  });

  if (!conn.greetingPreloaded) {
    conn.provider.startConversation();
  }
}

async function markInCallAndRecord(session: CallSession, callControlId: string): Promise<void> {
  const call = await prisma.call.update({
    where: { id: session.callId },
    data: { status: 'in_call' },
  });
  await publishCallEvent(session.agentId, 'call_updated', { call });
  await startRecording(callControlId);
}

async function buildActiveConnection(
  session: CallSession,
  callControlId: string,
  streamStartTs: number,
  telnyxWs: WebSocket,
): Promise<ActiveConnection | null> {
  const prewarmed = await claim(session.callId);
  const sendToTelnyx = makeSendToTelnyx(telnyxWs);
  const transcriber = createTranscriber(callControlId, 'customer');
  const agentTranscriber = createTranscriber(callControlId, 'agent');
  const interruptRef = { enabled: false };
  const ctx: BridgeContext = { session, callControlId, telnyxWs, hasDeepgram: !!transcriber, agentTranscriber, sendToTelnyx, interruptRef };
  const events = buildProviderEvents(ctx);

  if (prewarmed) {
    prewarmed.provider.setEvents(events);
    prewarmed.provider.setCallActiveCheck?.(() => activeConnections.has(callControlId));

    for (const chunk of prewarmed.preloadedAudio) {
      sendToTelnyx(chunk);
    }

    if (prewarmed.preloadedAudio.length > 0) {
      const totalBytes = prewarmed.preloadedAudio.reduce((s, b) => s + b.length, 0);
      const durationMs = Math.ceil((totalBytes / 2 / OUTBOUND.sampleRate) * 1000) + 300;
      setTimeout(() => { interruptRef.enabled = true; }, durationMs);
    } else {
      interruptRef.enabled = true;
    }

    log.info('Connection ready', {
      callId: session.callId,
      type: 'warm',
      elapsed: Date.now() - streamStartTs,
      preloadedChunks: prewarmed.preloadedAudio.length,
    });
    return { provider: prewarmed.provider, transcriber, agentTranscriber, greetingPreloaded: true, interruptRef, downsampleCarry: Buffer.alloc(0) };
  }

  const provider = await connectProvider(session, events);
  if (!provider) {
    log.error('Provider failed to connect — aborting call setup', undefined, { callId: session.callId });
    transcriber?.close();
    agentTranscriber?.close();
    return null;
  }

  provider.setCallActiveCheck?.(() => activeConnections.has(callControlId));

  if (telnyxWs.readyState !== WebSocket.OPEN) {
    log.warn('Telnyx disconnected during provider setup', { callControlId });
    provider.disconnect();
    transcriber?.close();
    agentTranscriber?.close();
    return null;
  }

  // Cold path has no preloaded greeting — user can speak immediately
  interruptRef.enabled = true;

  log.info('Connection ready', { callId: session.callId, type: 'cold', elapsed: Date.now() - streamStartTs });
  return { provider, transcriber, agentTranscriber, greetingPreloaded: false, interruptRef, downsampleCarry: Buffer.alloc(0) };
}

function teardown(callControlId: string | null): void {
  if (!callControlId) return;

  const conn = activeConnections.get(callControlId);
  if (!conn) return;

  activeConnections.delete(callControlId);
  conn.transcriber?.close();
  conn.agentTranscriber?.close();
  try {
    conn.provider.disconnect();
  } catch (err) {
    log.warn('Provider disconnect error during teardown', { callControlId });
  }

  getSession(callControlId).then((session) => {
    if (session) expire(session.callId);
  }).catch(() => {});

  endSession(callControlId).catch((err) => {
    log.error('Failed to end session', err, { callControlId });
  });
}

async function connectProvider(
  session: CallSession,
  events: ProviderEvents,
): Promise<VoiceProvider | null> {
  const config = await buildProviderConfig(
    session.agentId,
    session.contactPhone,
    session.callContext,
    session.direction,
  );
  if (!config) return null;

  const provider = new GeminiProvider();
  try {
    await provider.connect(config, events);
    return provider;
  } catch (err) {
    log.error('Failed to connect Gemini', err, { callId: session.callId });
    return null;
  }
}

function createTranscriber(
  callControlId: string,
  speaker: 'customer' | 'agent',
): DeepgramTranscriber | null {
  const sampleRate = speaker === 'customer' ? DEEPGRAM.customerRate : DEEPGRAM.agentRate;
  const transcriber = new DeepgramTranscriber(async (result) => {
    if (!result.isFinal || !result.text.trim()) return;
    await addTranscript(callControlId, {
      speaker,
      text: result.text,
      timestamp: new Date(Date.now() - result.durationSec * 1000),
      isFinal: true,
    });
  });
  return transcriber.connect({ sampleRate }) ? transcriber : null;
}

function makeSendToTelnyx(telnyxWs: WebSocket): (payload: Buffer) => void {
  return (payload: Buffer) => {
    if (telnyxWs.readyState !== WebSocket.OPEN) return;
    const buf = applyGain(payload, OUTBOUND.gain);
    telnyxWs.send(JSON.stringify({
      event: 'media',
      media: { payload: buf.toString('base64') },
    }));
  };
}

function buildProviderEvents(ctx: BridgeContext): ProviderEvents {
  const { session, callControlId, telnyxWs, hasDeepgram, agentTranscriber, sendToTelnyx, interruptRef } = ctx;
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
      try {
        const result = await globalRegistry.execute(call, toolContext);
        handleToolAction(result.result, callControlId);
        return result;
      } catch (err) {
        log.error('Tool execution failed', err, { callId: session.callId, tool: call.name });
        return { callId: call.id, result: null, error: 'Tool execution failed' };
      }
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

export function simulateCrashForTesting(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  for (const [, conn] of activeConnections) {
    if (conn.provider instanceof GeminiProvider) {
      conn.provider.simulateCrash();
      return true;
    }
  }
  return false;
}

function subscribeToDisconnects(): void {
  disconnectSubscriber = redis.duplicate();
  disconnectSubscriber.subscribe('call:disconnect', (err) => {
    if (err) log.error('Failed to subscribe to call:disconnect', err);
  });

  disconnectSubscriber.on('message', (channel, message) => {
    if (channel === 'call:disconnect') {
      teardown(message);
    }
  });
}
