import type { VoiceProviderId, VoiceRuntime } from './types';
import { GeminiRuntime } from './gemini.runtime';
import { ElevenLabsRuntime } from './elevenlabs/runtime';
import { registerConfigSchema } from './binding';
import { ElevenLabsConfigSchema } from './elevenlabs/config.schema';

const runtimes = new Map<VoiceProviderId, VoiceRuntime>();

function ensureRegistered(): void {
  if (runtimes.size > 0) return;
  runtimes.set('gemini_live', new GeminiRuntime());
  runtimes.set('elevenlabs', new ElevenLabsRuntime());
  registerConfigSchema('elevenlabs', ElevenLabsConfigSchema);
}

export function getRuntime(provider: VoiceProviderId): VoiceRuntime {
  ensureRegistered();
  const rt = runtimes.get(provider);
  if (!rt) throw new Error(`Unknown voice provider: ${provider}`);
  return rt;
}

export function registerRuntime(runtime: VoiceRuntime): void {
  runtimes.set(runtime.id, runtime);
}
