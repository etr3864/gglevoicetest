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

  constructor(private opts: DetectorOptions) {}

  static isEnabled(config: SilenceConfig | undefined): config is SilenceConfig {
    return !!config && config.firstCheckSec > 0 && config.hangupSec > 0;
  }

  reset(trigger: SilenceTrigger): void {
    // Agent finishing speech after we already prompted — keep counting toward next stage / hangup.
    if (trigger === 'agent' && this.stage !== 'idle') return;

    this.clear();
    this.stage = 'idle';

    if (trigger === 'agent') {
      this.timer = scheduleJittered(this.opts.config.firstCheckSec, () => this.fireFirstCheck());
    }
  }

  stop(): void {
    this.clear();
    this.stage = 'idle';
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
      this.timer = scheduleJittered(this.opts.config.secondCheckSec!, () => this.fireSecondCheck());
    } else {
      this.timer = scheduleJittered(this.opts.config.hangupSec, () => this.fireHangup());
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
    this.timer = scheduleJittered(this.opts.config.hangupSec, () => this.fireHangup());
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

function scheduleJittered(seconds: number, callback: () => void): NodeJS.Timeout {
  const offset = (Math.random() * 2 - 1) * JITTER_SEC;
  const ms = Math.max(1, seconds + offset) * 1000;
  return setTimeout(callback, ms);
}
