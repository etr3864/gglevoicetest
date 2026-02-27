import { ProviderEvents, TranscriptEntry } from '../types';

export class GeminiState {
  // Transcript accumulation
  private agentTranscriptBuf = '';
  private agentTranscriptTs: Date | null = null;
  
  // Reconnect buffer
  private reconnectBuffer: Buffer[] = [];
  
  // Conversation History
  private history: { role: string; parts: { text: string }[] }[] = [];

  pushAudioBuffer(chunk: Buffer, maxChunks: number): void {
    if (this.reconnectBuffer.length < maxChunks) {
      this.reconnectBuffer.push(chunk);
    }
  }

  drainAudioBuffer(): Buffer[] {
    const chunks = this.reconnectBuffer;
    this.reconnectBuffer = [];
    return chunks;
  }

  clearAudioBuffer(): void {
    this.reconnectBuffer = [];
  }

  // --- Transcript & History ---

  appendOutputTranscript(text: string): void {
    if (!this.agentTranscriptTs) this.agentTranscriptTs = new Date();
    this.agentTranscriptBuf += text;
  }

  flushOutputTranscript(events: ProviderEvents | null): void {
    const text = this.agentTranscriptBuf.trim();
    if (text) {
      this.history.push({ role: 'model', parts: [{ text }] });
      // We no longer emit this to the UI to avoid showing the model's internal
      // markdown "thoughts". Instead, we use Deepgram to transcribe the actual audio.
      // events?.onTranscript({
      //   speaker: 'agent',
      //   text,
      //   timestamp: this.agentTranscriptTs ?? new Date(),
      //   isFinal: true,
      // });
    }
    this.agentTranscriptBuf = '';
    this.agentTranscriptTs = null;
  }

  addInputTranscript(text: string, events: ProviderEvents | null): void {
    this.history.push({ role: 'user', parts: [{ text }] });
    events?.onTranscript({
      speaker: 'customer',
      text,
      timestamp: new Date(),
      isFinal: true,
    });
  }

  getMergedHistory(): { role: string; parts: { text: string }[] }[] {
    if (this.history.length === 0) return [];

    return this.history.reduce((acc, curr) => {
      const last = acc[acc.length - 1];
      if (last && last.role === curr.role) {
        last.parts.push(...curr.parts);
      } else {
        acc.push({ role: curr.role, parts: [...curr.parts] });
      }
      return acc;
    }, [] as typeof this.history);
  }

  getAgentTranscriptTs(): Date {
    if (!this.agentTranscriptTs) this.agentTranscriptTs = new Date();
    return this.agentTranscriptTs;
  }
}
