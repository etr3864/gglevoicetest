import { GoogleAuth } from 'google-auth-library';
import { createLogger } from '../../../lib/logger';
import type { LlmProvider, ChatRequest, ChatResult, LlmToolCall } from '../types';

const log = createLogger('llm:google');

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

function getStreamEndpoint(modelId: string): string {
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || 'us-central1';
  if (!project) throw new Error('GCP_PROJECT_ID missing');
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${modelId}:streamGenerateContent?alt=sse`;
}

async function getAccessToken(): Promise<string> {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to get GCP access token');
  return token.token;
}

export class GoogleLlmProvider implements LlmProvider {
  readonly providerId = 'google' as const;

  async streamChat(modelId: string, req: ChatRequest): Promise<ChatResult> {
    const endpoint = getStreamEndpoint(modelId);
    const accessToken = await getAccessToken();

    const body = buildVertexBody(req);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Vertex AI stream ${res.status}: ${errText.slice(0, 300)}`);
    }

    return parseSSEStream(res, req);
  }
}

function buildVertexBody(req: ChatRequest) {
  const contents: VertexContent[] = [];
  let systemInstruction: { parts: { text: string }[] } | undefined;

  for (const msg of req.messages) {
    if (msg.role === 'system') {
      systemInstruction = { parts: [{ text: msg.content ?? '' }] };
      continue;
    }

    if (msg.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: msg.content ?? '' }] });
      continue;
    }

    if (msg.role === 'assistant') {
      const parts: VertexPart[] = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          parts.push({
            functionCall: { name: tc.name, args: tc.args },
          });
        }
      }
      if (parts.length > 0) contents.push({ role: 'model', parts });
      continue;
    }

    if (msg.role === 'tool') {
      contents.push({
        role: 'function',
        parts: [{
          functionResponse: {
            name: msg.tool_call_id ?? '',
            response: safeJsonParse(msg.content),
          },
        }],
      });
    }
  }

  const result: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: req.temperature ?? 0.5,
      maxOutputTokens: 8192,
    },
  };

  if (systemInstruction) result.systemInstruction = systemInstruction;

  if (req.tools?.length) {
    result.tools = [{
      functionDeclarations: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    }];
  }

  return result;
}

async function parseSSEStream(res: Response, req: ChatRequest): Promise<ChatResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  const toolCalls: LlmToolCall[] = [];
  let toolCallCounter = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data) as VertexStreamChunk;
          const parts = parsed.candidates?.[0]?.content?.parts;
          if (!parts) continue;

          for (const part of parts) {
            if (part.text) {
              req.onTextChunk(part.text);
            }
            if (part.functionCall) {
              toolCalls.push({
                id: `tc_${toolCallCounter++}`,
                name: part.functionCall.name,
                args: part.functionCall.args ?? {},
              });
            }
          }

          if (parsed.usageMetadata && req.onUsage) {
            req.onUsage({
              inputTokens: parsed.usageMetadata.promptTokenCount ?? 0,
              outputTokens: parsed.usageMetadata.candidatesTokenCount ?? 0,
            });
          }
        } catch {
          log.warn('Failed to parse SSE chunk', { data: data.slice(0, 100) });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return toolCalls.length > 0 ? { toolCalls } : {};
}

function safeJsonParse(str: string | undefined): unknown {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return { raw: str }; }
}

interface VertexPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: unknown };
}

interface VertexContent {
  role: string;
  parts: VertexPart[];
}

interface VertexStreamChunk {
  candidates?: { content?: { parts?: VertexPart[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
