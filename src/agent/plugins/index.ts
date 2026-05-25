/**
 * Barrel export for the plugins module.
 *
 * Re-exports types, loader functions, and adapter utilities
 * for consumption by the tool registry and IPC handlers.
 */

export type {
  ToolPlugin,
  ToolParameter,
  ToolContext,
  PluginToolResult,
  PluginManifest,
  LoadedPlugin,
} from './types';

export {
  PluginParamType,
  PLUGIN_DEFAULT_TIMEOUT,
} from './types';

export type { PluginSummary } from '../../shared/types';

export {
  loadPlugins,
  getLoadedPlugins,
  getEnabledPlugins,
  getPluginSummaries,
  getPlugin,
  enablePlugin,
  disablePlugin,
  unloadPlugin,
  installPluginFromPath,
  uninstallPlugin,
  watchForChanges,
  stopWatching,
  getPluginsDir,
} from './loader';

export {
  pluginToAgentTool,
  pluginsToAgentTools,
} from './adapters';
