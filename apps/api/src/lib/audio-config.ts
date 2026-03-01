export const STREAM = {
  track: 'both_tracks',
  codec: 'L16',
  bidirectionalMode: 'rtp',
} as const;

export const INBOUND = {
  sampleRate: 24000,
  encoding: 'linear16',
  channels: 1,
  endian: 'big',
} as const;

export const OUTBOUND = {
  sampleRate: 24000,
  encoding: 'linear16',
  channels: 1,
} as const;

export const GEMINI = {
  inputRate: INBOUND.sampleRate,
  outputRate: 24000,
  mimeType: (rate: number) => `audio/pcm;rate=${rate}`,
} as const;

export const DEEPGRAM = {
  customerRate: INBOUND.sampleRate,
  agentRate: OUTBOUND.sampleRate,
  encoding: 'linear16',
  model: 'nova-3',
  language: 'he',
} as const;

export const NEEDS_ENDIAN_SWAP = INBOUND.endian === 'big';

export function swapEndian16(buf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length - 1; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  return out;
}
