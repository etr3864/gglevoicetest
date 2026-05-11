import type { LlmModelInfo } from './types';

export const LLM_MODELS: LlmModelInfo[] = [
  {
    id: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    provider: 'google',
    pricing: { inputPerMillionTokens: 0.15, outputPerMillionTokens: 0.60 },
    contextWindow: 1_000_000,
    supportsToolCalls: true,
    available: true,
  },
  {
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    provider: 'openai',
    pricing: { inputPerMillionTokens: 2.50, outputPerMillionTokens: 10.00 },
    contextWindow: 128_000,
    supportsToolCalls: true,
    available: false,
  },
  {
    id: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    provider: 'openai',
    pricing: { inputPerMillionTokens: 0.15, outputPerMillionTokens: 0.60 },
    contextWindow: 128_000,
    supportsToolCalls: true,
    available: false,
  },
  {
    id: 'claude-sonnet-4',
    displayName: 'Claude Sonnet 4',
    provider: 'anthropic',
    pricing: { inputPerMillionTokens: 3.00, outputPerMillionTokens: 15.00 },
    contextWindow: 200_000,
    supportsToolCalls: true,
    available: false,
  },
];

export function getModelInfo(modelId: string): LlmModelInfo | undefined {
  return LLM_MODELS.find((m) => m.id === modelId);
}
