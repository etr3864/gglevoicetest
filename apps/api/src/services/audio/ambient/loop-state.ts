export interface LoopState {
  buffer: Buffer;
  offset: number;
}

export function createLoopState(buffer: Buffer): LoopState {
  return { buffer, offset: 0 };
}

export function advanceLoop(state: LoopState, bytes: number): void {
  state.offset = (state.offset + bytes) % state.buffer.length;
}
