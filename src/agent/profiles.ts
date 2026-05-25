/**
 * Built-in agent profile definitions and profile-aware helpers.
 *
 * Each profile controls:
 * - System prompt (identity and behavior)
 * - Tool allowlist (which tools the profile can use)
 * - Trust policy overrides (per-tool trust levels that merge over the global policy)
 * - Optional LLM config overrides (model, provider, apiKey)
 *
 * Supports both built-in profiles and user-defined custom profiles.
 * Config overrides are merged over built-in definitions at runtime.
 * Disabled profiles are excluded from the active set.
 */

import { PetProfile, PetRole } from '../shared/types';
import { readConfig } from '../config/config-store';

// ---------------------------------------------------------------------------
// System prompts for each built-in profile
// ---------------------------------------------------------------------------

const CHIEF_SYSTEM_PROMPT = `You are Clawd Chief, the coordinator of a team of AI pets. You receive user requests
and delegate them to specialists. You do NOT directly execute code, run commands, or browse
the web yourself. Instead, you break tasks into steps and assign each to the right specialist:

- **Coder**: writes code, edits files, runs shell commands. Use for any implementation, scripting, or file manipulation task.
- **Scout**: browses the web, searches for information, takes screenshots. Use for research, looking things up, or web automation.
- **Analyst**: reads files, analyzes data, summarizes information. Use for understanding existing code, comparing files, or producing summaries.

**Workflow:**
1. Analyze the user's request and break it into subtasks.
2. For each subtask, call delegate_task with the target_role (coder/scout/analyst) and a clear task_description.
3. Use write_blackboard to share intermediate context between specialists (e.g., Scout's research results for Coder to use).
4. Use read_blackboard to retrieve specialist outputs and previous context.
5. Synthesize the specialist results into a clear, coherent response for the user.

**Important rules:**
- Delegate ONE subtask at a time and wait for the result before delegating the next.
- If a specialist fails, the tool will automatically retry once. If it still fails, report to the user and suggest alternatives.
- Use context_refs in delegate_task to pass blackboard keys as additional context for the specialist.
- Always explain what you're doing and which specialist you're assigning.`;

const CODER_SYSTEM_PROMPT = `You are Clawd Coder, a code-focused desktop AI assistant in the form of a cat character.
Your specialty is writing, reading, and editing code. You can read and write files,
edit existing files, execute shell commands, search for files and text patterns,
and list directory contents.
Be precise and methodical. When writing code, follow existing patterns and conventions
in the codebase. Always verify your changes by reading the file back.`;

const SCOUT_SYSTEM_PROMPT = `You are Clawd Scout, an information-gathering desktop AI assistant in the form of a cat character.
Your specialty is web browsing, information gathering, and research. You can automate
web browser actions (navigate, click, type, screenshot, read page content) to find
and collect information for the user.

**Browser workflow:**
1. Always start with browser_action "snapshot" to discover interactive elements and their refs (@e1, @e2, ...).
2. Use the refs from the snapshot for click, type, and hover actions.
3. After navigation or interaction, take another snapshot to see the updated page state.
4. Use "get_text" to extract page content for analysis.
5. Use "screenshot" to capture visual state when needed.

**Failure recovery:**
- If browser_action fails with a connection or spawn error, do NOT retry the same action more than twice.
- If browser connection fails persistently, report the failure clearly and suggest: "The browser automation tool is unavailable. Please ensure agent-browser is installed (npm i -g agent-browser && agent-browser install)."
- If a page doesn't load or returns an error, try going back and navigating again before giving up.
- Do NOT attempt to use alternative tools (bash, curl, etc.) as substitutes — they are not available to you.

**Rules:**
- Be thorough and accurate. Capture all relevant details.
- Summarize findings clearly with specific data and sources.
- Limit browser actions to 15 per task to avoid runaway loops.
- If you cannot complete the task after reasonable attempts, report what you found and what failed.`;

const ANALYST_SYSTEM_PROMPT = `You are Clawd Analyst, an analysis-focused desktop AI assistant in the form of a cat character.
Your specialty is data analysis, summarization, and comparison. You can read files,
search for text patterns, list directories, and analyze content to provide insights.
Be analytical and structured. Present your findings in a clear, organized manner with
specific details and evidence from the source material.`;

// ---------------------------------------------------------------------------
// Built-in profile definitions
// ---------------------------------------------------------------------------

/** Chief profile: coordinator that delegates to specialists via tools */
const CHIEF_PROFILE: PetProfile = {
  id: 'chief',
  name: 'Chief',
  role: PetRole.CHIEF,
  systemPrompt: CHIEF_SYSTEM_PROMPT,
  toolNames: [
    'delegate_task',
    'read_blackboard',
    'write_blackboard',
    'send_message',
    'check_inbox',
  ],
  gifPrefix: 'apupepe',
  icon: 'apupepe-idle.gif',
};

/** Coder profile: code writing and file manipulation */
const CODER_PROFILE: PetProfile = {
  id: 'coder',
  name: 'Coder',
  role: PetRole.CODER,
  systemPrompt: CODER_SYSTEM_PROMPT,
  toolNames: [
    'read', 'write', 'edit', 'bash', 'grep', 'find', 'ls',
    'create_directory', 'delete_file',
    'send_message', 'check_inbox',
  ],
  icon: 'clawd-running.gif',
};

/** Scout profile: web browsing and information gathering */
const SCOUT_PROFILE: PetProfile = {
  id: 'scout',
  name: 'Scout',
  role: PetRole.SCOUT,
  systemPrompt: SCOUT_SYSTEM_PROMPT,
  toolNames: [
    'browser_action',
    'read', 'grep', 'find', 'ls',
    'send_message', 'check_inbox',
  ],
  icon: 'ikun-review.gif',
  gifPrefix: 'ikun',
};

/** Analyst profile: data analysis and summarization */
const ANALYST_PROFILE: PetProfile = {
  id: 'analyst',
  name: 'Analyst',
  role: PetRole.ANALYST,
  systemPrompt: ANALYST_SYSTEM_PROMPT,
  toolNames: [
    'read', 'grep', 'find', 'ls',
    'list_schedules',
    'send_message', 'check_inbox',
  ],
  icon: 'clawd-waiting.gif',
};

// ---------------------------------------------------------------------------
// Profile registry
// ---------------------------------------------------------------------------

/** All built-in profiles keyed by id */
const BUILT_IN_PROFILES: Record<string, PetProfile> = {
  [CHIEF_PROFILE.id]: CHIEF_PROFILE,
  [CODER_PROFILE.id]: CODER_PROFILE,
  [SCOUT_PROFILE.id]: SCOUT_PROFILE,
  [ANALYST_PROFILE.id]: ANALYST_PROFILE,
};

/** IDs of built-in profiles that cannot be deleted (only disabled) */
export const BUILT_IN_PROFILE_IDS = new Set(Object.keys(BUILT_IN_PROFILES));

/**
 * Merge a config override on top of a built-in profile.
 * Only override fields that are explicitly set in the config entry.
 */
function mergeProfile(base: PetProfile, override: Partial<PetProfile>): PetProfile {
  const merged: PetProfile = { ...base };
  if (override.name !== undefined) merged.name = override.name;
  if (override.systemPrompt !== undefined) merged.systemPrompt = override.systemPrompt;
  if (override.toolNames !== undefined) merged.toolNames = override.toolNames;
  if (override.enabled !== undefined) merged.enabled = override.enabled;
  if (override.gifPrefix !== undefined) merged.gifPrefix = override.gifPrefix;
  if (override.icon !== undefined) merged.icon = override.icon;
  if (override.trustOverrides !== undefined) merged.trustOverrides = override.trustOverrides;
  if (override.llm !== undefined) merged.llm = override.llm;
  if (override.skills !== undefined) merged.skills = override.skills;
  if (override.a2a !== undefined) merged.a2a = override.a2a;
  if (override.backend !== undefined) merged.backend = override.backend;
  return merged;
}

/**
 * Build the merged profile map: built-in profiles with config overrides,
 * plus any custom profiles from config.
 */
function buildProfileMap(): Record<string, PetProfile> {
  const configProfiles = readConfig().profiles ?? [];
  const configMap = new Map<string, PetProfile>();
  for (const p of configProfiles) {
    configMap.set(p.id, p);
  }

  // Start with built-in profiles, applying config overrides
  const result: Record<string, PetProfile> = {};
  for (const [id, base] of Object.entries(BUILT_IN_PROFILES)) {
    const override = configMap.get(id);
    if (override) {
      result[id] = mergeProfile(base, override);
    } else {
      result[id] = { ...base };
    }
  }

  // Add custom profiles (role === 'custom') that are not built-in
  for (const p of configProfiles) {
    if (!BUILT_IN_PROFILES[p.id]) {
      result[p.id] = { ...p };
    }
  }

  return result;
}

/**
 * Get a resolved profile by its id.
 * Returns undefined if the profile doesn't exist or is disabled.
 */
export function getProfileById(id: string): PetProfile | undefined {
  const map = buildProfileMap();
  const profile = map[id];
  if (!profile || profile.enabled === false) return undefined;
  return profile;
}

/**
 * Get all profile ids (including disabled and custom).
 */
export function getProfileIds(): string[] {
  return Object.keys(buildProfileMap());
}

/**
 * Get a resolved profile by its role (e.g. "coder", "remote").
 * Returns the first enabled profile matching the role.
 * Used by delegation to resolve role names like "remote" to actual profiles.
 */
export function getProfileByRole(role: string): PetProfile | undefined {
  const map = buildProfileMap();
  return Object.values(map).find((p) => p.role === role && p.enabled !== false);
}

/**
 * Get all profiles (including disabled ones) as an array.
 */
export function getAllProfiles(): PetProfile[] {
  return Object.values(buildProfileMap());
}

/**
 * Get the default profile (Chief).
 * This is used when no profile is specified, maintaining backward compatibility.
 */
export function getDefaultProfile(): PetProfile {
  return getProfileById('chief') ?? CHIEF_PROFILE;
}

/**
 * Get all enabled specialist profiles (non-chief, enabled).
 * Used by Chief to know which specialists are available for delegation.
 */
export function getEnabledSpecialistProfiles(): PetProfile[] {
  const map = buildProfileMap();
  return Object.values(map).filter(
    (p) => p.role !== PetRole.CHIEF && p.enabled !== false
  );
}

/**
 * Get the built-in profile base (without config overrides).
 * Used by the Settings UI to show the original definition.
 */
export function getBuiltInProfile(id: string): PetProfile | undefined {
  return BUILT_IN_PROFILES[id] ? { ...BUILT_IN_PROFILES[id] } : undefined;
}
