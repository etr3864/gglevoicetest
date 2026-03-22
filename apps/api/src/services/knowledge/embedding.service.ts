import { GoogleAuth } from 'google-auth-library';
import { createLogger } from '../../lib/logger';
import type { EmbedBatchResult } from './types';

const log = createLogger('knowledge:embedding');

const MODEL = 'text-multilingual-embedding-002';
const DIMENSIONS = 768;
const BATCH_SIZE = 250;
const TIMEOUT_MS = 8_000;

// Token bucket: max 1500 req/min per Vertex AI quota
const RATE_BUCKET = { tokens: 25, lastRefillMs: Date.now(), maxTokens: 25, refillPerMs: 25 / 1000 };

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

async function getAccessToken(): Promise<string> {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to get GCP access token');
  return token.token;
}

function buildEndpoint(): string {
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || 'europe-west3';
  if (!project) throw new Error('GCP_PROJECT_ID missing');
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${MODEL}:predict`;
}

function acquireRateLimitToken(): boolean {
  const now = Date.now();
  const elapsed = now - RATE_BUCKET.lastRefillMs;
  RATE_BUCKET.tokens = Math.min(RATE_BUCKET.maxTokens, RATE_BUCKET.tokens + elapsed * RATE_BUCKET.refillPerMs);
  RATE_BUCKET.lastRefillMs = now;
  if (RATE_BUCKET.tokens < 1) return false;
  RATE_BUCKET.tokens -= 1;
  return true;
}

async function waitForRateLimit(): Promise<void> {
  while (!acquireRateLimitToken()) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function callEmbeddingApi(texts: string[], isQuery = false): Promise<EmbedBatchResult> {
  await waitForRateLimit();

  const [accessToken, endpoint] = await Promise.all([getAccessToken(), Promise.resolve(buildEndpoint())]);

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
