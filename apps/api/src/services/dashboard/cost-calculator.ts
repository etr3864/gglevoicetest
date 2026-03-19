interface PricingConfig {
  geminiAudioInputPer1M: number;
  geminiAudioOutputPer1M: number;
  geminiSummaryPer1M: number;
  telnyxCallPerMin: number;
  telnyxRecordingPerMin: number;
  deepgramPerSec: number;
  usdToIls: number;
}

export interface UsageMetrics {
  totalAudioInputTokens: number;
  totalAudioOutputTokens: number;
  totalTextInputTokens: number;
  totalTextOutputTokens: number;
  totalSummaryTokens: number;
  totalBilledSec: number;
  totalRecordingSec: number;
  totalDeepgramSec: number;
}

export interface CostBreakdownIls {
  geminiAudioCost: number;
  geminiTextCost: number;
  telnyxCallCost: number;
  telnyxRecordingCost: number;
  deepgramCost: number;
  totalCost: number;
}

export function calculateCosts(usage: UsageMetrics, pricing: PricingConfig): CostBreakdownIls {
  const { usdToIls } = pricing;

  const geminiAudioCost =
    ((usage.totalAudioInputTokens / 1_000_000) * pricing.geminiAudioInputPer1M +
     (usage.totalAudioOutputTokens / 1_000_000) * pricing.geminiAudioOutputPer1M) * usdToIls;

  const geminiTextCost =
    ((usage.totalTextInputTokens + usage.totalTextOutputTokens + usage.totalSummaryTokens) / 1_000_000) *
    pricing.geminiSummaryPer1M * usdToIls;

  const telnyxCallCost = (usage.totalBilledSec / 60) * pricing.telnyxCallPerMin * usdToIls;
  const telnyxRecordingCost = (usage.totalRecordingSec / 60) * pricing.telnyxRecordingPerMin * usdToIls;
  const deepgramCost = usage.totalDeepgramSec * pricing.deepgramPerSec * usdToIls;

  const totalCost = geminiAudioCost + geminiTextCost + telnyxCallCost + telnyxRecordingCost + deepgramCost;

  return {
    geminiAudioCost: round2(geminiAudioCost),
    geminiTextCost: round2(geminiTextCost),
    telnyxCallCost: round2(telnyxCallCost),
    telnyxRecordingCost: round2(telnyxRecordingCost),
    deepgramCost: round2(deepgramCost),
    totalCost: round2(totalCost),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
