export type VoiceProviderId = 'gemini_live' | 'elevenlabs';

export interface VoiceCapabilities {
  ambientSound: boolean;
  silenceDetection: { stages: 0 | 1 | 2 };
  vadFineTuning: boolean;
  turnEagerness: boolean;
  voiceStability: boolean;
  voiceSpeed: boolean;
  expressiveMode: boolean;
  llmModelChoice: boolean;
  temperatureRange: { min: number; max: number };
  outboundCalls: boolean;
}

export interface VoiceOption {
  id: string;
  name: string;
  gender?: string;
  previewUrl?: string;
}

export interface VoiceRuntime {
  readonly id: VoiceProviderId;
  readonly capabilities: VoiceCapabilities;

  onAgentCreated(agentId: string): Promise<void>;
  onAgentUpdated(agentId: string): Promise<void>;
  onAgentDeleted(agentId: string): Promise<void>;
  onProviderSwitchedAway(agentId: string): Promise<void>;

  handleTelnyxIncomingCall?(
    callControlId: string,
    from: string,
    to: string,
  ): Promise<void>;

  terminateActiveCall(
    callId: string,
    externalConversationId: string | null,
  ): Promise<void>;

  listVoices(): VoiceOption[];
}
