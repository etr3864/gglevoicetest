import { createLogger } from '../../lib/logger';
import type { SilenceConfig, VoiceProvider } from '../providers/types';
import { hangupCall } from '../telnyx';

const log = createLogger('silence');

const DEFAULT_PROMPT =
  'Stay in character. Briefly check in with the customer in their language to confirm they are still on the line.';

const RECHECK_WHILE_AGENT_SPEAKING_MS = 1000;

type Stage = 'idle' | 'awaiting-customer';

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
    return !!config && config.firstCheckSec > 0 && config.hangupSec > config.firstCheckSec;
  }

  reset(trigger: SilenceTrigger): void {
    // Agent finishing speech after our silence prompt — keep counting toward hangup.
    if (trigger === 'agent' && this.stage === 'awaiting-customer') return;

    this.clear();
    this.stage = 'idle';

    // Timer only starts when agent finishes its turn. Customer activity
    // just clears the timer — we wait for the agent to respond first.
    if (trigger === 'agent') {
      this.timer = setTimeout(() => this.fireFirstCheck(), this.opts.config.firstCheckSec * 1000);
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

    const text = this.opts.config.message?.trim() || DEFAULT_PROMPT;
    try {
      this.opts.provider.promptSpeech?.(text);
    } catch (err) {
      log.warn('Failed to prompt agent on silence', { err: (err as Error).message });
    }

    this.stage = 'awaiting-customer';
    const remainingMs = (this.opts.config.hangupSec - this.opts.config.firstCheckSec) * 1000;
    this.timer = setTimeout(() => this.fireHangup(), remainingMs);
  }

  private fireHangup(): void {
    this.timer = null;
    this.stage = 'idle';
    log.info('Silence threshold exceeded — hanging up call', {
      callControlId: this.opts.callControlId,
      hangupSec: this.opts.config.hangupSec,
    });
    hangupCall(this.opts.callControlId).catch((err) => {
      log.warn('Hangup on silence failed', { err: (err as Error).message });
    });
  }
}
