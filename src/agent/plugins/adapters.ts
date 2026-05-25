/**
 * Adapter: converts ToolPlugin interface to pi-agent-core AgentTool format.
 *
 * Handles TypeBox schema generation from simplified ToolParameter[],
 * timeout enforcement, error wrapping, and result format conversion.
 */

import { Type } from 'typebox';
import type { ToolPlugin, ToolParameter, PluginToolResult } from './types';
import { PLUGIN_DEFAULT_TIMEOUT } from './types';

// ---------------------------------------------------------------------------
// Type aliases for pi-agent-core
// ---------------------------------------------------------------------------

type PiAgentTool = import('@earendil-works/pi-agent-core').AgentTool;
type PiAgentToolResult = import('@earendil-works/pi-agent-core').AgentToolResult<unknown>;
type PiAgentToolUpdateCallback = import('@earendil-works/pi-agent-core').AgentToolUpdateCallback<unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string, details?: Record<string, unknown>): PiAgentToolResult {
  return {
    content: [{ type: 'text' as const, text }],
    details: details ?? {},
  };
}

function errorResult(message: string, details?: Record<string, unknown>): PiAgentToolResult {
  return {
    content: [{ type: 'text' as const, text: message }],
    details: { error: true, ...details },
  };
}

/**
 * Convert a simplified ToolParameter[] to a TypeBox Type.Object schema.
 *
 * Maps JSON Schema types to TypeBox types with descriptions.
 * Required parameters have no Optional wrapper.
 */
function parametersToTypeBox(params: ToolParameter[]): ReturnType<typeof Type.Object> {
  const properties: Record<string, ReturnType<typeof Type.String | typeof Type.Number | typeof Type.Boolean | typeof Type.Object | typeof Type.Array>> = {};

  for (const param of params) {
    switch (param.type) {
      case 'string':
        properties[param.name] = Type.String({ description: param.description });
        break;
      case 'number':
        properties[param.name] = Type.Number({ description: param.description });
        break;
      case 'boolean':
        properties[param.name] = Type.Boolean({ description: param.description });
        break;
      case 'object':
        properties[param.name] = Type.Object({}, { description: param.description });
        break;
      case 'array':
        properties[param.name] = Type.Array(Type.Unknown(), { description: param.description });
        break;
      default:
        properties[param.name] = Type.String({ description: param.description });
        break;
    }
  }

  // Determine required fields
  const required = params
    .filter((p) => p.required !== false)
    .map((p) => p.name);

  return Type.Object(properties, { required: required.length > 0 ? required : undefined });
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Convert a ToolPlugin to a pi-agent-core AgentTool.
 *
 * Wraps the plugin's execute() with:
 * - TypeBox parameter schema
 * - Timeout enforcement (from manifest or default 30s)
 * - Error catching (plugin errors never crash the agent)
 * - Result format conversion
 */
export function pluginToAgentTool(plugin: ToolPlugin, timeoutMs?: number): PiAgentTool {
  const effectiveTimeout = timeoutMs ?? PLUGIN_DEFAULT_TIMEOUT;

  return {
    name: plugin.name,
    label: plugin.displayName,
    description: plugin.description,
    parameters: parametersToTypeBox(plugin.parameters),
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const args = (params ?? {}) as Record<string, unknown>;
      const context = { petId: '', sessionId: '' };

      // Timeout timer reference — declared outside try so catch can clean up
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      try {
        // Execute with timeout
        const timeoutPromise = new Promise<PluginToolResult>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`Plugin "${plugin.name}" timed out after ${effectiveTimeout}ms`)),
            effectiveTimeout
          );
        });

        const result: PluginToolResult = await Promise.race([
          plugin.execute(args, context),
          timeoutPromise,
        ]);

        if (timeoutId !== undefined) clearTimeout(timeoutId);

        if (result.isError) {
          return errorResult(result.content);
        }

        return textResult(result.content);
      } catch (err: unknown) {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Plugin "${plugin.name}" error: ${msg}`);
      }
    },
  };
}

/**
 * Convert all enabled plugins to AgentTool array.
 */
export function pluginsToAgentTools(plugins: { plugin: ToolPlugin; manifest: { timeout?: number } }[]): PiAgentTool[] {
  return plugins.map((p) => pluginToAgentTool(p.plugin, p.manifest.timeout));
}
