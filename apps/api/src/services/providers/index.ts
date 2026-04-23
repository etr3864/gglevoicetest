export type {
  VoiceProvider, ProviderConfig, ProviderEvents,
  AudioChunk, TranscriptEntry, ToolDefinition, ToolParameter,
  ToolCall, ToolResult, ProviderType,
  ModelConfig, GenerationConfig, VadConfig,
} from './types';
export { DEFAULT_MODEL_CONFIG, mergeModelConfig } from './types';
export { GeminiProvider } from './gemini/gemini.provider';
