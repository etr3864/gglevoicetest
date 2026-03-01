import { ToolDefinition, ProviderConfig } from '../types';
import { GEMINI } from '../../../lib/audio-config';

export class GeminiMapper {
  static buildSetupPayload(config: ProviderConfig): Record<string, unknown> {
    const { modelConfig, systemPrompt, voice, model, tools } = config;
    const { generation, vad, proactiveAudio, languageCode, contextCompression } = modelConfig;

    const setup: Record<string, unknown> = {
      model,
      generationConfig: this.buildGenerationConfig(generation, voice, languageCode),
      systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    if (tools?.length) {
      setup.tools = [{ functionDeclarations: tools.map((t) => this.formatTool(t)) }];
    }
    if (vad) {
      setup.realtimeInputConfig = this.buildVadConfig(vad);
    }
    setup.inputAudioTranscription = {};

    if (contextCompression) {
      setup.contextWindowCompression = this.buildCompressionConfig(contextCompression);
    }

    return setup;
  }

  static buildStartConversationPayload(): Record<string, unknown> {
    return {
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: 'The customer is now on the line. Begin the conversation.' }] }],
        turnComplete: true,
      },
    };
  }

  static buildAudioPayload(pcmBase64: string, sampleRate: number = GEMINI.inputRate): Record<string, unknown> {
    return {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: GEMINI.mimeType(sampleRate),
            data: pcmBase64,
          },
        ],
      },
    };
  }

  static buildHistoryPayload(history: { role: string; parts: { text: string }[] }[]): Record<string, unknown> {
    return {
      clientContent: {
        turns: history,
        turnComplete: true,
      },
    };
  }

  static buildToolResponsePayload(responses: Array<{ id: string; name: string; response: unknown }>): Record<string, unknown> {
    return {
      toolResponse: {
        functionResponses: responses.map((r) => ({
          id: r.id,
          name: r.name,
          response: {
            name: r.name,
            content: r.response,
          },
        })),
      },
    };
  }

  // --- Private Helpers ---

  private static buildGenerationConfig(
    generation: ProviderConfig['modelConfig']['generation'],
    voice: string,
    languageCode?: string
  ): Record<string, unknown> {
    const speechConfig: Record<string, unknown> = {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
    };
    if (languageCode) speechConfig.languageCode = languageCode;

    const config: Record<string, unknown> = {
      temperature: Math.min(Math.max(generation.temperature, 0), 2),
      maxOutputTokens: Math.min(generation.maxOutputTokens, 8192),
      responseModalities: ['AUDIO'],
      speechConfig,
    };
    if (generation.topP != null) config.topP = generation.topP;
    if (generation.topK != null) config.topK = generation.topK;
    if (generation.presencePenalty != null) config.presencePenalty = generation.presencePenalty;
    if (generation.frequencyPenalty != null) config.frequencyPenalty = generation.frequencyPenalty;

    return config;
  }

  private static buildVadConfig(vad: NonNullable<ProviderConfig['modelConfig']['vad']>): Record<string, unknown> {
    const detection: Record<string, unknown> = {};
    if (vad.startOfSpeechSensitivity) detection.startOfSpeechSensitivity = vad.startOfSpeechSensitivity;
    if (vad.endOfSpeechSensitivity) detection.endOfSpeechSensitivity = vad.endOfSpeechSensitivity;
    if (vad.prefixPaddingMs != null) detection.prefixPaddingMs = vad.prefixPaddingMs;
    if (vad.silenceDurationMs != null) detection.silenceDurationMs = vad.silenceDurationMs;

    const realtimeInput: Record<string, unknown> = { automaticActivityDetection: detection };
    if (vad.activityHandling) realtimeInput.activityHandling = vad.activityHandling;
    if (vad.turnCoverage) realtimeInput.turnCoverage = vad.turnCoverage;

    return realtimeInput;
  }

  private static buildCompressionConfig(
    compression: NonNullable<ProviderConfig['modelConfig']['contextCompression']>
  ): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    if (compression.slidingWindowSize) {
      config.slidingWindow = { targetTokens: compression.slidingWindowSize };
    }
    if (compression.triggerTokens) {
      config.triggerTokens = compression.triggerTokens;
    }
    return config;
  }

  private static formatTool(tool: ToolDefinition): object {
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'OBJECT',
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([key, param]) => [
            key,
            {
              type: param.type.toUpperCase(),
              description: param.description,
              ...(param.enum && { enum: param.enum }),
            },
          ])
        ),
        required: tool.required || [],
      },
    };
  }
}
