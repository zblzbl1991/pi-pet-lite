/**
 * Plugin type definitions for the Clawd tool plugin system.
 *
 * Defines the interfaces that plugins must implement to be loaded
 * and used as agent tools. Plugins are CommonJS modules loaded via
 * require() from the ~/.clawd/plugins/ directory.
 */

/** JSON Schema type mapping for plugin parameters */
export const PluginParamType = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  OBJECT: 'object',
  ARRAY: 'array',
} as const;

export type PluginParamType = (typeof PluginParamType)[keyof typeof PluginParamType];

/** A single parameter definition for a plugin tool */
export interface ToolParameter {
  name: string;
  type: PluginParamType;
  description: string;
  required?: boolean;
}

/** Context passed to plugin execute() providing runtime information */
export interface ToolContext {
  petId: string;
  sessionId: string;
}

/** Result returned by plugin execute() */
export interface PluginToolResult {
  content: string;
  isError?: boolean;
}

/** The interface every plugin must export as its default/module export */
export interface ToolPlugin {
  /** Unique identifier for the plugin, e.g. "web-scraper" */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Description sent to the LLM to explain what this tool does */
  description: string;
  /** Parameter definitions in simplified JSON Schema format */
  parameters: ToolParameter[];
  /** The actual tool execution function */
  execute(args: Record<string, unknown>, context: ToolContext): Promise<PluginToolResult>;
  /** Semantic version string */
  version?: string;
  /** Author or maintainer name */
  author?: string;
}

/** Plugin manifest loaded from plugin.json in each plugin directory */
export interface PluginManifest {
  /** Unique identifier matching the plugin's name */
  name: string;
  /** Semantic version */
  version: string;
  /** Human-readable display name */
  displayName: string;
  /** Description for display purposes */
  description: string;
  /** Author or maintainer */
  author?: string;
  /** Declared permissions: 'network', 'filesystem', etc. */
  permissions?: string[];
  /** Execution timeout in milliseconds. Default: PLUGIN_DEFAULT_TIMEOUT */
  timeout?: number;
  /** Entry point JS file relative to the plugin directory */
  entry: string;
}

/** Runtime state for a loaded plugin */
export interface LoadedPlugin {
  manifest: PluginManifest;
  plugin: ToolPlugin;
  enabled: boolean;
  /** Absolute path to the plugin directory */
  directory: string;
}

/** Default plugin execution timeout (30 seconds) */
export const PLUGIN_DEFAULT_TIMEOUT = 30000;
