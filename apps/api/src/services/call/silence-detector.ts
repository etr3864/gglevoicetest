import { createLogger } from '../../lib/logger';
import type { SilenceConfig, VoiceProvider } from '../providers/types';
import { hangupCall } from '../telnyx';

const log = createLogger('silence');

const DEFAULT_PROMPT =
  'Stay in character. Briefly check in with the customer in their language to confirm they are still on the line.';

const RECHECK_WHILE_AGENT_SPEAKING_MS = 1000;
const JITTER_SEC = 2;

type Stage = 'idle' | 'after-first' | 'after-second';

export type SilenceTrigger = 'customer' | 'agent';

interface DetectorOptions {
  config: SilenceConfig;
  callControlId: string;
  provider: VoiceProvider;
  isAgentSilent: () => boolean;
}

export class SilenceDetector {
  private timer: NodeJS.Timeout | null = null;
  private stage: Stage = 'idle';
  private agentAudioMs = 0;

  constructor(private opts: DetectorOptions) {}

  static isEnabled(config: SilenceConfig | undefined): config is SilenceConfig {
    return !!config && config.firstCheckSec > 0 && config.hangupSec > 0;
  }

  // Called whenever the agent produces an audio chunk. Used to estimate how
  // much audio is still buffered toward the customer when the model signals
  // turnComplete — so we don't start the silence timer too early.
  onAgentAudio(bytes: number, sampleRate: number): void {
    this.agentAudioMs += (bytes / 2 / sampleRate) * 1000;
  }

  reset(trigger: SilenceTrigger): void {
    if (trigger === 'agent' && this.stage !== 'idle') {
      this.agentAudioMs = 0;
      return;
    }

    this.clear();
    this.stage = 'idle';
    const bufferMs = this.agentAudioMs;
    this.agentAudioMs = 0;

    if (trigger === 'agent') {
      this.timer = scheduleJittered(this.opts.config.firstCheckSec, bufferMs, () => this.fireFirstCheck());
    }
  }

  stop(): void {
    this.clear();
    this.stage = 'idle';
    this.agentAudioMs = 0;
  }

  private clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private fireFirstCheck(): void {
    this.timer = null;
    if (!this.opts.isAgentSilent()) {
      this.timer = setTimeout(() => this.fireFirstCheck(), RECHECK_WHILE_AGENT_SPEAKING_MS);
      return;
    }

    this.sendPrompt(this.opts.config.message);
    this.stage = 'after-first';

    if ((this.opts.config.secondCheckSec ?? 0) > 0) {
      this.timer = scheduleJittered(this.opts.config.secondCheckSec!, 0, () => this.fireSecondCheck());
    } else {
      this.timer = scheduleJittered(this.opts.config.hangupSec, 0, () => this.fireHangup());
    }
  }

  private fireSecondCheck(): void {
    this.timer = null;
    if (!this.opts.isAgentSilent()) {
      this.timer = setTimeout(() => this.fireSecondCheck(), RECHECK_WHILE_AGENT_SPEAKING_MS);
      return;
    }

    this.sendPrompt(this.opts.config.secondMessage ?? this.opts.config.message);
    this.stage = 'after-second';
    this.timer = scheduleJittered(this.opts.config.hangupSec, 0, () => this.fireHangup());
  }

  private fireHangup(): void {
    this.timer = null;
    this.stage = 'idle';
    log.info('Silence threshold exceeded — hanging up call', {
      callControlId: this.opts.callControlId,
    });
    hangupCall(this.opts.callControlId).catch((err) => {
      log.warn('Hangup on silence failed', { err: (err as Error).message });
    });
  }

  private sendPrompt(message?: string | null): void {
    const text = (message ?? '').trim() || DEFAULT_PROMPT;
    try {
      this.opts.provider.promptSpeech?.(text);
    } catch (err) {
      log.warn('Failed to prompt agent on silence', { err: (err as Error).message });
    }
  }
}

function scheduleJittered(seconds: number, leadingMs: number, callback: () => void): NodeJS.Timeout {
  const offset = (Math.random() * 2 - 1) * JITTER_SEC;
  const ms = Math.max(1000, leadingMs + (seconds + offset) * 1000);
  return setTimeout(callback, ms);
}
