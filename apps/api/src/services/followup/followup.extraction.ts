import { generateText } from '../../lib/gemini-text';
import { createLogger } from '../../lib/logger';

const log = createLogger('followup-extraction');

const VALID_DISPOSITIONS = ['interested', 'not_interested', 'partial', 'ambiguous'] as const;
type ExtractedDisposition = (typeof VALID_DISPOSITIONS)[number];

const MAX_CONCURRENCY = 10;
let activeCalls = 0;
const waitQueue: Array<() => void> = [];

const SYSTEM_PROMPT = `You are a call disposition classifier. Analyze the transcript and return ONLY a JSON object.
Possible dispositions:
- "interested": Customer showed interest, asked questions, engaged positively
- "not_interested": Customer explicitly declined, not interested
- "partial": Customer was somewhat interested but hesitant or undecided
- "ambiguous": Cannot determine from transcript

Return ONLY: {"disposition": "one_of_the_above"}
No explanation, no extra text.`;

export async function extractDispositionFromTranscript(transcript: string, agentContext?: string): Promise<ExtractedDisposition> {
  await acquireSemaphore();

  const userMessage = agentContext
    ? `Agent goal: ${agentContext}\n\nTranscript:\n${transcript}`
    : transcript;

  try {
    const { text } = await generateText(SYSTEM_PROMPT, userMessage);
    return parseDisposition(text);
  } catch (err) {
    log.error('Extraction failed, defaulting to ambiguous', err);
    return 'ambiguous';
  } finally {
    releaseSemaphore();
  }
}

function parseDisposition(raw: string): ExtractedDisposition {
  try {
    const parsed = JSON.parse(raw);
    if (VALID_DISPOSITIONS.includes(parsed.disposition)) {
      return parsed.disposition;
    }
  } catch {}

  const match = raw.match(/"disposition"\s*:\s*"(\w+)"/);
  if (match && VALID_DISPOSITIONS.includes(match[1] as ExtractedDisposition)) {
    return match[1] as ExtractedDisposition;
  }

  log.warn('Could not parse disposition, defaulting to ambiguous', { raw: raw.slice(0, 200) });
  return 'ambiguous';
}

function acquireSemaphore(): Promise<void> {
  if (activeCalls < MAX_CONCURRENCY) {
    activeCalls++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitQueue.push(resolve));
}

function releaseSemaphore(): void {
  const next = waitQueue.shift();
  if (next) {
    next();
  } else {
    activeCalls = Math.max(0, activeCalls - 1);
  }
}
