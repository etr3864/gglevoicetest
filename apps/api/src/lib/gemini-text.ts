import { GoogleAuth } from 'google-auth-library';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

const SUMMARY_MODEL = 'gemini-2.0-flash';
const REQUEST_TIMEOUT_MS = 30_000;

export interface TextGenerationResult {
  text: string;
  tokenCount: number | null;
}

export async function generateText(systemPrompt: string, userContent: string): Promise<TextGenerationResult> {
  const location = process.env.GCP_LOCATION || 'europe-west3';
  const project = process.env.GCP_PROJECT_ID;
  if (!project) throw new Error('GCP_PROJECT_ID missing');

  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to get GCP access token');

  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${SUMMARY_MODEL}:generateContent`;

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
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

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
