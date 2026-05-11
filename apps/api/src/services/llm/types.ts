export interface LlmModelInfo {
  id: string;
  displayName: string;
  provider: 'google' | 'openai' | 'anthropic';
  pricing: { inputPerMillionTokens: number; outputPerMillionTokens: number };
  contextWindow: number;
  supportsToolCalls: boolean;
  available: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
}

export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: LlmToolSchema[];
  temperature?: number;
  signal?: AbortSignal;
  onTextChunk: (text: string) => void;
  onUsage?: (usage: TokenUsage) => void;
}

export interface ChatResult {
  toolCalls?: LlmToolCall[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmProvider {
  readonly providerId: 'google' | 'openai' | 'anthropic';
  streamChat(modelId: string, req: ChatRequest): Promise<ChatResult>;
}
