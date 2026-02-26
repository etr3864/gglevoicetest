import WebSocket from 'ws';
import { createLogger } from '../../lib/logger';

const log = createLogger('deepgram');

const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';
const KEEPALIVE_INTERVAL_MS = 8_000;

export interface TranscriptResult {
  text: string;
  isFinal: boolean;
  confidence: number;
  startSec: number;
  durationSec: number;
}

export type OnTranscript = (result: TranscriptResult) => void;

export interface DeepgramConfig {
  language?: string;
  model?: string;
  sampleRate?: number;
  encoding?: string;
}

export class DeepgramTranscriber {
  private ws: WebSocket | null = null;
  private onResult: OnTranscript;
  private ready = false;
  private keepaliveTimer: NodeJS.Timeout | null = null;

  constructor(onResult: OnTranscript) {
    this.onResult = onResult;
  }

  connect(config?: DeepgramConfig): boolean {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      log.warn('DEEPGRAM_API_KEY not set, transcription disabled');
      return false;
    }

    const params = new URLSearchParams({
      model: config?.model ?? 'nova-3',
      language: config?.language ?? 'he',
      encoding: config?.encoding ?? 'linear16',
      sample_rate: String(config?.sampleRate ?? 16000),
      channels: '1',
      punctuate: 'true',
      interim_results: 'true',
      utterance_end_ms: '1000',
      smart_format: 'true',
    });

    this.ws = new WebSocket(`${DEEPGRAM_WS_URL}?${params}`, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    this.ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        log.error('Rejected by Deepgram', new Error(`${res.statusCode}: ${body}`));
        this.ready = false;
      });
    });

    this.ws.on('open', () => {
      this.ready = true;
      this.startKeepalive();
    });

    this.ws.on('message', (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type !== 'Results') return;

        const alt = data.channel?.alternatives?.[0];
        if (!alt?.transcript) return;

        this.onResult({
          text: alt.transcript,
          isFinal: data.is_final ?? true,
          confidence: alt.confidence ?? 0,
          startSec: data.start ?? 0,
          durationSec: data.duration ?? 0,
        });
      } catch (err) {
        log.error('Failed to parse message', err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.ws.on('error', (err) => {
      log.error('Connection error', err);
      this.ready = false;
    });

    this.ws.on('close', (_code, _reason) => {
      this.ready = false;
      this.stopKeepalive();
      this.ws = null;
    });

    return true;
  }

  sendAudio(buffer: Buffer): void {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
    }
  }

  close(): void {
    if (!this.ws) return;
    this.ready = false;
    this.stopKeepalive();
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000);
    }
    this.ws = null;
  }

  private startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }
}
