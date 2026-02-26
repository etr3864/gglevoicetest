import WebSocket from 'ws';
import https from 'https';
import crypto from 'crypto';
import {
  VoiceProvider, ProviderConfig, ProviderEvents,
  AudioChunk, ToolDefinition,
} from './types';
import { createLogger } from '../../lib/logger';

interface GeminiServerContent {
  interrupted?: boolean;
  turnComplete?: boolean;
  modelTurn?: {
    parts: {
      inlineData?: { mimeType: string; data: string };
      text?: string;
    }[];
  };
  inputTranscript?: string;
  outputTranscription?: { text: string };
}

interface GeminiToolCall {
  functionCalls?: {
    id?: string;
    name: string;
    args?: Record<string, unknown>;
  }[];
}

const log = createLogger('gemini');

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const CONNECT_TIMEOUT_MS = 10_000;
const KEEPALIVE_INTERVAL_MS = 25_000;
const MAX_RECONNECTS = 2;
const RECONNECT_COOLDOWN_MS = 5_000;
const MAX_BUFFER_CHUNKS = 200;

const tlsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

export class GeminiProvider implements VoiceProvider {
  readonly type = 'gemini' as const;

  // --- Connection state ---
  private ws: WebSocket | null = null;
  private events: ProviderEvents | null = null;
  private config: ProviderConfig | null = null;
  private setupDone = false;
  private ready = false;
  private disconnecting = false;
  private keepaliveTimer: NodeJS.Timeout | null = null;

  // --- Transcript state ---
  private agentTranscriptBuf = '';
  private agentTranscriptTs: Date | null = null;
  private turnHadAudio = false;

  // --- Reconnect state ---
  private reconnecting = false;
  private reconnectAttempts = 0;
  private reconnectBuffer: Buffer[] = [];
  private lastConnectTs = 0;
  private history: { role: string; parts: { text: string }[] }[] = [];

  // --- Debug tracking ---
  private lastSent: string[] = [];
  private lastRecv: string[] = [];
  private audioSentCount = 0;

  private trackSend(type: string) {
    this.lastSent.push(type);
    if (this.lastSent.length > 10) this.lastSent.shift();
  }

  private trackRecv(type: string) {
    this.lastRecv.push(type);
    if (this.lastRecv.length > 10) this.lastRecv.shift();
  }

  // =====================================================================
  // Public API
  // =====================================================================

  async connect(config: ProviderConfig, events: ProviderEvents): Promise<void> {
    this.events = events;
    this.config = config;
    this.ready = false;
    await this.openConnection();
  }

  sendAudio(chunk: AudioChunk): void {
    if (this.reconnecting) {
      if (this.reconnectBuffer.length < MAX_BUFFER_CHUNKS) {
        this.reconnectBuffer.push(chunk.data);
      }
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.ready || chunk.data.length === 0) return;

    let pcm = chunk.data;
    if (pcm.length % 2 !== 0) {
      log.warn('Odd audio chunk length', { length: pcm.length });
      pcm = Buffer.concat([pcm, Buffer.from([0])]);
    }

    this.audioSentCount++;
    this.trackSend('audio');

    this.ws.send(JSON.stringify({
      realtimeInput: {
        mediaChunks: [{
          mimeType: 'audio/pcm;rate=24000',
          data: pcm.toString('base64'),
        }],
      },
    }));
  }

  disconnect(): void {
    this.disconnecting = true;
    this.reconnecting = false;
    this.reconnectBuffer = [];
    this.cleanupConnection();
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000);
      }
      this.ws = null;
    }
  }

  isReady(): boolean {
    return this.ready && this.ws?.readyState === WebSocket.OPEN;
  }

  setEvents(events: ProviderEvents): void {
    this.events = events;
  }

  startConversation(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.ready) return;
    this.trackSend('startConversation');
    this.ws.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: 'The customer is now on the line. Begin the conversation.' }] }],
        turnComplete: true,
      },
    }));
  }

  /** Force-close WebSocket to test reconnect. Remove after testing. */
  simulateCrash(): void {
    if (!this.ws) return;
    log.warn('Simulating crash for testing');
    this.ws.close(1008, 'Simulated crash');
  }

  // =====================================================================
  // Reconnect
  // =====================================================================

  private async attemptReconnect(): Promise<void> {
    const sinceLastConnect = Date.now() - this.lastConnectTs;
    if (sinceLastConnect < RECONNECT_COOLDOWN_MS) {
      log.warn('Crash loop detected, giving up', { sinceLastConnect, attempt: this.reconnectAttempts });
      this.events?.onError(new Error('Gemini crash loop'));
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;
    this.reconnectBuffer = [];

    log.warn('Reconnecting', { attempt: this.reconnectAttempts });

    try {
      await this.openConnection();
      this.injectHistory();
      this.drainReconnectBuffer();
      this.reconnecting = false;
    } catch (err) {
      log.error('Reconnect failed', err);
      this.reconnecting = false;
      this.reconnectBuffer = [];
      this.events?.onError(new Error('Reconnect failed'));
    }
  }

  private injectHistory(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.history.length === 0) return;

    // Merge consecutive turns with the same role
    const mergedTurns = this.history.reduce((acc, curr) => {
      const last = acc[acc.length - 1];
      if (last && last.role === curr.role) {
        last.parts.push(...curr.parts);
      } else {
        acc.push({ role: curr.role, parts: [...curr.parts] });
      }
      return acc;
    }, [] as typeof this.history);

    this.ws.send(JSON.stringify({
      clientContent: {
        turns: mergedTurns,
        turnComplete: true,
      },
    }));

    this.trackSend('history');
  }

  private drainReconnectBuffer(): void {
    const chunks = this.reconnectBuffer;
    this.reconnectBuffer = [];
    if (chunks.length === 0) return;

    for (let data of chunks) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || data.length === 0) break;
      if (data.length % 2 !== 0) {
        data = Buffer.concat([data, Buffer.from([0])]);
      }
      this.ws.send(JSON.stringify({
        realtimeInput: {
          mediaChunks: [{
            mimeType: 'audio/pcm;rate=24000',
            data: data.toString('base64'),
          }],
        },
      }));
    }
  }

  // =====================================================================
  // Connection (internal)
  // =====================================================================

  private openConnection(): Promise<void> {
    this.setupDone = false;
    this.ready = false;

    const url = `${WS_URL}?key=${this.config!.apiKey}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.ws?.terminate();
        reject(new Error('Gemini connection timeout'));
      }, CONNECT_TIMEOUT_MS);

      this.ws = new WebSocket(url, { agent: tlsAgent });

      this.ws.on('open', () => {
        this.sendSetup();
        this.startKeepalive();
      });

      this.ws.on('message', (data: Buffer) => {
        if (!this.setupDone) {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.setupComplete) {
              clearTimeout(timeout);
              this.setupDone = true;
              this.ready = true;
              this.lastConnectTs = Date.now();
              if (this.reconnectAttempts > 0) {
                log.info('Reconnect ready', { attempt: this.reconnectAttempts });
              }
              resolve();
              if (!this.reconnecting) {
                this.events?.onReady();
              }
              return;
            }
          } catch {}
        }
        this.handleMessage(data);
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        log.error('WebSocket error', err);
        reject(err);
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        const wasActive = this.setupDone;

        this.cleanupConnection();

        if (this.disconnecting) return;

        if (code === 1000) {
          this.events?.onClose();
          return;
        }

        if (!wasActive) {
          reject(new Error(`Gemini closed during setup: ${code}`));
          return;
        }

        log.warn('Gemini connection closed unexpectedly', { code, reason: reason?.toString() });

        if (this.reconnectAttempts < MAX_RECONNECTS) {
          this.attemptReconnect();
        } else {
          this.events?.onError(new Error(`Gemini closed: ${code} ${reason?.toString() || ''}`));
        }
      });
    });
  }

  private sendSetup(): void {
    if (!this.ws || !this.config) return;

    const setup = this.buildSetupPayload();
    this.trackSend('setup');
    this.ws.send(JSON.stringify({ setup }));
  }

  private buildSetupPayload(): Record<string, unknown> {
    const { modelConfig, systemPrompt, voice, model, tools } = this.config!;
    const { generation, vad, proactiveAudio, languageCode, contextCompression } = modelConfig;

    const setup: Record<string, unknown> = {
      model,
      generationConfig: this.buildGenerationConfig(generation, voice, languageCode),
      systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    if (tools?.length) {
      setup.tools = [{ functionDeclarations: tools.map(t => this.formatTool(t)) }];
    }
    if (vad) {
      setup.realtimeInputConfig = this.buildVadConfig(vad);
    }
    if (proactiveAudio) {
      setup.proactivity = { proactiveAudio: true };
    }
    if (contextCompression) {
      setup.contextWindowCompression = this.buildCompressionConfig(contextCompression);
    }

    return setup;
  }

  private buildGenerationConfig(
    generation: ProviderConfig['modelConfig']['generation'],
    voice: string,
    languageCode?: string,
  ): Record<string, unknown> {
    const speechConfig: Record<string, unknown> = {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
    };
    if (languageCode) speechConfig.languageCode = languageCode;

    const config: Record<string, unknown> = {
      temperature: Math.min(Math.max(generation.temperature, 0), 2),
      maxOutputTokens: Math.min(generation.maxOutputTokens, 8192),
      responseModalities: ['AUDIO'],
      speechConfig,
    };
    if (generation.topP != null) config.topP = generation.topP;
    if (generation.topK != null) config.topK = generation.topK;
    if (generation.presencePenalty != null) config.presencePenalty = generation.presencePenalty;
    if (generation.frequencyPenalty != null) config.frequencyPenalty = generation.frequencyPenalty;

    return config;
  }

  private buildVadConfig(vad: NonNullable<ProviderConfig['modelConfig']['vad']>): Record<string, unknown> {
    const detection: Record<string, unknown> = {};
    if (vad.startOfSpeechSensitivity) detection.startOfSpeechSensitivity = vad.startOfSpeechSensitivity;
    if (vad.endOfSpeechSensitivity) detection.endOfSpeechSensitivity = vad.endOfSpeechSensitivity;
    if (vad.prefixPaddingMs != null) detection.prefixPaddingMs = vad.prefixPaddingMs;
    if (vad.silenceDurationMs != null) detection.silenceDurationMs = vad.silenceDurationMs;

    const realtimeInput: Record<string, unknown> = { automaticActivityDetection: detection };
    if (vad.activityHandling) realtimeInput.activityHandling = vad.activityHandling;
    if (vad.turnCoverage) realtimeInput.turnCoverage = vad.turnCoverage;

    return realtimeInput;
  }

  private buildCompressionConfig(
    compression: NonNullable<ProviderConfig['modelConfig']['contextCompression']>,
  ): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    if (compression.slidingWindowSize) {
      config.slidingWindow = { targetTokens: compression.slidingWindowSize };
    }
    if (compression.triggerTokens) {
      config.triggerTokens = compression.triggerTokens;
    }
    return config;
  }

  private formatTool(tool: ToolDefinition): object {
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'OBJECT',
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([key, param]) => [
            key,
            {
              type: param.type.toUpperCase(),
              description: param.description,
              ...(param.enum && { enum: param.enum }),
            },
          ])
        ),
        required: tool.required || [],
      },
    };
  }

  private startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.trackSend('ping');
        this.ws.ping();
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private cleanupConnection(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    this.setupDone = false;
    this.ready = false;
  }

  // =====================================================================
  // Message Handling
  // =====================================================================

  private handleMessage(data: Buffer): void {
    try {
      const msg = JSON.parse(data.toString());

      const keys = Object.keys(msg);
      const type = keys.find(k => k !== 'usageMetadata') || keys[0] || 'unknown';
      this.trackRecv(type);

      if (msg.error) {
        this.handleError(msg.error);
        return;
      }

      if (msg.serverContent) {
        this.handleServerContent(msg.serverContent);
      }

      if (msg.toolCall) {
        this.handleToolCall(msg.toolCall);
      }
    } catch (err) {
      log.error('Failed to parse message', err);
    }
  }

  private handleError(error: unknown): void {
    const message = typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'Gemini API error';

    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : undefined;

    log.error('API error from Gemini', undefined, { code, message });
    this.events?.onError(new Error(`Gemini: ${message}`));
  }

  private handleServerContent(content: GeminiServerContent): void {
    if (content.interrupted) {
      this.flushAgentTranscript();
      this.turnHadAudio = false;
      this.events?.onInterrupt?.();
      return;
    }

    const parts = content.modelTurn?.parts || [];
    if (parts.some(p => p.inlineData?.mimeType?.startsWith('audio/pcm'))) {
      this.turnHadAudio = true;
    }

    this.processAudioParts(parts);
    this.processTranscripts(content);

    if (content.turnComplete) {
      this.flushAgentTranscript();
      this.turnHadAudio = false;
      this.events?.onTurnComplete?.();
    }
  }

  private processAudioParts(parts: NonNullable<GeminiServerContent['modelTurn']>['parts']): void {
    for (const part of parts) {
      if (part.inlineData?.mimeType?.startsWith('audio/pcm')) {
        if (!this.agentTranscriptTs) this.agentTranscriptTs = new Date();
        this.events?.onAudio({
          data: Buffer.from(part.inlineData.data, 'base64'),
          format: 'pcm16',
          sampleRate: 24000,
        });
      }
    }
  }

  private processTranscripts(content: GeminiServerContent): void {
    if (content.inputTranscript) {
      this.history.push({ role: 'user', parts: [{ text: content.inputTranscript }] });
      this.events?.onTranscript({
        speaker: 'customer',
        text: content.inputTranscript,
        timestamp: new Date(),
        isFinal: true,
      });
    }

    if (content.outputTranscription?.text) {
      if (!this.agentTranscriptTs) this.agentTranscriptTs = new Date();
      this.agentTranscriptBuf += content.outputTranscription.text;
    }
  }

  private flushAgentTranscript(): void {
    const text = this.agentTranscriptBuf.trim();
    if (text) {
      this.history.push({ role: 'model', parts: [{ text }] });
      this.events?.onTranscript({
        speaker: 'agent',
        text,
        timestamp: this.agentTranscriptTs ?? new Date(),
        isFinal: true,
      });
    }
    this.agentTranscriptBuf = '';
    this.agentTranscriptTs = null;
  }

  // =====================================================================
  // Tool Calls
  // =====================================================================

  private async handleToolCall(toolCall: GeminiToolCall): Promise<void> {
    if (!this.events?.onToolCall || !this.ws || !toolCall.functionCalls?.length) return;

    const responses = await Promise.all(
      toolCall.functionCalls.map(async (call) => {
        const id = call.id || crypto.randomUUID();
        const result = await this.events!.onToolCall!({
          id,
          name: call.name,
          arguments: call.args || {},
        });
        
        if (result.error) log.warn('Tool call error', { name: call.name, error: result.error });

        return {
          id: result.callId,
          name: call.name,
          response: result.error ? { error: result.error } : { result: result.result },
        };
      })
    );

    this.sendToolResponses(responses);
  }

  private sendToolResponses(responses: Array<{ id: string; name: string; response: unknown }>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.trackSend('toolResponse');
    this.ws.send(JSON.stringify({
      toolResponse: { functionResponses: responses },
    }));
  }
}
