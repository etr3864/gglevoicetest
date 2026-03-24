import crypto from 'crypto';
import { GoogleAuth } from 'google-auth-library';
import {
  VoiceProvider, ProviderConfig, ProviderEvents, AudioChunk, TokenUsage,
} from '../types';
import { createLogger } from '../../../lib/logger';
import { GEMINI } from '../../../lib/audio-config';
import { GeminiMapper } from './gemini.mapper';
import { GeminiConnection } from './gemini.connection';
import { GeminiState } from './gemini.state';
import { GeminiServerContent, GeminiToolCall, GeminiGoAway, GeminiToolCallCancellation } from './types';

const log = createLogger('gemini:provider');

const MAX_CRASH_RECONNECTS = 3;
const RECONNECT_COOLDOWN_MS = 5_000;
const MAX_BUFFER_CHUNKS = 200;
const STABLE_SESSION_MS = 60_000;

const SILENT_TOOLS = new Set([
  'save_contact',
  'update_contact',
  'get_contact_info',
  'save_note',
  'end_call',
  'transfer_call',
]);

export class GeminiProvider implements VoiceProvider {
  readonly type = 'gemini' as const;

  private events: ProviderEvents | null = null;
  private config: ProviderConfig | null = null;
  
  private connection: GeminiConnection | null = null;
  private state = new GeminiState();

  private reconnecting = false;
  private reconnectAttempts = 0;
  private lastConnectTs = 0;
  private disconnecting = false;
  private isCallActive: (() => boolean) | null = null;

  private auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  async connect(config: ProviderConfig, events: ProviderEvents): Promise<void> {
    this.events = events;
    this.config = config;
    await this.openConnection(false);
  }

  isReady(): boolean {
    return !!this.connection?.isReady();
  }

  setEvents(events: ProviderEvents): void {
    this.events = events;
  }

  setCallActiveCheck(fn: () => boolean): void {
    this.isCallActive = fn;
  }

  startConversation(): void {
    if (!this.connection?.isReady()) return;
    this.connection.send(GeminiMapper.buildStartConversationPayload(this.config?.openingMessage ?? undefined));
  }

  sendAudio(chunk: AudioChunk): void {
    if (this.reconnecting) {
      this.state.pushAudioBuffer(chunk.data, MAX_BUFFER_CHUNKS);
      return;
    }

    if (!this.connection?.isReady() || chunk.data.length === 0) return;

    this.connection.send(GeminiMapper.buildAudioPayload(chunk.data.toString('base64'), chunk.sampleRate));
  }

  disconnect(): void {
    this.disconnecting = true;
    this.reconnecting = false;
    this.state.clearAudioBuffer();
    this.connection?.disconnect(1000);
    this.connection = null;
  }

  simulateCrash(): void {
    this.connection?.disconnect(1008);
  }

  private async openConnection(isReconnect: boolean): Promise<void> {
    try {
      const client = await this.auth.getClient();
      const token = await client.getAccessToken();

      if (!token.token) {
        throw new Error('Failed to retrieve access token');
      }

      const location = process.env.GCP_LOCATION || 'europe-west3';
      const project = process.env.GCP_PROJECT_ID;
      const model = this.config!.model;

      if (!project) {
        throw new Error('GCP_PROJECT_ID environment variable is missing');
      }

      const url = `wss://${location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;
      
      log.debug('Gemini connecting to Vertex AI', { isReconnect, model, location });

      this.connection = new GeminiConnection(
        url,
        {
          onSetupComplete: () => {
            const sessionAge = Date.now() - this.lastConnectTs;
            this.lastConnectTs = Date.now();
            if (isReconnect && sessionAge > STABLE_SESSION_MS) {
              this.reconnectAttempts = 0;
            }
            log.debug('Gemini session ready', { isReconnect, attempt: this.reconnectAttempts });
            if (!this.reconnecting) this.events?.onReady();
          },
          onMessage: (data) => this.handleMessage(data),
          onClose: (code, reason) => this.handleClose(code, reason),
          onError: (err) => this.events?.onError(err),
        },
        { Authorization: `Bearer ${token.token}` }
      );

      const connectPromise = this.connection.connect(isReconnect);

      const fullModelPath = `projects/${project}/locations/${location}/publishers/google/models/${model}`;
      const setupConfig = { ...this.config!, model: fullModelPath };
      const resumptionToken = isReconnect ? this.state.getResumptionToken() ?? undefined : undefined;
      
      this.connection.setSetupPayload(GeminiMapper.buildSetupPayload(setupConfig, resumptionToken));
      await connectPromise;
    } catch (err) {
      log.error('Connection failed', err);
      throw err;
    }
  }

  private handleClose(code: number, reason: string): void {
    if (this.disconnecting) return;

    if (code === 1000) {
      if (this.isCallActive?.()) {
        log.info('Gemini session expired mid-call, reconnecting transparently');
        this.reconnectAttempts = 0;
        this.attemptReconnect();
      } else {
        this.events?.onClose();
      }
      return;
    }

    log.warn('Gemini connection closed unexpectedly', { code, reason });

    if (this.reconnectAttempts < MAX_CRASH_RECONNECTS) {
      this.attemptReconnect();
    } else {
      this.events?.onError(new Error(`Gemini closed: ${code} ${reason}`));
    }
  }

  private async attemptReconnect(): Promise<void> {
    const sinceLastConnect = Date.now() - this.lastConnectTs;
    if (sinceLastConnect < RECONNECT_COOLDOWN_MS) {
      log.warn('Crash loop detected', { attempt: this.reconnectAttempts });
      this.events?.onError(new Error('Gemini crash loop'));
      return;
    }

    const t0 = Date.now();
    this.reconnecting = true;
    this.reconnectAttempts++;

    try {
      const hasResumptionToken = !!this.state.getResumptionToken();
      await this.openConnection(true);

      if (!hasResumptionToken) {
        // No session resumption — inject history so Gemini has context (best-effort fallback)
        const history = this.state.getMergedHistory();
        if (history.length > 0) {
          this.connection?.send(GeminiMapper.buildHistoryPayload(history));
        }
      }

      const chunks = this.state.drainAudioBuffer();
      for (let data of chunks) {
        if (!this.connection?.isReady() || data.length === 0) break;
        if (data.length % 2 !== 0) data = Buffer.concat([data, Buffer.from([0])]);
        this.connection.send(GeminiMapper.buildAudioPayload(data.toString('base64'), GEMINI.inputRate));
      }

      this.reconnecting = false;
      log.info('Reconnect complete', {
        withResumption: hasResumptionToken,
        reconnectMs: Date.now() - t0,
        bufferedChunks: chunks.length,
      });
    } catch (err) {
      this.reconnecting = false;
      this.state.clearAudioBuffer();
      this.events?.onError(new Error('Reconnect failed'));
    }
  }

  private handleMessage(data: Buffer): void {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.error) {
        const message = msg.error.message || 'Gemini API error';
        log.error('API error from Gemini', undefined, { code: msg.error.code, message });
        this.events?.onError(new Error(`Gemini: ${message}`));
        return;
      }

      if (msg.sessionResumptionUpdate?.token) {
        this.state.setResumptionToken(msg.sessionResumptionUpdate.token);
      }

      if (msg.usageMetadata) {
        this.events?.onUsage?.(parseTokenUsage(msg.usageMetadata));
      }

      if (msg.goAway) {
        this.handleGoAway(msg.goAway);
        return;
      }

      if (msg.toolCallCancellation) {
        this.handleToolCallCancellation(msg.toolCallCancellation);
        return;
      }

      if (msg.serverContent) this.handleServerContent(msg.serverContent);
      if (msg.toolCall) this.handleToolCall(msg.toolCall);

    } catch (err) {
      log.error('Failed to parse message', err);
    }
  }

  private handleGoAway(goAway: GeminiGoAway): void {
    const secs = goAway.timeLeft?.seconds ?? 0;
    log.info('GoAway received — initiating preemptive reconnect', { timeLeftSec: secs });
    this.reconnectAttempts = 0;
    this.attemptReconnect();
  }

  private handleToolCallCancellation(cancellation: GeminiToolCallCancellation): void {
    const ids = cancellation.ids ?? [];
    if (ids.length > 0) {
      log.info('Tool call cancelled by user interruption', { ids });
      this.state.addCancelledToolIds(ids);
    }
  }

  private handleServerContent(content: GeminiServerContent): void {
    if (content.interrupted) {
      this.state.flushOutputTranscript();
      this.events?.onInterrupt?.();
      return;
    }

    const parts = content.modelTurn?.parts || [];

    for (const part of parts) {
      if (part.inlineData?.mimeType?.startsWith('audio/pcm')) {
        this.state.getAgentTranscriptTs(); // Initialize timestamp
        this.events?.onAudio({
          data: Buffer.from(part.inlineData.data, 'base64'),
          format: 'pcm16',
          sampleRate: GEMINI.outputRate,
        });
      }
      if (part.text) {
        this.state.appendOutputTranscript(part.text);
      }
    }

    if (content.inputTranscript) {
      this.state.addInputTranscript(content.inputTranscript, this.events);
    }

    if (content.turnComplete) {
      this.state.flushOutputTranscript();
      this.events?.onTurnComplete?.();
    }
  }

  private async handleToolCall(toolCall: GeminiToolCall): Promise<void> {
    if (!this.events?.onToolCall || !this.connection?.isReady() || !toolCall.functionCalls?.length) return;

    const responses = await Promise.all(
      toolCall.functionCalls.map(async (call) => {
        const id = call.id || crypto.randomUUID();

        if (this.state.isToolCancelled(id)) {
          log.info('Skipping cancelled tool call', { name: call.name, id });
          return null;
        }

        log.info('Tool call', { name: call.name });
        
        try {
          const result = await this.events!.onToolCall!({
            id,
            name: call.name,
            arguments: call.args || {},
          });

          if (this.state.isToolCancelled(id)) {
            log.info('Discarding tool result — cancelled during execution', { name: call.name });
            return null;
          }

          const silent = SILENT_TOOLS.has(call.name);
          
          if (result.error) {
            log.warn('Tool execution returned error', { name: call.name, error: result.error });
            return { id: result.callId, name: call.name, response: { error: result.error }, silent };
          }

          return { id: result.callId, name: call.name, response: { result: result.result }, silent };
        } catch (err) {
          log.error('Tool execution threw exception', err, { name: call.name });
          return { id, name: call.name, response: { error: err instanceof Error ? err.message : 'Unknown execution error' }, silent: SILENT_TOOLS.has(call.name) };
        }
      })
    );

    const validResponses = responses.filter((r): r is NonNullable<typeof r> => r !== null);
    if (validResponses.length > 0) {
      this.connection.send(GeminiMapper.buildToolResponsePayload(validResponses));
    }
  }
}

interface ModalityTokenCount {
  modality: string;
  tokenCount: number;
}

interface GeminiUsageMetadata {
  promptTokensDetails?: ModalityTokenCount[];
  responseTokensDetails?: ModalityTokenCount[];
}

function parseTokenUsage(meta: GeminiUsageMetadata): TokenUsage {
  const sumByModality = (details: ModalityTokenCount[] | undefined, modality: string): number =>
    details?.find((d) => d.modality === modality)?.tokenCount ?? 0;

  return {
    audioInputTokens: sumByModality(meta.promptTokensDetails, 'AUDIO'),
    textInputTokens: sumByModality(meta.promptTokensDetails, 'TEXT'),
    audioOutputTokens: sumByModality(meta.responseTokensDetails, 'AUDIO'),
    textOutputTokens: sumByModality(meta.responseTokensDetails, 'TEXT'),
  };
}
