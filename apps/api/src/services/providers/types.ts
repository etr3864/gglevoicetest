export type ProviderType = 'gemini';

// --- Generation ---

export interface GenerationConfig {
  temperature: number;
  maxOutputTokens: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
}

// --- VAD (Voice Activity Detection) ---

export type StartSensitivity = 'START_SENSITIVITY_LOW' | 'START_SENSITIVITY_HIGH';
export type EndSensitivity = 'END_SENSITIVITY_LOW' | 'END_SENSITIVITY_HIGH';
export type ActivityHandling = 'START_OF_ACTIVITY_INTERRUPTS' | 'NO_INTERRUPTION';
export type TurnCoverage = 'TURN_INCLUDES_ONLY_ACTIVITY' | 'TURN_INCLUDES_ALL_INPUT';

export interface VadConfig {
  startOfSpeechSensitivity?: StartSensitivity;
  endOfSpeechSensitivity?: EndSensitivity;
  prefixPaddingMs?: number;
  silenceDurationMs?: number;
  activityHandling?: ActivityHandling;
  turnCoverage?: TurnCoverage;
}

// --- Context Compression ---

export interface ContextCompressionConfig {
  slidingWindowSize?: number;
  triggerTokens?: number;
}

// --- Unified Model Config ---

export interface ModelConfig {
  generation: GenerationConfig;
  vad?: VadConfig;
  proactiveAudio?: boolean;
  languageCode?: string;
  contextCompression?: ContextCompressionConfig;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  generation: {
    temperature: 0.8,
    maxOutputTokens: 4096,
  },
  vad: {
    silenceDurationMs: 300,
    endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
    startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
    activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
    turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY',
  },
  contextCompression: {
    slidingWindowSize: 3072,
    triggerTokens: 8000,
  },
};

// --- Provider Config ---

export interface ProviderConfig {
  apiKey: string;
  model: string;
  voice: string;
  systemPrompt: string;
  modelConfig: ModelConfig;
  tools?: ToolDefinition[];
}

// --- Audio ---

export interface AudioChunk {
  data: Buffer;
  format: 'pcm16';
  sampleRate: number;
}

// --- Transcripts ---

export interface TranscriptEntry {
  speaker: 'agent' | 'customer';
  text: string;
  timestamp: Date;
  isFinal: boolean;
}

// --- Tools ---

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  result: unknown;
  error?: string;
}

// --- Provider Interface ---

export interface ProviderEvents {
  onReady: () => void;
  onAudio: (chunk: AudioChunk) => void;
  onTranscript: (entry: TranscriptEntry) => void;
  onToolCall: (call: ToolCall) => Promise<ToolResult>;
  onError: (error: Error) => void;
  onClose: () => void;
  onInterrupt?: () => void;
  onTurnComplete?: () => void;
}

export interface VoiceProvider {
  readonly type: ProviderType;
  connect(config: ProviderConfig, events: ProviderEvents): Promise<void>;
  setEvents(events: ProviderEvents): void;
  sendAudio(chunk: AudioChunk): void;
  disconnect(): void;
  isReady(): boolean;
}

/** Deep-merge agent overrides onto defaults */
export function mergeModelConfig(overrides?: Partial<ModelConfig>): ModelConfig {
  if (!overrides) return { ...DEFAULT_MODEL_CONFIG };
  return {
    generation: { ...DEFAULT_MODEL_CONFIG.generation, ...overrides.generation },
    vad: overrides.vad ?? DEFAULT_MODEL_CONFIG.vad,
    proactiveAudio: overrides.proactiveAudio ?? DEFAULT_MODEL_CONFIG.proactiveAudio,
    languageCode: overrides.languageCode ?? DEFAULT_MODEL_CONFIG.languageCode,
    contextCompression: overrides.contextCompression
      ? { ...DEFAULT_MODEL_CONFIG.contextCompression, ...overrides.contextCompression }
      : DEFAULT_MODEL_CONFIG.contextCompression,
  };
}
