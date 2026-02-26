import type { ToolDefinition, ToolCall, ToolResult } from '../providers/types';
import { createLogger } from '../../lib/logger';

const log = createLogger('tools');

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<unknown>;

export interface ToolContext {
  callId: string;
  agentId: string;
  contactPhone?: string;
}

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);

    if (!tool) {
      log.warn('Unknown tool called', { name: call.name });
      return { callId: call.id, result: null, error: `Unknown tool: ${call.name}` };
    }

    log.debug('Executing tool', { name: call.name, callId: context.callId });

    try {
      const result = await tool.handler(call.arguments, context);
      return { callId: call.id, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Tool execution failed';
      log.error('Tool execution failed', err, { name: call.name });
      return { callId: call.id, result: null, error: message };
    }
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get size(): number {
    return this.tools.size;
  }
}

export const globalRegistry = new ToolRegistry();
