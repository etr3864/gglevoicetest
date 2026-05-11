import type { LlmProvider } from './types';
import { getModelInfo } from './models';
import { GoogleLlmProvider } from './google/provider';

const providers = new Map<string, LlmProvider>();

function ensureRegistered(): void {
  if (providers.size > 0) return;
  providers.set('google', new GoogleLlmProvider());
}

export function getLlmProvider(modelId: string): LlmProvider {
  ensureRegistered();
  const info = getModelInfo(modelId);
  if (!info) throw new Error(`Unknown LLM model: ${modelId}`);
  if (!info.available) throw new Error(`LLM model not yet available: ${modelId}`);

  const provider = providers.get(info.provider);
  if (!provider) throw new Error(`No provider registered for: ${info.provider}`);
  return provider;
}
