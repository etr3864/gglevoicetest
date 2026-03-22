import { GoogleAuth } from 'google-auth-library';
import { createLogger } from '../../lib/logger';
import { redis } from '../../lib/redis';
import type { EmbedBatchResult } from './types';

const log = createLogger('knowledge:embedding');

const MODEL = 'text-multilingual-embedding-002';
const DIMENSIONS = 768;
// Vertex AI: max 20,000 tokens per request total; Hebrew ≈ 3 chars/token
const BATCH_SIZE = 15;
const TIMEOUT_MS = 10_000;

// Distributed rate limit: 20 req/s shared across all pods (Vertex AI quota: 1500 req/min)
const RATE_KEY = 'embedding:rate';
const RATE_WINDOW_MS = 1_000;
const RATE_MAX_PER_WINDOW = 20;

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

async function getAccessToken(): Promise<string> {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to get GCP access token');
  return token.token;
}

let cachedEndpoint: string | null = null;

function getEndpoint(): string {
  if (cachedEndpoint) return cachedEndpoint;
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || 'europe-west3';
  if (!project) throw new Error('GCP_PROJECT_ID missing');
  cachedEndpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${MODEL}:predict`;
  return cachedEndpoint;
}

async function waitForRateLimit(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const now = Date.now();
    const windowKey = `${RATE_KEY}:${Math.floor(now / RATE_WINDOW_MS)}`;
    const count = await redis.incr(windowKey);
    if (count === 1) await redis.pexpire(windowKey, RATE_WINDOW_MS * 2);
    if (count <= RATE_MAX_PER_WINDOW) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  log.warn('Rate limit wait exceeded 5s, proceeding anyway');
}

async function callEmbeddingApi(texts: string[], isQuery = false): Promise<EmbedBatchResult> {
  await waitForRateLimit();

  const [accessToken, endpoint] = await Promise.all([getAccessToken(), Promise.resolve(getEndpoint())]);

  const taskType = isQuery ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
  const body = {
    instances: texts.map((content) => ({ content, task_type: taskType })),
    parameters: { outputDimensionality: DIMENSIONS },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Embedding API ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = (await res.json()) as VertexEmbedResponse;
    const vectors = data.predictions.map((p) => p.embeddings.values);
    const tokenCount = data.predictions.reduce((sum, p) => sum + (p.embeddings.statistics?.token_count ?? 0), 0);

    return { vectors, tokenCount };
  } finally {
    clearTimeout(timer);
  }
}

export async function embedTexts(texts: string[]): Promise<EmbedBatchResult> {
  if (texts.length === 0) return { vectors: [], tokenCount: 0 };

  const allVectors: number[][] = [];
  let totalTokens = 0;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const result = await callEmbeddingApi(batch);
    allVectors.push(...result.vectors);
    totalTokens += result.tokenCount;
  }

  return { vectors: allVectors, tokenCount: totalTokens };
}

export async function embedQuery(text: string): Promise<{ vector: number[]; tokenCount: number }> {
  const result = await callEmbeddingApi([text], true);
  return { vector: result.vectors[0], tokenCount: result.tokenCount };
}

export async function warmupEmbedding(): Promise<void> {
  try {
    await callEmbeddingApi(['warmup']);
    log.info('Embedding API warmed up');
  } catch (err) {
    log.warn('Embedding warmup failed (non-fatal)', { err: String(err) });
  }
}

interface VertexEmbedResponse {
  predictions: {
    embeddings: {
      values: number[];
      statistics?: { token_count: number };
    };
  }[];
}
