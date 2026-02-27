export interface GeminiServerContent {
  interrupted?: boolean;
  turnComplete?: boolean;
  modelTurn?: {
    parts: {
      inlineData?: { mimeType: string; data: string };
      text?: string;
    }[];
  };
  inputTranscript?: string;
  outputTranscription?: { text: string };
}

export interface GeminiToolCall {
  functionCalls?: {
    id?: string;
    name: string;
    args?: Record<string, unknown>;
  }[];
}

export interface ConnectionState {
  isReady: boolean;
  isReconnecting: boolean;
}
