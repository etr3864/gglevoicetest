import WebSocket from 'ws';
import https from 'https';
import { createLogger } from '../../../lib/logger';

const log = createLogger('gemini:conn');

const CONNECT_TIMEOUT_MS = 10_000;
const KEEPALIVE_INTERVAL_MS = 25_000;

export interface ConnectionCallbacks {
  onSetupComplete: () => void;
  onMessage: (data: Buffer) => void;
  onClose: (code: number, reason: string) => void;
  onError: (err: Error) => void;
}

export class GeminiConnection {
  private ws: WebSocket | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private setupDone = false;
  private tlsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
  private setupPayload: Record<string, unknown> | null = null;

  constructor(
    private readonly url: string,
    private readonly callbacks: ConnectionCallbacks,
    private readonly headers?: Record<string, string>
  ) {}

  setSetupPayload(payload: Record<string, unknown>): void {
    this.setupPayload = payload;
  }

  async connect(isReconnect = false): Promise<void> {
    this.cleanup();
    this.setupDone = false;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.ws?.terminate();
        reject(new Error('Gemini connection timeout'));
      }, CONNECT_TIMEOUT_MS);

      this.ws = new WebSocket(this.url, { 
        agent: this.tlsAgent,
        headers: this.headers 
      });

      this.ws.on('open', () => {
        if (this.setupPayload) {
          this.ws!.send(JSON.stringify({ setup: this.setupPayload }));
        }
        this.startKeepalive();
      });

      this.ws.on('message', (data: Buffer) => {
        if (!this.setupDone) {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.setupComplete) {
              clearTimeout(timeout);
              this.setupDone = true;
              resolve();
              this.callbacks.onSetupComplete();
              return;
            }
          } catch {}
        }
        this.callbacks.onMessage(data);
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        this.callbacks.onError(err);
        reject(err);
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        this.cleanup();
        this.callbacks.onClose(code, reason?.toString());
      });
    });
  }

  send(payload: Record<string, unknown>): void {
    if (!this.isReady()) return;
    this.ws!.send(JSON.stringify(payload));
  }

  disconnect(code = 1000): void {
    this.cleanup();
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(code);
      }
      this.ws = null;
    }
  }

  isReady(): boolean {
    return this.setupDone && this.ws?.readyState === WebSocket.OPEN;
  }

  private startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private cleanup(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    this.setupDone = false;
  }
}
