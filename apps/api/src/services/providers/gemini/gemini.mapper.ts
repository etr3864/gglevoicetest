import { ToolDefinition, ProviderConfig } from '../types';
import { GEMINI } from '../../../lib/audio-config';

export class GeminiMapper {
  static buildSetupPayload(config: ProviderConfig, resumptionToken?: string): Record<string, unknown> {
    const { modelConfig, systemPrompt, voice, model, tools } = config;
    const { generation, vad, languageCode, contextCompression } = modelConfig;

    const setup: Record<string, unknown> = {
      model,
      generationConfig: this.buildGenerationConfig(generation, voice, languageCode),
      systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    const toolsPayload: Record<string, unknown>[] = [];
    if (tools?.length) {
      toolsPayload.push({ functionDeclarations: tools.map((t) => this.formatTool(t)) });
    }
    // Note: Vertex RAG is currently disabled for Voice AI (Live API) to prevent 
    // the model from throwing 'Unexpected function call: rag_retrieval' which causes connection drops.
    // Voice agents require low latency, making sync RAG calls unviable.

    if (toolsPayload.length) {
      setup.tools = toolsPayload;
    }
    if (vad) {
      setup.realtimeInputConfig = this.buildVadConfig(vad);
    }
    setup.inputAudioTranscription = {};

    if (contextCompression) {
      setup.contextWindowCompression = this.buildCompressionConfig(contextCompression);
    }

    setup.sessionResumption = resumptionToken ? { handle: resumptionToken } : {};

    return setup;
  }

  static buildStartConversationPayload(openingMessage?: string): Record<string, unknown> {
    const customInstruction = openingMessage?.trim();
    const text = [
      '[SYSTEM] The call just connected. The customer is live on the line and waiting.',
      'If you have NOT greeted the user yet in this conversation, start speaking immediately with your opening greeting.',
      'If you HAVE already greeted the user earlier in this conversation, do NOT greet them again. Just wait for them to speak or continue the conversation naturally.',
      'Do NOT say "no problem", "sure", "of course", or any affirmation — just begin.',
      customInstruction ? `Your required opening greeting is: "${customInstruction}"` : 'Follow your system prompt instructions for the greeting.',
    ].join(' ');

    return {
      clientContent: {
        turns: [{ role: 'user', parts: [{ text }] }],
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

  static buildToolResponsePayload(responses: Array<{ id: string; name: string; response: unknown; silent?: boolean }>): Record<string, unknown> {
    return {
      toolResponse: {
        functionResponses: responses.map((r) => ({
          id: r.id,
          name: r.name,
          response: {
            name: r.name,
            content: r.response,
          },
          ...(r.silent && { scheduling: 'SILENT' }),
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
      enableAffectiveDialog: true,
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
