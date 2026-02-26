import { parentPort, isMainThread, Worker } from 'worker_threads';
import path from 'path';

/**
 * Stateful downsampler: PCM16 LE 24kHz → 16kHz (ratio 3:2).
 * Carries remainder samples across chunks to avoid boundary artifacts.
 */
export class Downsampler24kTo16k {
  private carry = Buffer.alloc(0);

  process(pcm24k: Buffer): Buffer {
    const input = this.carry.length > 0
      ? Buffer.concat([this.carry, pcm24k])
      : pcm24k;

    const inSamples = input.length >> 1;
    const usable = inSamples - (inSamples % 3);
    const outSamples = (usable * 2) / 3;
    const out = Buffer.alloc(outSamples * 2);

    for (let o = 0; o < outSamples; o++) {
      const inPos = (o * 3) / 2;
      const i0 = Math.floor(inPos);
      const frac = inPos - i0;

      const s0 = input.readInt16LE(i0 * 2);
      const s1 = input.readInt16LE((i0 + 1) * 2);

      const v = Math.round(s0 + frac * (s1 - s0));
      out.writeInt16LE(Math.max(-32768, Math.min(32767, v)), o * 2);
    }

    this.carry = usable < inSamples
      ? Buffer.from(input.subarray(usable * 2))
      : Buffer.alloc(0);

    return out;
  }
}

// -----------------------------------------------------------------------------
// Worker Thread Logic
// -----------------------------------------------------------------------------

if (!isMainThread && parentPort) {
  const sessions = new Map<string, Downsampler24kTo16k>();

  parentPort.on('message', (msg) => {
    if (msg.type === 'process') {
      let ds = sessions.get(msg.callControlId);
      if (!ds) {
        ds = new Downsampler24kTo16k();
        sessions.set(msg.callControlId, ds);
      }
      
      const out = ds.process(Buffer.from(msg.chunk));
      
      parentPort!.postMessage({
        type: 'result',
        callControlId: msg.callControlId,
        chunk: out,
      });
    } else if (msg.type === 'cleanup') {
      sessions.delete(msg.callControlId);
    }
  });
}

// -----------------------------------------------------------------------------
// Worker Pool (Main Thread)
// -----------------------------------------------------------------------------

export class AudioWorkerPool {
  private workers: Worker[] = [];
  private callbacks = new Map<string, (chunk: Buffer) => void>();
  private nextWorkerIndex = 0;

  constructor(poolSize: number = 2) {
    if (isMainThread) {
      // In development with tsx, __filename is the .ts file
      // In production, it will be the .js file
      for (let i = 0; i < poolSize; i++) {
        const worker = new Worker(__filename, {
          // If we run via tsx, we might need to pass execArgv to support TS
          execArgv: process.execArgv.includes('--loader') || process.execArgv.some(a => a.includes('tsx'))
            ? process.execArgv
            : undefined,
        });

        worker.on('message', (msg) => {
          if (msg.type === 'result') {
            const cb = this.callbacks.get(msg.callControlId);
            if (cb) {
              cb(Buffer.from(msg.chunk));
            }
          }
        });

        worker.on('error', (err) => {
          console.error(`Audio worker error:`, err);
        });

        this.workers.push(worker);
      }
    }
  }

  register(callControlId: string, onResult: (chunk: Buffer) => void) {
    this.callbacks.set(callControlId, onResult);
  }

  process(callControlId: string, pcm24k: Buffer) {
    if (this.workers.length === 0) return;
    
    // Simple round-robin routing per call is bad because state is maintained per-worker.
    // We must route the SAME callControlId to the SAME worker consistently.
    // A simple hash of the string can pick the worker consistently.
    let hash = 0;
    for (let i = 0; i < callControlId.length; i++) {
      hash = Math.imul(31, hash) + callControlId.charCodeAt(i) | 0;
    }
    const index = Math.abs(hash) % this.workers.length;
    
    this.workers[index].postMessage({
      type: 'process',
      callControlId,
      chunk: pcm24k,
    });
  }

  cleanup(callControlId: string) {
    this.callbacks.delete(callControlId);
    
    let hash = 0;
    for (let i = 0; i < callControlId.length; i++) {
      hash = Math.imul(31, hash) + callControlId.charCodeAt(i) | 0;
    }
    if (this.workers.length > 0) {
      const index = Math.abs(hash) % this.workers.length;
      this.workers[index].postMessage({ type: 'cleanup', callControlId });
    }
  }

  close() {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
  }
}

// Global instance to be used across the app
export const audioWorkerPool = new AudioWorkerPool(parseInt(process.env.AUDIO_POOL_SIZE || '4'));