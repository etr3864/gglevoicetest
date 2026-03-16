import { GoogleAuth } from 'google-auth-library';

const PROJECT_ID = process.env.GCP_PROJECT_ID;
const RAG_LOCATION = process.env.GCP_RAG_LOCATION || 'europe-west4';
const BASE_URL = `https://${RAG_LOCATION}-aiplatform.googleapis.com/v1`;
const EMBEDDING_MODEL = 'publishers/google/models/text-multilingual-embedding-002';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

async function getHeaders(): Promise<Record<string, string>> {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' };
}

function requireProject(): string {
  if (!PROJECT_ID) throw new Error('GCP_PROJECT_ID not set');
  return PROJECT_ID;
}

function corporaBase(): string {
  return `${BASE_URL}/projects/${requireProject()}/locations/${RAG_LOCATION}/ragCorpora`;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers = await getHeaders();
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vertex RAG API ${method} ${url} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

interface LroResponse<T> {
  name: string;
  done?: boolean;
  error?: { code: number; message: string };
  response?: T;
}

async function waitForOperation<T>(operationName: string, maxWaitMs = 60_000): Promise<T> {
  const interval = 2_000;
  const attempts = Math.ceil(maxWaitMs / interval);
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, interval));
    const status = await request<LroResponse<T>>('GET', `${BASE_URL}/${operationName}`);
    if (status.done) {
      if (status.error) throw new Error(`Operation failed: ${status.error.message}`);
      return status.response as T;
    }
  }
  throw new Error(`Operation timed out after ${maxWaitMs}ms: ${operationName}`);
}

export interface RagCorpus {
  name: string;
  displayName: string;
}

export interface RagOperationResult {
  operationId: string;
}

export interface RagFileRef {
  name: string;
}

export interface OperationStatus {
  done: boolean;
  error?: { code: number; message: string };
  response?: { importedRagFilesCount?: number; failedRagFilesCount?: number };
}

export async function createCorpus(displayName: string): Promise<string> {
  const op = await request<LroResponse<RagCorpus>>('POST', corporaBase(), {
    displayName,
    vectorDbConfig: {
      ragManagedDb: {},
      ragEmbeddingModelConfig: {
        vertexPredictionEndpoint: {
          endpoint: `projects/${requireProject()}/locations/${RAG_LOCATION}/${EMBEDDING_MODEL}`,
        },
      },
    },
  });

  // op.name הוא ה-operation ID (למשל projects/.../operations/...)
  return op.name;
}

export async function deleteCorpus(corpusResourceName: string): Promise<void> {
  const headers = await getHeaders();
  const res = await fetch(`${BASE_URL}/${corpusResourceName}`, { method: 'DELETE', headers });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Delete corpus ${res.status}: ${text}`);
  }
}

export async function importFile(
  corpusResourceName: string,
  gcsUri: string,
  displayName: string,
): Promise<RagOperationResult> {
  const url = `${BASE_URL}/${corpusResourceName}/ragFiles:import`;
  const op = await request<{ name: string }>('POST', url, {
    importRagFilesConfig: {
      ragFileTransformationConfig: { ragFileChunkingConfig: { fixedLengthChunking: { chunkSize: 1024, chunkOverlap: 200 } } },
      gcsSource: { uris: [gcsUri] },
    },
    ragFiles: [{ displayName }],
  });
  return { operationId: op.name };
}

export async function deleteFile(ragFileResourceName: string): Promise<void> {
  const headers = await getHeaders();
  const res = await fetch(`${BASE_URL}/${ragFileResourceName}`, { method: 'DELETE', headers });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Delete rag file ${res.status}: ${text}`);
  }
}

export async function pollOperation(operationResourceName: string): Promise<OperationStatus> {
  return request<OperationStatus>('GET', `${BASE_URL}/${operationResourceName}`);
}

export async function listFiles(corpusResourceName: string): Promise<RagFileRef[]> {
  const result = await request<{ ragFiles?: RagFileRef[] }>('GET', `${BASE_URL}/${corpusResourceName}/ragFiles`);
  return result.ragFiles ?? [];
}
