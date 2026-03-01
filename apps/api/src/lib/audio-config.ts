export const STREAM = {
  track: 'inbound_track',
  codec: 'L16',
  bidirectionalMode: 'rtp',
} as const;

export const INBOUND = {
  sampleRate: 16000,
  encoding: 'linear16',
  channels: 1,
  endian: 'big',
} as const;

export const OUTBOUND = {
  sampleRate: 16000,
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
  agentRate: GEMINI.outputRate,
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

export function downsample24to16(buf: Buffer): Buffer {
  const inputSamples = buf.length / 2;
  const outputSamples = Math.floor(inputSamples * 2 / 3);
  const out = Buffer.allocUnsafe(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i * 1.5;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;

    const s0 = buf.readInt16LE(srcIdx * 2);
    const s1 = srcIdx + 1 < inputSamples ? buf.readInt16LE((srcIdx + 1) * 2) : s0;

    const interpolated = Math.round(s0 + frac * (s1 - s0));
    out.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2);
  }

  return out;
}
