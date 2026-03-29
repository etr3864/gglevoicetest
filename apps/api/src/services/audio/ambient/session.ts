import { applyGain, OUTBOUND } from '../../../lib/audio-config';
import { IDLE_GAP_MS, IDLE_FRAME_BYTES, IDLE_FRAME_MS } from './constants';
import type { LoopState } from './loop-state';
import { sliceAndAdvance } from './slice';
import { mixAgentWithAmbient } from './mix-agent';
import { softLimitPcm16Le } from './limiter';

export interface AmbientSession {
  processAgentChunk(agentChunk: Buffer): Buffer;
  onAgentAudioSent(): void;
  onInterrupt(): void;
  destroy(): void;
}

export function createAmbientSession(
  loop: LoopState | null,
  volume: number,
  sendRaw: (buf: Buffer) => void,
  isMuted: () => boolean,
): AmbientSession {
  let idleHandle: ReturnType<typeof setTimeout> | null = null;
  let idleActive = false;

  function cancelIdle(): void {
    idleActive = false;
    if (idleHandle !== null) {
      clearTimeout(idleHandle);
      idleHandle = null;
    }
  }

  function startIdleFill(): void {
    if (!loop || idleActive) return;
    idleActive = true;
    idleHandle = setTimeout(sendIdleFrame, IDLE_GAP_MS);
  }

  function sendIdleFrame(): void {
    idleHandle = null;
    if (!idleActive) return;

    if (!isMuted()) {
      const frame = sliceAndAdvance(loop!, IDLE_FRAME_BYTES);
      const out = Buffer.allocUnsafe(IDLE_FRAME_BYTES);
      for (let i = 0; i <= IDLE_FRAME_BYTES - 2; i += 2) {
        out.writeInt16LE(Math.round(frame.readInt16LE(i) * volume), i);
      }
      sendRaw(softLimitPcm16Le(out));
    }

    idleHandle = setTimeout(sendIdleFrame, IDLE_FRAME_MS);
  }

  startIdleFill();

  return {
    processAgentChunk(agentChunk: Buffer): Buffer {
      if (!loop) return applyGain(agentChunk, OUTBOUND.gain);
      return mixAgentWithAmbient(agentChunk, loop, volume);
    },

    onAgentAudioSent(): void {
      cancelIdle();
      startIdleFill();
    },

    onInterrupt(): void {
      cancelIdle();
      startIdleFill();
    },

    destroy(): void {
      cancelIdle();
    },
  };
}
