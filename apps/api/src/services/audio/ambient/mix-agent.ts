import { OUTBOUND } from '../../../lib/audio-config';
import { MAX_AMBIENT_VOLUME, SOFT_THRESHOLD, SOFT_RATIO } from './constants';
import type { LoopState } from './loop-state';
import { sliceAndAdvance } from './slice';

function effectiveAgentGain(ambientVolume: number): number {
  return Math.max(0, OUTBOUND.gain * (1 - (ambientVolume / MAX_AMBIENT_VOLUME) * 0.5));
}

function softLimitSample(s: number): number {
  if (s > SOFT_THRESHOLD) return SOFT_THRESHOLD + (s - SOFT_THRESHOLD) * SOFT_RATIO;
  if (s < -SOFT_THRESHOLD) return -SOFT_THRESHOLD + (s + SOFT_THRESHOLD) * SOFT_RATIO;
  return s;
}

export function mixAgentWithAmbient(agentChunk: Buffer, loop: LoopState, volume: number): Buffer {
  const byteCount = agentChunk.length;
  const ambientSlice = sliceAndAdvance(loop, byteCount);
  const gain = effectiveAgentGain(volume);
  const out = Buffer.allocUnsafe(byteCount);

  for (let i = 0; i <= byteCount - 2; i += 2) {
    const mixed = agentChunk.readInt16LE(i) * gain + ambientSlice.readInt16LE(i) * volume;
    out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(softLimitSample(mixed)))), i);
  }

  return out;
}
