import type { ElevenLabsAgentPayload } from './api-client';
import type { ElevenLabsConfig } from './config.schema';
import { DEFAULT_VOICE_ID } from './voices';

interface PayloadInput {
  name: string;
  systemPrompt: string;
  openingMessage: string;
  customLlmToken: string;
  config: ElevenLabsConfig;
  phoneNumber?: string;
  environment?: string;
}

export function buildAgentPayload(input: PayloadInput): ElevenLabsAgentPayload {
  const { config } = input;
  const voiceId = config.voiceId || DEFAULT_VOICE_ID;
  const apiUrl = process.env.API_URL;
  if (!apiUrl) throw new Error('API_URL not configured');

  const displayName = input.environment && input.environment !== 'production'
    ? `[${input.environment.toUpperCase()}] ${input.name}`
    : input.name;

  const sipUri = process.env.ELEVENLABS_SIP_URI;

  const payload: ElevenLabsAgentPayload = {
    name: displayName,
    conversation_config: {
      agent: {
        prompt: { prompt: input.systemPrompt },
        language: 'he',
        first_message: input.openingMessage,
      },
      asr: {
        language: 'he',
        language_detection: false,
      },
      tts: {
        model_id: 'eleven_v3_conversational',
        voice_id: voiceId,
        stability: config.stability,
        similarity_boost: config.similarityBoost,
        speed: config.speed,
        optimize_streaming_latency: 3,
      },
      conversation: {
        max_duration_seconds: 1800,
        client_events: ['conversation_initiation_client_data'],
      },
      turn: {
        mode: { type: 'turn_based' },
        turn_timeout: config.turnTimeout,
        eagerness: config.turnEagerness,
      },
    },
    platform_settings: {
      custom_llm: {
        url: `${apiUrl}/llm/v1/chat/completions`,
        api_key: input.customLlmToken,
        model: 'custom',
      },
      ...(sipUri && input.phoneNumber && {
        phone: { phone_number_sip_uri: sipUri },
      }),
    },
    built_in_tools: {
      end_call: { enabled: true },
    },
    metadata: {
      platform: 'gglvoice',
      environment: input.environment ?? 'production',
    },
  };

  return payload;
}
