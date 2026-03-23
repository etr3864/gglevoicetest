export type MediaType = 'image' | 'video' | 'file';
export type MediaStatus = 'processing' | 'ready' | 'error';
export type MediaJobType = 'full_process' | 'reembed_only';

export interface MediaJobData {
  mediaItemId: string;
  agentId: string;
  gcsPath: string;
  mediaType: MediaType;
  mimeType: string;
  jobType: MediaJobType;
}

export interface MediaAnalysisResult {
  name: string;
  description: string;
  caption: string;
  tokenCount: number;
}

export interface AnalysisContext {
  agentSystemPrompt: string;
  analysisInstructions?: string | null;
}

export interface CompressionResult {
  buffer: Buffer;
  wasCompressed: boolean;
  originalSize: number;
  finalSize: number;
  thumbnailBuffer?: Buffer;
}

export interface MediaContextItem {
  id: string;
  mediaType: string;
  name: string;
  description: string;
  caption: string | null;
}

export interface MediaContext {
  hasMedia: boolean;
  totalCount: number;
  items?: MediaContextItem[];
}
