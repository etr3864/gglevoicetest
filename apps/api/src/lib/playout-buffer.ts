import { OUTBOUND } from './audio-config';

const PACKET_MS = 20;
const MAX_QUEUE_MS = 2000;
const SILENCE_PADDING_PACKETS = 5; // 100ms smooth tail after speech ends

// PCM16 = 2 bytes/sample; 24kHz × 20ms = 480 samples = 960 bytes
const BYTES_PER_PACKET = Math.round((OUTBOUND.sampleRate / 1000) * PACKET_MS * 2);
const MAX_QUEUE_PACKETS = Math.round(MAX_QUEUE_MS / PACKET_MS);

export class PlayoutBuffer {
  private queue: Buffer[] = [];
  private timer: NodeJS.Timeout | null = null;
  private silenceCount = 0;
  private expectedAt = 0;
  private readonly silenceFrame = Buffer.alloc(BYTES_PER_PACKET);
  private readonly drain: (chunk: Buffer) => void;

  constructor(drain: (chunk: Buffer) => void) {
    this.drain = drain;
  }

  push(chunk: Buffer): void {
    for (const packet of splitToPcmPackets(chunk, BYTES_PER_PACKET)) {
      if (this.queue.length < MAX_QUEUE_PACKETS) {
        this.queue.push(packet);
      }
    }
    if (!this.timer) {
      this.expectedAt = performance.now();
      this.timer = setTimeout(() => this.tick(), 0);
    }
  }

  /** Hard stop — used on interrupt. No silence tail. */
  clear(): void {
    this.queue = [];
    this.stop();
  }

  destroy(): void {
    this.clear();
  }

  private tick(): void {
    const now = performance.now();
    const drift = now - this.expectedAt;

    const packet = this.queue.shift();
    if (packet) {
      this.drain(packet);
      this.silenceCount = 0;
    } else if (this.silenceCount < SILENCE_PADDING_PACKETS) {
      this.drain(this.silenceFrame);
      this.silenceCount++;
    } else {
      this.stop();
      return;
    }

    this.expectedAt += PACKET_MS;
    this.timer = setTimeout(() => this.tick(), Math.max(0, PACKET_MS - drift));
  }

  private stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.silenceCount = 0;
  }
}

function splitToPcmPackets(chunk: Buffer, size: number): Buffer[] {
  const packets: Buffer[] = [];
  for (let offset = 0; offset < chunk.length; offset += size) {
    const end = Math.min(offset + size, chunk.length);
    const packet = Buffer.allocUnsafe(size);
    chunk.copy(packet, 0, offset, end);
    if (end - offset < size) packet.fill(0, end - offset); // zero-pad last
    packets.push(packet);
  }
  return packets;
}
