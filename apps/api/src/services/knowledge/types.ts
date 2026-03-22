export type DocType = 'text' | 'table';
export type ChunkType = 'summary' | 'parent' | 'child';

export interface ChunkDraft {
  chunkType: ChunkType;
  parentIndex: number | null; // index into parents array for child/parent linkage
  content: string;
  importance: number;
  metadata: Record<string, unknown> | null;
}

export interface ChunkWithEmbedding extends ChunkDraft {
  id: string;
  documentId: string;
  agentId: string;
  parentId: string | null;
  embedding: number[] | null;
}

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
}

export interface EmbedBatchResult {
  vectors: number[][];
  tokenCount: number;
}

export interface SearchResult {
  content: string;
  score: number;
  chunkType: ChunkType;
  metadata: Record<string, unknown> | null;
}

export interface KnowledgeMeta {
  hasTextDocs: boolean;
  hasTables: boolean;
}

export interface WarmupContext {
  promptSection: string;
  meta: KnowledgeMeta;
}
