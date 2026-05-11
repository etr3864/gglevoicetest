import { getCapabilities } from '../capabilities';
import type { VoiceRuntime, VoiceOption } from '../types';
import { ELEVENLABS_VOICES } from './voices';
import { provisionAgent, deprovisionAgent } from './provisioning';
import { createLogger } from '../../../lib/logger';

const log = createLogger('elevenlabs:runtime');

export class ElevenLabsRuntime implements VoiceRuntime {
  readonly id = 'elevenlabs' as const;
  readonly capabilities = getCapabilities('elevenlabs');

  async onAgentCreated(agentId: string): Promise<void> {
    await provisionAgent(agentId);
  }

  async onAgentUpdated(agentId: string): Promise<void> {
    await provisionAgent(agentId);
  }

  async onAgentDeleted(agentId: string): Promise<void> {
    await deprovisionAgent(agentId);
  }

  async onProviderSwitchedAway(agentId: string): Promise<void> {
    await deprovisionAgent(agentId);
  }

  async terminateActiveCall(
    _callId: string,
    _externalConversationId: string | null,
  ): Promise<void> {
    log.warn('ElevenLabs call termination not yet supported');
  }

  listVoices(): VoiceOption[] {
    return ELEVENLABS_VOICES;
  }
}
