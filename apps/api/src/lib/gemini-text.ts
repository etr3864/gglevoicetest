import { GoogleAuth } from 'google-auth-library';
import { createLogger } from './logger';

const log = createLogger('gemini-text');

const MODEL = 'gemini-2.5-flash';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2_000;

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

let cachedEndpoint: string | null = null;

function getEndpoint(): string {
  if (cachedEndpoint) return cachedEndpoint;
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || 'us-central1';
  if (!project) throw new Error('GCP_PROJECT_ID missing');
  cachedEndpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${MODEL}:generateContent`;
  return cachedEndpoint;
}

async function getAccessToken(): Promise<string> {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to get GCP access token');
  return token.token;
}

export interface TextGenerationResult {
  text: string;
  tokenCount: number | null;
}

export async function generateText(systemPrompt: string, userContent: string): Promise<TextGenerationResult> {
  const endpoint = getEndpoint();

  const body = {
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { maxOutputTokens: 4096, temperature: 0.3 },
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const accessToken = await getAccessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * 2 ** attempt;
        log.warn('Vertex AI rate limited, retrying', { attempt, delay });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        throw new Error(`Vertex AI generateContent ${res.status}: ${err.slice(0, 200)}`);
      }

      const data = (await res.json()) as VertexGenerateResponse;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const tokenCount = data.usageMetadata?.totalTokenCount ?? null;
      return { text, tokenCount };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('Vertex AI rate limited after retries');
}

interface VertexGenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { totalTokenCount?: number };
}
