// ─── Section 1: Telnyx Streaming API ────────────────────────────────────────

export const TELNYX_STREAM = {
  track: 'inbound_track',
  codec: 'L16',
  bidirectionalMode: 'rtp',
  bidirectionalCodec: 'L16',
  bidirectionalSamplingRate: 24_000,
} as const;

export const TELNYX_SIP = {
  preferredCodecs: 'PCMU,PCMA,G722,OPUS',
} as const;

// ─── Section 2: Inbound (Telnyx → us) ──────────────────────────────────────

export const INBOUND = {
  sampleRate: 24_000 as const,
  endian: 'little' as 'big' | 'little',
};

// ─── Section 3: Outbound (us → Telnyx) ─────────────────────────────────────

export const OUTBOUND = {
  sampleRate: 24_000,
  gain: 1.5,
} as const;

export function applyGain(buf: Buffer, gain: number): Buffer {
  if (gain === 1.0) return buf;
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i <= buf.length - 2; i += 2) {
    const sample = buf.readInt16LE(i);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * gain))), i);
  }
  return out;
}

// ─── Section 4: Gemini ─────────────────────────────────────────────────────

export const GEMINI = {
  inputRate: 16_000,
  outputRate: 24_000,
  mimeType: (rate: number) => `audio/pcm;rate=${rate}`,
} as const;

// ─── Section 5: Deepgram ───────────────────────────────────────────────────

export const DEEPGRAM = {
  customerRate: INBOUND.sampleRate,
  agentRate: GEMINI.outputRate,
  encoding: 'linear16',
  model: 'nova-3',
  language: 'he',
} as const;

// ─── Section 6: Utilities ──────────────────────────────────────────────────

export const NEEDS_ENDIAN_SWAP = INBOUND.endian === 'big';

export function swapEndian16(buf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length - 1; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  return out;
}

export function peakAmplitude(buf: Buffer, endian: 'big' | 'little'): number {
  let peak = 0;
  const read = endian === 'big'
    ? (offset: number) => buf.readInt16BE(offset)
    : (offset: number) => buf.readInt16LE(offset);
  for (let i = 0; i < buf.length - 1; i += 2) {
    const abs = Math.abs(read(i));
    if (abs > peak) peak = abs;
  }
  return peak;
}

export function diagnoseChunk(buf: Buffer): { peak: number; status: 'OK' | 'SUSPECT' | 'SILENT' } {
  const peak = peakAmplitude(buf, INBOUND.endian);
  if (peak === 0) return { peak, status: 'SILENT' };
  if (peak < 500) return { peak, status: 'SUSPECT' };
  return { peak, status: 'OK' };
}

export function downsample24kTo16k(input: Buffer, carry: Buffer = Buffer.alloc(0)): { out: Buffer, carry: Buffer } {
  const buf = carry.length > 0 ? Buffer.concat([carry, input]) : input;
  const inSamples = buf.length >> 1;
  const usable = inSamples - (inSamples % 3);
  const outSamples = (usable * 2) / 3;
  const out = Buffer.allocUnsafe(outSamples * 2);

  for (let o = 0; o < outSamples; o++) {
    const inPos = (o * 3) / 2;
    const i0 = Math.floor(inPos);
    const frac = inPos - i0;

    const s0 = buf.readInt16LE(i0 * 2);
    const s1 = buf.readInt16LE((i0 + 1) * 2);

    const v = Math.round(s0 + frac * (s1 - s0));
    out.writeInt16LE(Math.max(-32768, Math.min(32767, v)), o * 2);
  }

  const nextCarry = usable < inSamples ? Buffer.from(buf.subarray(usable * 2)) : Buffer.alloc(0);
  return { out, carry: nextCarry };
}

// ─── Section 7: Telnyx param builders ──────────────────────────────────────

export function getStreamUrl(): string {
  const base = process.env.API_URL || 'http://localhost:3000';
  return base.replace('http', 'ws') + '/ws/media';
}

export function buildAnswerParams(streamUrl: string) {
  return {
    preferred_codecs: TELNYX_SIP.preferredCodecs,
    stream_url: streamUrl,
    stream_track: TELNYX_STREAM.track,
    stream_codec: TELNYX_STREAM.codec,
    stream_bidirectional_mode: TELNYX_STREAM.bidirectionalMode,
    stream_bidirectional_codec: TELNYX_STREAM.bidirectionalCodec,
    stream_bidirectional_sampling_rate: TELNYX_STREAM.bidirectionalSamplingRate,
  };
}

export function buildDialStreamParams(streamUrl: string) {
  return {
    stream_url: streamUrl,
    stream_track: TELNYX_STREAM.track,
    stream_codec: TELNYX_STREAM.codec,
    stream_bidirectional_mode: TELNYX_STREAM.bidirectionalMode,
    stream_bidirectional_codec: TELNYX_STREAM.bidirectionalCodec,
    stream_bidirectional_sampling_rate: TELNYX_STREAM.bidirectionalSamplingRate,
  };
}
