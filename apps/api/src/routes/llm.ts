import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { getLlmProvider, adaptToolsForLlm } from '../services/llm';
import type { LlmProvider, ChatMessage, LlmToolSchema, TokenUsage } from '../services/llm/types';
import { getCachedPrompt, setCachedPrompt, invalidatePromptCache } from '../services/llm/prompt-cache';
import { buildProviderConfig } from '../services/call/warmup';
import { globalRegistry } from '../services/tools/registry';

const log = createLogger('llm:endpoint');
const router = Router();

const MAX_TOOL_ITERATIONS = 10;
const MAX_REQUEST_DURATION_MS = 60_000;
const DEFAULT_MODEL = 'gemini-2.5-flash';

const MUTATING_TOOLS = new Set([
  'save_contact', 'book_appointment', 'cancel_appointment', 'update_contact_info',
]);

router.post('/v1/chat/completions', handleChatCompletion);

async function handleChatCompletion(req: Request, res: Response): Promise<void> {
  const agent = await authenticateAgent(req);
  if (!agent) { res.status(401).end(); return; }

  const conversationId = extractConversationId(req.body);
  if (!conversationId) { res.status(400).json({ error: 'missing conversation_id' }); return; }

  const call = await findOrCreateCall(agent, conversationId, req.body);
  const config = await resolvePromptConfig(call, agent);
  if (!config) { res.status(500).json({ error: 'failed to build prompt' }); return; }

  const modelId = agent.llmModel ?? DEFAULT_MODEL;
  const toolDefs = config.tools?.filter((t) => t.name !== 'end_call') ?? [];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const abortCtl = new AbortController();
  const timeout = setTimeout(() => abortCtl.abort(), MAX_REQUEST_DURATION_MS);

  try {
    await streamWithToolLoop(res, {
      llm: getLlmProvider(modelId),
      modelId,
      tools: adaptToolsForLlm(toolDefs),
      temperature: req.body.temperature ?? 0.5,
      signal: abortCtl.signal,
      callId: call.id,
      agentId: agent.id,
      contactPhone: call.contactPhone ?? undefined,
      messages: [
        { role: 'system', content: config.systemPrompt },
        ...mapIncomingMessages(req.body.messages),
      ],
    });
  } finally {
    clearTimeout(timeout);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

interface StreamContext {
  llm: LlmProvider;
  modelId: string;
  tools: LlmToolSchema[];
  temperature: number;
  signal: AbortSignal;
  callId: string;
  agentId: string;
  contactPhone?: string;
  messages: ChatMessage[];
}

async function streamWithToolLoop(res: Response, ctx: StreamContext): Promise<void> {
  let { messages } = ctx;

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    let result;
    try {
      result = await ctx.llm.streamChat(ctx.modelId, {
        messages,
        tools: ctx.tools,
        temperature: ctx.temperature,
        signal: ctx.signal,
        onTextChunk: (text) => writeSseChunk(res, text),
        onUsage: (usage) => trackUsage(ctx.callId, ctx.modelId, usage),
      });
    } catch (err) {
      if (iter < 2) {
        log.warn('LLM stream failed, retrying', { callId: ctx.callId, iter });
        continue;
      }
      log.error('LLM stream failed after retries', err, { callId: ctx.callId });
      writeSseChunk(res, 'מצטער, יש לי כרגע בעיה טכנית. אפשר לחזור אליי?');
      return;
    }

    if (!result.toolCalls?.length) return;

    writeSseChunk(res, ' ');

    const results = await Promise.all(
      result.toolCalls.map((tc) =>
        globalRegistry.execute(
          { id: tc.id, name: tc.name, arguments: tc.args },
          { callId: ctx.callId, agentId: ctx.agentId, contactPhone: ctx.contactPhone },
        ),
      ),
    );

    if (result.toolCalls.some((tc) => MUTATING_TOOLS.has(tc.name))) {
      invalidatePromptCache(ctx.callId).catch(() => {});
    }

    messages = [
      ...messages,
      { role: 'assistant', tool_calls: result.toolCalls },
      ...results.map((r, i) => ({
        role: 'tool' as const,
        tool_call_id: result.toolCalls![i].id,
        content: JSON.stringify(r.result),
      })),
    ];
  }

  log.warn('LLM hit max tool iterations', { callId: ctx.callId });
  writeSseChunk(res, 'מצטער, נתקלתי בבעיה. אפשר לנסות שוב?');
}

async function authenticateAgent(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  if (!token) return null;

  return prisma.agent.findUnique({
    where: { customLlmToken: token },
    select: {
      id: true,
      userId: true,
      llmModel: true,
      voiceProvider: true,
      phoneNumber: true,
      summaryEnabled: true,
    },
  });
}

function extractConversationId(body: Record<string, unknown>): string | null {
  const extra = body.extra_body as Record<string, unknown> | undefined;
  return (extra?.conversation_id as string)
    ?? (body.conversation_id as string)
    ?? null;
}

interface CallRecord {
  id: string;
  agentId: string;
  contactPhone: string | null;
  context: Record<string, unknown> | null;
  direction: string;
}

async function findOrCreateCall(
  agent: { id: string; userId: string | null },
  conversationId: string,
  body: Record<string, unknown>,
): Promise<CallRecord> {
  const call = await prisma.call.upsert({
    where: { externalConversationId: conversationId },
    create: {
      agentId: agent.id,
      externalConversationId: conversationId,
      direction: 'inbound',
      status: 'in_call',
      startedAt: new Date(),
    },
    update: {},
    select: { id: true, agentId: true, direction: true, context: true },
  });

  const contactPhone = extractContactPhone(body);

  return {
    id: call.id,
    agentId: call.agentId,
    contactPhone,
    context: call.context as Record<string, unknown> | null,
    direction: call.direction,
  };
}

function extractContactPhone(body: Record<string, unknown>): string | null {
  const extra = body.extra_body as Record<string, unknown> | undefined;
  return (extra?.caller_id as string) ?? null;
}

async function resolvePromptConfig(
  call: CallRecord,
  agent: { id: string },
) {
  const cached = await getCachedPrompt(call.id);
  if (cached) return cached;

  const config = await buildProviderConfig(
    agent.id,
    call.contactPhone,
    call.context ?? undefined,
    call.direction as 'inbound' | 'outbound',
  );

  if (config) {
    await setCachedPrompt(call.id, config);
  }
  return config;
}

function mapIncomingMessages(raw: unknown[]): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m: any) => m.role !== 'system')
    .map((m: any) => ({
      role: m.role as ChatMessage['role'],
      content: m.content as string | undefined,
    }));
}

function writeSseChunk(res: Response, text: string): void {
  const chunk = {
    choices: [{ delta: { content: text } }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

async function trackUsage(
  callId: string,
  modelId: string,
  usage: { inputTokens: number; outputTokens: number },
): Promise<void> {
  prisma.call.update({
    where: { id: callId },
    data: {
      llmModel: modelId,
      textInputTokens: { increment: usage.inputTokens },
      textOutputTokens: { increment: usage.outputTokens },
    },
  }).catch((err) => log.warn('Usage tracking failed', { callId, err: String(err) }));
}

export default router;
