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
  sampleRate: 24_000,
  endian: 'big',
} as const;

// ─── Section 3: Outbound (us → Telnyx) ─────────────────────────────────────

export const OUTBOUND = {
  sampleRate: 24_000,
} as const;

// ─── Section 4: Gemini ─────────────────────────────────────────────────────

export const GEMINI = {
  inputRate: INBOUND.sampleRate,
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
