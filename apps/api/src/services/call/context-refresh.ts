import { createLogger } from '../../lib/logger';
import { generateText } from '../../lib/gemini-text';
import { getTranscripts } from './session';
import type { VoiceProvider } from '../providers/types';

const log = createLogger('context-refresh');

const MIN_TRANSCRIPT_ENTRIES = 6;

const SYSTEM_PROMPT = `You are summarizing an in-progress phone call to maintain agent continuity.
Write a brief factual summary (max 120 words) in the SAME LANGUAGE as the conversation:
- Customer identity and key details mentioned
- Purpose of the call
- Key points discussed
- Commitments made (bookings, callbacks, etc.)
- What still needs to happen
Third person, factual, no filler.`;

function formatTranscript(entries: { speaker: string; text: string }[]): string {
  return entries.map((e) => `${e.speaker === 'agent' ? 'Agent' : 'Customer'}: ${e.text}`).join('\n');
}

export async function injectMidCallSummary(
  callControlId: string,
  callId: string,
  provider: VoiceProvider,
  totalTokens: number,
): Promise<void> {
  const transcripts = await getTranscripts(callControlId);
  if (transcripts.length < MIN_TRANSCRIPT_ENTRIES) return;

  const { text: summary } = await generateText(SYSTEM_PROMPT, formatTranscript(transcripts));
  if (!summary.trim()) return;

  provider.injectContext?.(summary);

  log.info('Context refreshed mid-call', {
    callId,
    totalTokens,
    summaryWords: summary.split(/\s+/).length,
  });
}
