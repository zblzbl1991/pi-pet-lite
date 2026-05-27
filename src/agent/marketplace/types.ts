/**
 * Marketplace type definitions for the Clawd Agent Marketplace.
 *
 * Defines the agent package format (.clawd-agent), local registry
 * entries, and dependency information for sharing and installing
 * agent profiles.
 */

import type { PetProfile } from '../../shared/types';

/** Metadata stored in manifest.json inside a .clawd-agent package */
export interface AgentManifest {
  /** Unique package identifier, e.g. "research-assistant" */
  name: string;
  /** Semantic version, e.g. "1.0.0" */
  version: string;
  /** Author name or organization */
  author: string;
  /** Human-readable description */
  description: string;
  /** Category for browsing: productivity, development, research, creative */
  category: AgentCategory;
  /** Searchable tags */
  tags: string[];
  /** Tool plugins this agent depends on (must be installed) */
  dependencies: AgentDependency[];
  /** The PetProfile configuration this package provides */
  profile: PetProfile;
  /** Optional README content */
  readme?: string;
  /** Package format version (currently 1) */
  formatVersion?: number;
}

/** Agent package categories */
export const AgentCategory = {
  PRODUCTIVITY: 'productivity',
  DEVELOPMENT: 'development',
  RESEARCH: 'research',
  CREATIVE: 'creative',
} as const;

export type AgentCategory = (typeof AgentCategory)[keyof typeof AgentCategory];

/** A dependency on a tool plugin */
export interface AgentDependency {
  /** Plugin name that must be installed */
  pluginName: string;
  /** Minimum version required (semver) */
  minVersion?: string;
}

/** An entry in the local installed-agents registry */
export interface InstalledAgentEntry {
  /** The manifest of the installed package */
  manifest: AgentManifest;
  /** Timestamp when the agent was installed */
  installedAt: number;
  /** Source: 'local-file' for now, future: 'registry-url' */
  source: string;
  /** Absolute path to the extracted package directory */
  installPath: string;
}

/** The local registry file structure (stored as JSON) */
export interface LocalRegistry {
  /** Registry format version */
  version: number;
  /** Installed agents keyed by package name */
  agents: Record<string, InstalledAgentEntry>;
}

/** Summary for IPC transport (lighter than full manifest) */
export interface InstalledAgentSummary {
  /** Package name */
  name: string;
  /** Display version */
  version: string;
  /** Author */
  author: string;
  /** Description */
  description: string;
  /** Category */
  category: AgentCategory;
  /** Tags */
  tags: string[];
  /** Whether all plugin dependencies are satisfied */
  depsOk: boolean;
  /** List of missing dependency names */
  missingDeps: string[];
  /** Whether the profile is currently active in config */
  active: boolean;
  /** Profile ID (if installed into config) */
  profileId: string;
  /** Installed timestamp */
  installedAt: number;
}

/** Result of reading a package's manifest without installing */
export interface PackageInfoResult {
  success: boolean;
  manifest?: AgentManifest;
  error?: string;
}
