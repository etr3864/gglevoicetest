import { prisma } from '@voice/db';

export interface UsageIncrements {
  callCount?: number;
  totalDurationSec?: number;
  totalBilledSec?: number;
  totalAudioInputTokens?: number;
  totalAudioOutputTokens?: number;
  totalTextInputTokens?: number;
  totalTextOutputTokens?: number;
  totalSummaryTokens?: number;
  totalEmbeddingTokens?: number;
  totalMediaAnalysisTokens?: number;
  totalDeepgramSec?: number;
  totalRecordingSec?: number;
  whatsappMsgCount?: number;
}

export async function upsertMonthlyUsage(agentId: string, inc: UsageIncrements): Promise<void> {
  const yearMonth = new Date().toISOString().slice(0, 7); // "2026-03"

  await prisma.$executeRaw`
    INSERT INTO agent_usage_monthly (
      id, agent_id, year_month,
      call_count, total_duration_sec, total_billed_sec,
      total_audio_input_tokens, total_audio_output_tokens,
      total_text_input_tokens, total_text_output_tokens,
      total_summary_tokens, total_embedding_tokens, total_media_analysis_tokens,
      total_deepgram_sec, total_recording_sec, whatsapp_msg_count
    ) VALUES (
      gen_random_uuid(), ${agentId}, ${yearMonth},
      ${inc.callCount ?? 0}, ${inc.totalDurationSec ?? 0}, ${inc.totalBilledSec ?? 0},
      ${inc.totalAudioInputTokens ?? 0}, ${inc.totalAudioOutputTokens ?? 0},
      ${inc.totalTextInputTokens ?? 0}, ${inc.totalTextOutputTokens ?? 0},
      ${inc.totalSummaryTokens ?? 0}, ${inc.totalEmbeddingTokens ?? 0}, ${inc.totalMediaAnalysisTokens ?? 0},
      ${inc.totalDeepgramSec ?? 0}, ${inc.totalRecordingSec ?? 0}, ${inc.whatsappMsgCount ?? 0}
    )
    ON CONFLICT (agent_id, year_month) DO UPDATE SET
      call_count                    = agent_usage_monthly.call_count                    + ${inc.callCount ?? 0},
      total_duration_sec            = agent_usage_monthly.total_duration_sec            + ${inc.totalDurationSec ?? 0},
      total_billed_sec              = agent_usage_monthly.total_billed_sec              + ${inc.totalBilledSec ?? 0},
      total_audio_input_tokens      = agent_usage_monthly.total_audio_input_tokens      + ${inc.totalAudioInputTokens ?? 0},
      total_audio_output_tokens     = agent_usage_monthly.total_audio_output_tokens     + ${inc.totalAudioOutputTokens ?? 0},
      total_text_input_tokens       = agent_usage_monthly.total_text_input_tokens       + ${inc.totalTextInputTokens ?? 0},
      total_text_output_tokens      = agent_usage_monthly.total_text_output_tokens      + ${inc.totalTextOutputTokens ?? 0},
      total_summary_tokens          = agent_usage_monthly.total_summary_tokens          + ${inc.totalSummaryTokens ?? 0},
      total_embedding_tokens        = agent_usage_monthly.total_embedding_tokens        + ${inc.totalEmbeddingTokens ?? 0},
      total_media_analysis_tokens   = agent_usage_monthly.total_media_analysis_tokens   + ${inc.totalMediaAnalysisTokens ?? 0},
      total_deepgram_sec            = agent_usage_monthly.total_deepgram_sec            + ${inc.totalDeepgramSec ?? 0},
      total_recording_sec           = agent_usage_monthly.total_recording_sec           + ${inc.totalRecordingSec ?? 0},
      whatsapp_msg_count            = agent_usage_monthly.whatsapp_msg_count            + ${inc.whatsappMsgCount ?? 0}
  `;
}
