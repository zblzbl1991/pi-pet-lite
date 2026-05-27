/**
 * Marketplace barrel export.
 */

export type {
  AgentManifest,
  AgentDependency,
  InstalledAgentEntry,
  LocalRegistry,
  InstalledAgentSummary,
  PackageInfoResult,
} from './types';

export { AgentCategory } from './types';

export {
  validateManifest,
  readPackageManifest,
  packAgentPackage,
  readPackageReadme,
} from './package-format';

export {
  readRegistry,
  addInstalledAgent,
  removeInstalledAgent,
  getInstalledAgent,
  getAllInstalledAgents,
  isAgentInstalled,
  resolveMissingDeps,
  getInstalledAgentSummaries,
} from './registry';

export {
  installAgent,
  uninstallAgent,
  checkForUpdate,
  packageCurrentProfile,
} from './installer';
