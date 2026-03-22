import { generateText } from '../../lib/gemini-text';
import type { ChunkDraft, ParsedTable } from './types';

// Target sizes — Hebrew is ~3 chars/token, so keep parent well under 20k tokens
const PARENT_MAX_CHARS = 3_000;  // ~1000 tokens (safe for Hebrew)
const CHILD_MAX_CHARS  = 700;    // ~230 tokens
const OVERLAP_CHARS    = 150;

const SUMMARY_SYSTEM_PROMPT =
  'You are summarizing a business document for a voice AI assistant knowledge base. ' +
  'Write a concise summary (3-5 sentences) covering the main topics and purpose of the document. ' +
  'Plain text only, no bullet points or formatting.';

export interface SummaryResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function processTextFile(text: string, docName: string): Promise<ChunkDraft[]> {
  const parents = splitIntoParents(text);
  const chunks: ChunkDraft[] = [];

  // Summary chunk (importance = 1.0 so warmup always picks it)
  const summary = await generateDocumentSummary(text.slice(0, 8_000), docName);
  chunks.push({
    chunkType: 'summary',
    parentIndex: null,
    content: `[Summary of "${docName}"]\n${summary.text}`,
    importance: 1.0,
    metadata: { inputTokens: summary.inputTokens, outputTokens: summary.outputTokens },
  });

  for (let pi = 0; pi < parents.length; pi++) {
    const parent = parents[pi];

    chunks.push({
      chunkType: 'parent',
      parentIndex: pi,
      content: parent,
      importance: 0.7,
      metadata: { section: pi + 1 },
    });

    const children = splitParentIntoChildren(parent, docName, pi + 1);
    for (const child of children) {
      chunks.push({
        chunkType: 'child',
        parentIndex: pi,
        content: child,
        importance: 0.5,
        metadata: { section: pi + 1 },
      });
    }
  }

  return chunks;
}

export function processTableFile(table: ParsedTable, tableName: string): ChunkDraft[] {
  const { headers, rows } = table;
  const chunks: ChunkDraft[] = [];

  const schemaText = buildTableSchemaChunk(headers, rows.length, tableName);
  chunks.push({
    chunkType: 'summary',
    parentIndex: null,
    content: schemaText,
    importance: 1.0,
    metadata: { tableSchema: true, rowCount: rows.length },
  });

  for (let i = 0; i < rows.length; i++) {
    const rowText = buildTableRowChunk(rows[i], headers, tableName);
    chunks.push({
      chunkType: 'child',
      parentIndex: null,
      content: rowText,
      importance: 0.5,
      metadata: { rowIndex: i },
    });
  }

  return chunks;
}

export async function generateDocumentSummary(content: string, docName: string): Promise<SummaryResult> {
  const userContent = `Document name: "${docName}"\n\n${content}`;
  const result = await generateText(SUMMARY_SYSTEM_PROMPT, userContent);
  // generateText returns combined tokenCount; split evenly as approximation
  const half = Math.ceil((result.tokenCount ?? 0) / 2);
  return { text: result.text, inputTokens: half, outputTokens: half };
}

function hardSplit(text: string, maxChars: number, overlap: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    parts.push(text.slice(start, end));
    start = end - overlap;
    if (start >= text.length) break;
  }
  return parts;
}

function splitIntoParents(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  // Force-split any paragraph that exceeds the parent limit before grouping
  const rawParagraphs = normalized.split(/\n\n+/);
  const paragraphs = rawParagraphs.flatMap((p) => hardSplit(p, PARENT_MAX_CHARS, OVERLAP_CHARS));

  const parents: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length > PARENT_MAX_CHARS && current.length > 0) {
      parents.push(current.trim());
      const lastPara = current.split('\n\n').at(-1) ?? '';
      current = lastPara.slice(-OVERLAP_CHARS) + '\n\n' + para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }

  if (current.trim()) parents.push(current.trim());
  return parents.filter((p) => p.length > 0);
}

function splitParentIntoChildren(parent: string, docName: string, section: number): string[] {
  const prefix = `[${docName}, section ${section}] `;
  const sentences = parent.split(/(?<=[.!?])\s+/);
  const children: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > CHILD_MAX_CHARS && current.length > 0) {
      children.push(prefix + current.trim());
      current = current.slice(-OVERLAP_CHARS) + ' ' + sentence;
    } else {
      current = current ? current + ' ' + sentence : sentence;
    }
  }

  if (current.trim()) children.push(prefix + current.trim());
  return children.filter((c) => c.length > prefix.length);
}

function buildTableSchemaChunk(headers: string[], rowCount: number, tableName: string): string {
  return [
    `[Table: "${tableName}"]`,
    `Columns: ${headers.join(', ')}`,
    `Total rows: ${rowCount}`,
    `Use this table to answer questions about: ${headers.join(', ')}.`,
  ].join('\n');
}

function buildTableRowChunk(row: Record<string, string>, headers: string[], tableName: string): string {
  const fields = headers.map((h) => `${h}: ${row[h] ?? ''}`).join(' | ');
  return `[${tableName}] ${fields}`;
}
