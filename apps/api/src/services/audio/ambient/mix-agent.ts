import { OUTBOUND } from '../../../lib/audio-config';
import { MAX_AMBIENT_VOLUME } from './constants';
import type { LoopState } from './loop-state';
import { sliceAndAdvance } from './slice';
import { softLimitPcm16Le } from './limiter';

function effectiveAgentGain(ambientVolume: number): number {
  // Reduce agent gain proportionally so combined peak stays under headroom
  return OUTBOUND.gain * (1 - (ambientVolume / MAX_AMBIENT_VOLUME) * 0.3);
}

export function mixAgentWithAmbient(agentChunk: Buffer, loop: LoopState, volume: number): Buffer {
  const byteCount = agentChunk.length;
  const ambientSlice = sliceAndAdvance(loop, byteCount);
  const gain = effectiveAgentGain(volume);
  const out = Buffer.allocUnsafe(byteCount);

  for (let i = 0; i <= byteCount - 2; i += 2) {
    const agent = Math.round(agentChunk.readInt16LE(i) * gain);
    const ambient = Math.round(ambientSlice.readInt16LE(i) * volume);
    out.writeInt16LE(agent + ambient, i);
  }

  return softLimitPcm16Le(out);
}
