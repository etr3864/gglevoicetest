import { createLogger } from '../../lib/logger';
import { searchKnowledge, queryTable } from '../knowledge/knowledge.service';
import type { ToolDefinition } from '../providers/types';
import type { ToolHandler } from './registry';

const log = createLogger('knowledge:tool');

const TOOL_TIMEOUT_MS = 2_000;

async function withTimeout<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), TOOL_TIMEOUT_MS)),
  ]);
}

// ─── search_knowledge ─────────────────────────────────────────────────────────

export const SEARCH_KNOWLEDGE_DEFINITION: ToolDefinition = {
  name: 'search_knowledge',
  description:
    'Search the agent knowledge base for information from uploaded text documents (policies, FAQs, contracts, etc.). ' +
    'Use this when the caller asks a question that requires specific business knowledge.',
  parameters: {
    query: { type: 'string', description: 'The question or topic to search for' },
  },
  required: ['query'],
};

export const handleSearchKnowledge: ToolHandler = async (args, ctx) => {
  if (!ctx.agentId) return { results: [] };

  return withTimeout(async () => {
    const results = await searchKnowledge(ctx.agentId!, String(args.query ?? ''));
    log.info('Knowledge search completed', { agentId: ctx.agentId, resultCount: results.length });
    return { results: results.map((r) => ({ content: r.content, score: r.score })) };
  }, { results: [] });
};

// ─── query_table ──────────────────────────────────────────────────────────────

export const QUERY_TABLE_DEFINITION: ToolDefinition = {
  name: 'query_table',
  description:
    'Query structured table data (prices, inventory, products, etc.) uploaded by the agent. ' +
    'Use this when the caller asks about specific items, prices, stock levels, or other tabular data.',
  parameters: {
    query: { type: 'string', description: 'What you want to find in the table (e.g. "price of product X", "is item Y in stock")' },
  },
  required: ['query'],
};

export const handleQueryTable: ToolHandler = async (args, ctx) => {
  if (!ctx.agentId) return { results: [] };

  return withTimeout(async () => {
    const results = await queryTable(ctx.agentId!, String(args.query ?? ''));
    log.info('Table query completed', { agentId: ctx.agentId, resultCount: results.length });
    return { results: results.map((r) => ({ content: r.content, score: r.score })) };
  }, { results: [] });
};
