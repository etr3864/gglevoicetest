import { OUTBOUND } from './audio-config';

const PACKET_MS = 20;
const BYTES_PER_PACKET = Math.round((OUTBOUND.sampleRate / 1000) * PACKET_MS * 2);

export class PlayoutBuffer {
  private queue: Buffer[] = [];
  private readonly drain: (chunk: Buffer) => void;

  constructor(drain: (chunk: Buffer) => void) {
    this.drain = drain;
  }

  push(chunk: Buffer): void {
    const packets = splitToPcmPackets(chunk, BYTES_PER_PACKET);
    for (const packet of packets) {
      this.queue.push(packet);
    }
    this.flush();
  }

  clear(): void {
    this.queue = [];
  }

  destroy(): void {
    this.clear();
  }

  private flush(): void {
    while (this.queue.length > 0) {
      this.drain(this.queue.shift()!);
    }
  }
}

function splitToPcmPackets(chunk: Buffer, size: number): Buffer[] {
  if (chunk.length <= size) return [chunk];

  const packets: Buffer[] = [];
  for (let offset = 0; offset < chunk.length; offset += size) {
    const end = Math.min(offset + size, chunk.length);
    const packet = Buffer.allocUnsafe(size);
    chunk.copy(packet, 0, offset, end);
    if (end - offset < size) packet.fill(0, end - offset);
    packets.push(packet);
  }
  return packets;
}
