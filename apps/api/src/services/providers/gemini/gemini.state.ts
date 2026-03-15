import { ProviderEvents } from '../types';

export class GeminiState {
  // Transcript accumulation
  private agentTranscriptBuf = '';
  private agentTranscriptTs: Date | null = null;
  
  // Reconnect buffer
  private reconnectBuffer: Buffer[] = [];
  
  // Conversation History (capped to prevent unbounded memory growth in long sessions)
  private static readonly MAX_HISTORY = 50;
  private history: { role: string; parts: { text: string }[] }[] = [];

  // Session resumption — each new token replaces the previous one
  private resumptionToken: string | null = null;

  // Tool calls cancelled by user interruption — responses for these IDs are discarded
  private cancelledToolIds = new Set<string>();

  setResumptionToken(token: string): void {
    this.resumptionToken = token;
  }

  getResumptionToken(): string | null {
    return this.resumptionToken;
  }

  addCancelledToolIds(ids: string[]): void {
    for (const id of ids) this.cancelledToolIds.add(id);
  }

  isToolCancelled(id: string): boolean {
    return this.cancelledToolIds.delete(id);
  }

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

  flushOutputTranscript(): void {
    const text = this.agentTranscriptBuf.trim();
    if (text) {
      this.pushHistory({ role: 'model', parts: [{ text }] });
    }
    this.agentTranscriptBuf = '';
    this.agentTranscriptTs = null;
  }

  addInputTranscript(text: string, events: ProviderEvents | null): void {
    this.pushHistory({ role: 'user', parts: [{ text }] });
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

  private pushHistory(entry: { role: string; parts: { text: string }[] }): void {
    this.history.push(entry);
    if (this.history.length > GeminiState.MAX_HISTORY) {
      this.history = this.history.slice(-GeminiState.MAX_HISTORY);
    }
  }
}
