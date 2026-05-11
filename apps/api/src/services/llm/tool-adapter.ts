import type { ToolDefinition } from '../providers/types';
import type { LlmToolSchema } from './types';

export function adaptToolsForLlm(tools: ToolDefinition[]): LlmToolSchema[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(t.parameters).map(([key, param]) => [
          key,
          {
            type: param.type,
            description: param.description,
            ...(param.enum && { enum: param.enum }),
          },
        ]),
      ),
      required: t.required ?? [],
    },
  }));
}
