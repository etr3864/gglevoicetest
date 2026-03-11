import crypto from 'crypto';
import { GoogleAuth } from 'google-auth-library';
import {
  VoiceProvider, ProviderConfig, ProviderEvents, AudioChunk,
} from '../types';
import { createLogger } from '../../../lib/logger';
import { GEMINI } from '../../../lib/audio-config';
import { GeminiMapper } from './gemini.mapper';
import { GeminiConnection } from './gemini.connection';
import { GeminiState } from './gemini.state';
import { GeminiServerContent, GeminiToolCall } from './types';

const log = createLogger('gemini:provider');

const MAX_RECONNECTS = 2;
const RECONNECT_COOLDOWN_MS = 5_000;
const MAX_BUFFER_CHUNKS = 200;

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

  // =====================================================================
  // Internal Connection & Reconnect
  // =====================================================================

  private async openConnection(isReconnect: boolean): Promise<void> {
    try {
      const client = await this.auth.getClient();
      const token = await client.getAccessToken();

      if (!token.token) {
        throw new Error('Failed to retrieve access token');
      }

      const location = process.env.GCP_LOCATION || 'europe-west3';
      const project = process.env.GCP_PROJECT_ID || 'gen-lang-client-0546829339';
      const model = this.config!.model;

      if (!project) {
        throw new Error('GCP_PROJECT_ID environment variable is missing');
      }

      const url = `wss://${location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmUtilityService/BidiGenerateContent?project=${project}&model=models/${model}`;
      
      log.debug('Gemini connecting to Vertex AI', { isReconnect, model, location });

      this.connection = new GeminiConnection(
        url,
        {
          onSetupComplete: () => {
            this.lastConnectTs = Date.now();
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
      
      this.connection.setSetupPayload(GeminiMapper.buildSetupPayload(setupConfig));
      await connectPromise;
    } catch (err) {
      log.error('Connection failed', err);
      throw err;
    }
  }

  private handleClose(code: number, reason: string): void {
    if (this.disconnecting) return;

    if (code === 1000) {
      this.events?.onClose();
      return;
    }

    log.warn('Gemini connection closed unexpectedly', { code, reason });

    if (this.reconnectAttempts < MAX_RECONNECTS) {
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

    this.reconnecting = true;
    this.reconnectAttempts++;

    try {
      await this.openConnection(true);
      
      const history = this.state.getMergedHistory();
      if (history.length > 0) {
        this.connection?.send(GeminiMapper.buildHistoryPayload(history));
      }

      const chunks = this.state.drainAudioBuffer();
      for (let data of chunks) {
        if (!this.connection?.isReady() || data.length === 0) break;
        if (data.length % 2 !== 0) data = Buffer.concat([data, Buffer.from([0])]);
        this.connection.send(GeminiMapper.buildAudioPayload(data.toString('base64'), GEMINI.inputRate));
      }

      this.reconnecting = false;
    } catch (err) {
      this.reconnecting = false;
      this.state.clearAudioBuffer();
      this.events?.onError(new Error('Reconnect failed'));
    }
  }

  // =====================================================================
  // Message Handling
  // =====================================================================

  private handleMessage(data: Buffer): void {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.error) {
        const message = msg.error.message || 'Gemini API error';
        log.error('API error from Gemini', undefined, { code: msg.error.code, message });
        this.events?.onError(new Error(`Gemini: ${message}`));
        return;
      }

      if (msg.serverContent) this.handleServerContent(msg.serverContent);
      if (msg.toolCall) this.handleToolCall(msg.toolCall);

    } catch (err) {
      log.error('Failed to parse message', err);
    }
  }

  private handleServerContent(content: GeminiServerContent): void {
    if (content.interrupted) {
      this.state.flushOutputTranscript(null);
      this.events?.onInterrupt?.();
      return;
    }

    const parts = content.modelTurn?.parts || [];

    // Process Audio and Text
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

    // Process Transcripts (Input)
    if (content.inputTranscript) {
      this.state.addInputTranscript(content.inputTranscript, this.events);
    }

    // Capture Tool Calls internally but DO NOT output to UI transcript
    // The actual agent audio transcript will be generated by Deepgram
    if (content.turnComplete) {
      this.state.flushOutputTranscript(null);
      this.events?.onTurnComplete?.();
    }
  }

  private async handleToolCall(toolCall: GeminiToolCall): Promise<void> {
    if (!this.events?.onToolCall || !this.connection?.isReady() || !toolCall.functionCalls?.length) return;

    const responses = await Promise.all(
      toolCall.functionCalls.map(async (call) => {
        log.info('Tool call', { name: call.name });

        // Gemini's ID must be used as-is — sending a different ID crashes the connection (1008/1007)
        const id = call.id || crypto.randomUUID();
        
        try {
          const result = await this.events!.onToolCall!({
            id,
            name: call.name,
            arguments: call.args || {},
          });
          
          if (result.error) {
            log.warn('Tool execution returned error', { name: call.name, error: result.error });
            return {
              id: result.callId,
              name: call.name,
              response: { error: result.error }
            };
          }

          return {
            id: result.callId,
            name: call.name,
            response: { result: result.result }
          };
        } catch (err) {
          log.error('Tool execution threw exception', err, { name: call.name });
          return {
            id,
            name: call.name,
            response: { error: err instanceof Error ? err.message : 'Unknown execution error' }
          };
        }
      })
    );

    this.connection.send(GeminiMapper.buildToolResponsePayload(responses));
  }
}
