import type { VoiceCapabilities, VoiceProviderId } from './types';

const GEMINI_CAPABILITIES: VoiceCapabilities = {
  ambientSound: true,
  silenceDetection: { stages: 2 },
  vadFineTuning: true,
  turnEagerness: false,
  voiceStability: false,
  voiceSpeed: false,
  expressiveMode: false,
  llmModelChoice: false,
  temperatureRange: { min: 0, max: 2 },
  outboundCalls: true,
};

const ELEVENLABS_CAPABILITIES: VoiceCapabilities = {
  ambientSound: false,
  silenceDetection: { stages: 1 },
  vadFineTuning: false,
  turnEagerness: true,
  voiceStability: true,
  voiceSpeed: true,
  expressiveMode: true,
  llmModelChoice: true,
  temperatureRange: { min: 0, max: 1 },
  outboundCalls: false,
};

const CAPABILITIES: Record<VoiceProviderId, VoiceCapabilities> = {
  gemini_live: GEMINI_CAPABILITIES,
  elevenlabs: ELEVENLABS_CAPABILITIES,
};

export function getCapabilities(provider: VoiceProviderId): VoiceCapabilities {
  return CAPABILITIES[provider];
}
