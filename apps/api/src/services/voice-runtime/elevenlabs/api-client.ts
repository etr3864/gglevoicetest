import { createLogger } from '../../../lib/logger';

const log = createLogger('elevenlabs:api');

const BASE_URL = 'https://api.elevenlabs.io/v1';

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY not configured');
  return key;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'xi-api-key': getApiKey(),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    log.error('ElevenLabs API error', { method, path, status: res.status, body: errText.slice(0, 300) });
    throw new ElevenLabsApiError(res.status, errText.slice(0, 300));
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ElevenLabsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`ElevenLabs API ${status}: ${detail}`);
    this.name = 'ElevenLabsApiError';
  }
}

export interface ElevenLabsAgentPayload {
  name: string;
  conversation_config: {
    agent: {
      prompt: {
        prompt: string;
        llm?: string;
        custom_llm?: {
          url: string;
          model_id: string;
          api_key: string;
        };
      };
      language: string;
      first_message: string;
    };
    asr: {
      language: string;
      language_detection?: boolean;
    };
    tts: {
      model_id: string;
      voice_id: string;
      stability: number;
      similarity_boost: number;
      speed: number;
      optimize_streaming_latency: number;
    };
    conversation: {
      max_duration_seconds: number;
    };
    turn: {
      mode: string;
      turn_timeout: number;
      eagerness: string;
    };
  };
  platform_settings?: Record<string, unknown>;
  metadata?: Record<string, string>;
}

interface PhoneNumberEntry {
  phone_number_id: string;
  phone_number: string;
  agent_id: string | null;
  label: string;
}

interface AgentResponse {
  agent_id: string;
  name: string;
}

interface ConversationResponse {
  conversation_id: string;
  agent_id: string;
  status: string;
  transcript?: TranscriptEntry[];
  metadata?: Record<string, string>;
  analysis?: { call_successful?: string; summary?: string };
  conversation_initiation_client_data?: Record<string, unknown>;
}

interface TranscriptEntry {
  role: 'agent' | 'user';
  message: string;
  time_in_call_secs: number;
}

export async function createAgent(payload: ElevenLabsAgentPayload): Promise<string> {
  const result = await request<AgentResponse>('POST', '/convai/agents/create', payload);
  log.info('ElevenLabs agent created', { agentId: result.agent_id });
  return result.agent_id;
}

export async function updateAgent(externalId: string, payload: ElevenLabsAgentPayload): Promise<void> {
  await request<AgentResponse>('PATCH', `/convai/agents/${externalId}`, payload);
  log.info('ElevenLabs agent updated', { externalId });
}

export async function deleteAgent(externalId: string): Promise<void> {
  await request<void>('DELETE', `/convai/agents/${externalId}`);
  log.info('ElevenLabs agent deleted', { externalId });
}

export async function listPhoneNumbers(): Promise<PhoneNumberEntry[]> {
  const res = await request<{ phone_numbers: PhoneNumberEntry[] }>('GET', '/convai/phone-numbers');
  return res.phone_numbers ?? [];
}

export async function assignAgentToPhoneNumber(
  phoneNumberId: string,
  agentId: string,
): Promise<void> {
  await request<unknown>('PATCH', `/convai/phone-numbers/${phoneNumberId}`, {
    agent_id: agentId,
  });
  log.info('Phone number assigned to agent', { phoneNumberId, agentId });
}

export async function getConversation(conversationId: string): Promise<ConversationResponse> {
  return request<ConversationResponse>('GET', `/convai/conversations/${conversationId}`);
}

export async function getConversationAudioUrl(conversationId: string): Promise<string> {
  return `${BASE_URL}/convai/conversations/${conversationId}/audio`;
}

export async function downloadConversationAudio(conversationId: string): Promise<Response> {
  const url = await getConversationAudioUrl(conversationId);
  const res = await fetch(url, {
    headers: { 'xi-api-key': getApiKey() },
  });
  if (!res.ok) {
    throw new ElevenLabsApiError(res.status, `Failed to download audio for ${conversationId}`);
  }
  return res;
}

export type { ConversationResponse, TranscriptEntry };
