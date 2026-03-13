import { geminiKeyPool } from '../services/providers/key-pool';

const SUMMARY_MODEL = 'gemini-2.0-flash';
const REQUEST_TIMEOUT_MS = 30_000;

export interface TextGenerationResult {
  text: string;
  tokenCount: number | null;
}

export async function generateText(systemPrompt: string, userContent: string): Promise<TextGenerationResult> {
  const apiKey = geminiKeyPool.next();
  if (!apiKey || apiKey === 'vertex-auth-mode') throw new Error('No Gemini API key available');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${SUMMARY_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { maxOutputTokens: 4096, temperature: 0.3 },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 429) {
      geminiKeyPool.markRateLimited(apiKey);
      throw new Error('Gemini API rate limited');
    }

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Gemini generateContent ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json() as GeminiGenerateResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const tokenCount = data.usageMetadata?.totalTokenCount ?? null;
    return { text, tokenCount };
  } finally {
    clearTimeout(timer);
  }
}

interface GeminiGenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { totalTokenCount?: number };
}
