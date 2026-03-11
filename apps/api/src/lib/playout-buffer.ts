const INTERVAL_MS = 20;
const MAX_QUEUE = 100; // ~2s cap at 20ms/chunk

export class PlayoutBuffer {
  private queue: Buffer[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly drain: (chunk: Buffer) => void;

  constructor(drain: (chunk: Buffer) => void) {
    this.drain = drain;
  }

  push(chunk: Buffer): void {
    if (this.queue.length >= MAX_QUEUE) {
      this.queue.shift();
    }
    this.queue.push(chunk);
    if (!this.timer) this.start();
  }

  clear(): void {
    this.queue = [];
    this.stop();
  }

  destroy(): void {
    this.clear();
  }

  private start(): void {
    this.timer = setInterval(() => {
      const chunk = this.queue.shift();
      if (chunk) {
        this.drain(chunk);
      } else {
        this.stop();
      }
    }, INTERVAL_MS);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
