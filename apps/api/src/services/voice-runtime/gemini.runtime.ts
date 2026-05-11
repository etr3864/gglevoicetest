import { VOICES } from '../../lib/constants';
import { getCapabilities } from './capabilities';
import type { VoiceRuntime, VoiceOption } from './types';

export class GeminiRuntime implements VoiceRuntime {
  readonly id = 'gemini_live' as const;
  readonly capabilities = getCapabilities('gemini_live');

  async onAgentCreated(): Promise<void> {}
  async onAgentUpdated(): Promise<void> {}
  async onAgentDeleted(): Promise<void> {}
  async onProviderSwitchedAway(): Promise<void> {}

  async terminateActiveCall(): Promise<void> {
    // Gemini calls terminate via Telnyx hangup — handled elsewhere
  }

  listVoices(): VoiceOption[] {
    return VOICES.map((v) => ({
      id: v.id,
      name: v.label,
      gender: v.gender,
    }));
  }
}
