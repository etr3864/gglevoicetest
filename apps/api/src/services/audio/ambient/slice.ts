import type { LoopState } from './loop-state';
import { advanceLoop } from './loop-state';

export function sliceAndAdvance(state: LoopState, byteCount: number): Buffer {
  const { buffer, offset } = state;
  const end = offset + byteCount;

  let slice: Buffer;
  if (end <= buffer.length) {
    slice = buffer.subarray(offset, end);
  } else {
    slice = Buffer.concat([buffer.subarray(offset), buffer.subarray(0, end - buffer.length)]);
  }

  advanceLoop(state, byteCount);
  return slice;
}
