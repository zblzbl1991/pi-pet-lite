/**
 * Tool Experience — Failure Tracking
 *
 * Records every tool execution outcome to a JSONL file and provides
 * aggregated failure pattern summaries that get injected into the
 * agent's system prompt. This lets the LLM avoid repeating known
 * failure patterns.
 *
 * Storage: JSONL file in the userData directory (one line per execution).
 * Uses only Node.js built-in fs/path — no new dependencies.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single JSONL entry representing one tool execution outcome. */
export interface ExperienceEntry {
  /** ISO 8601 timestamp */
  ts: string;
  /** Tool name (e.g. "bash", "browser_action") */
  tool: string;
  /** Whether the tool succeeded */
  ok: boolean;
  /** Duration in milliseconds */
  ms: number;
  /** Error message (only present on failure) */
  err?: string;
  /** Truncated, redacted tool arguments (only present on failure) */
  args?: Record<string, unknown>;
}

/** An aggregated failure pattern for a specific tool + error category. */
export interface FailurePattern {
  /** Tool name */
  tool: string;
  /** Number of failures */
  failCount: number;
  /** Total calls in the window for this tool */
  totalCount: number;
  /** Failure rate (0-1) */
  failRate: number;
  /** Representative error message */
  example: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Filename for the experience JSONL log. */
const EXPERIENCE_FILENAME = 'experience.jsonl';

/** Maximum file size before rotation (1 MB). */
const DEFAULT_MAX_BYTES = 1_000_000;

/** Number of recent entries to consider for aggregation. */
const DEFAULT_WINDOW = 200;

/** Minimum failure count to include a pattern. */
const DEFAULT_MIN_COUNT = 2;

/** Minimum failure rate (0-1) to include a pattern. */
const DEFAULT_MIN_RATE = 0.5;

/** Maximum length for a redacted arg value string. */
const MAX_ARG_VALUE_LENGTH = 200;

// ---------------------------------------------------------------------------
// Secret Redaction
// ---------------------------------------------------------------------------

/**
 * Patterns that match common secret formats.
 * Each regex matches a secret value that should be replaced with [REDACTED].
 */
const SECRET_PATTERNS: RegExp[] = [
  // API key prefixes: sk-..., ghp_..., xoxb-..., etc.
  /(?<=["':\s])(sk-[a-zA-Z0-9_-]{20,})(?=["'\s,}])/g,
  /(?<=["':\s])(ghp_[a-zA-Z0-9]{30,})(?=["'\s,}])/g,
  /(?<=["':\s])(xox[bpras]-[a-zA-Z0-9-]{20,})(?=["'\s,}])/g,
  // Bearer tokens in Authorization headers
  /(?<=Bearer\s+)\S+/gi,
  // Generic long hex/base64 strings that look like tokens (40+ chars)
  /(?<=["':\s])([a-zA-Z0-9+/=_-]{40,})(?=["'\s,}])/g,
];

/**
 * Field names whose values should always be redacted.
 * Case-insensitive match.
 */
const SENSITIVE_FIELD_NAMES = new Set([
  'apikey', 'api_key', 'key',
  'password', 'passwd', 'pwd',
  'token', 'access_token', 'refresh_token', 'auth_token',
  'secret', 'client_secret', 'clientsecret',
  'authorization', 'credentials',
  'cookie',
]);

/**
 * Deep-redact secrets from an arbitrary object.
 * Returns a new object with sensitive values replaced by "[REDACTED]".
 */
export function redactSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return redactString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSecrets);
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_NAMES.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSecrets(value);
      }
    }
    return result;
  }

  // Numbers, booleans — return as-is
  return obj;
}

/**
 * Apply regex-based redaction to a string value.
 */
function redactString(value: string): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    // Reset regex state for global patterns
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

// ---------------------------------------------------------------------------
// File Path Helpers
// ---------------------------------------------------------------------------

/**
 * Get the userData path, compatible with both main and utility processes.
 */
function getUserDataPath(): string {
  if (app && typeof app.getPath === 'function') {
    return app.getPath('userData');
  }
  const envPath = process.env.CLAWD_USER_DATA;
  if (envPath) {
    return envPath;
  }
  throw new Error('Cannot determine userData path: not in main process and CLAWD_USER_DATA env not set');
}

/**
 * Get the full path to the experience JSONL file.
 */
function getExperiencePath(): string {
  return path.join(getUserDataPath(), EXPERIENCE_FILENAME);
}

// ---------------------------------------------------------------------------
// Truncation Helper
// ---------------------------------------------------------------------------

/**
 * Truncate and redact tool arguments for logging.
 * Keeps only the first-level keys and truncates long string values.
 */
function truncateArgs(args: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactSecrets(args) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(redacted)) {
    if (typeof value === 'string' && value.length > MAX_ARG_VALUE_LENGTH) {
      result[key] = value.slice(0, MAX_ARG_VALUE_LENGTH) + '...[truncated]';
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Record a tool execution outcome to the JSONL experience log.
 *
 * Appends one line to the experience file. Creates the file if it doesn't exist.
 * Calls rotateIfNeeded() after writing to keep the file within size limits.
 */
export function recordExperience(entry: ExperienceEntry): void {
  try {
    const filePath = getExperiencePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Truncate and redact args before writing to keep entries compact
    const sanitized: ExperienceEntry = {
      ...entry,
      ...(entry.args ? { args: truncateArgs(entry.args) } : {}),
    };
    const line = JSON.stringify(sanitized) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');

    rotateIfNeeded();
  } catch (err: unknown) {
    // Experience logging is best-effort; never fail a tool call because of it.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to record experience entry: ${msg}`);
  }
}

/**
 * Read recent experience entries from the JSONL file.
 *
 * Reads the last `window` lines efficiently by seeking from the end
 * of the file for large files, or reading the whole file for small ones.
 */
export function readRecentEntries(window: number = DEFAULT_WINDOW): ExperienceEntry[] {
  const filePath = getExperiencePath();
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);

    // Take the last `window` lines
    const recent = lines.slice(-window);

    const entries: ExperienceEntry[] = [];
    for (const line of recent) {
      try {
        entries.push(JSON.parse(line) as ExperienceEntry);
      } catch {
        // Skip malformed lines
      }
    }
    return entries;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to read experience entries: ${msg}`);
    return [];
  }
}

/**
 * Aggregate recent failures into patterns grouped by tool + error category.
 *
 * @param window - Number of recent entries to consider
 * @param minCount - Minimum failure count for a pattern to be included
 * @param minRate - Minimum failure rate (0-1) for a pattern to be included
 * @returns Array of FailurePattern sorted by failCount descending
 */
export function summarizeRecentFailures(
  window: number = DEFAULT_WINDOW,
  minCount: number = DEFAULT_MIN_COUNT,
  minRate: number = DEFAULT_MIN_RATE
): FailurePattern[] {
  const entries = readRecentEntries(window);
  if (entries.length === 0) {
    return [];
  }

  // Group by tool name
  const toolGroups = new Map<string, ExperienceEntry[]>();
  for (const entry of entries) {
    const group = toolGroups.get(entry.tool) ?? [];
    group.push(entry);
    toolGroups.set(entry.tool, group);
  }

  const patterns: FailurePattern[] = [];

  for (const [tool, toolEntries] of toolGroups) {
    const failures = toolEntries.filter((e) => !e.ok);
    if (failures.length < minCount) {
      continue;
    }

    const failRate = failures.length / toolEntries.length;
    if (failRate < minRate) {
      continue;
    }

    // Sub-group failures by error category for more specific patterns
    const errorCategories = new Map<string, { count: number; example: string }>();
    for (const failure of failures) {
      const errMsg = failure.err ?? 'Unknown error';
      const category = categorizeError(errMsg);
      const existing = errorCategories.get(category);
      if (existing) {
        existing.count++;
      } else {
        errorCategories.set(category, { count: 1, example: errMsg });
      }
    }

    // Emit one pattern per error category if there are multiple, otherwise one
    if (errorCategories.size <= 1) {
      const example = failures[0].err ?? 'Unknown error';
      patterns.push({
        tool,
        failCount: failures.length,
        totalCount: toolEntries.length,
        failRate,
        example,
      });
    } else {
      for (const [_category, info] of errorCategories) {
        if (info.count < minCount) {
          // Emit even if sub-category count is low, as long as the overall
          // tool failure rate is high enough
        }
        patterns.push({
          tool,
          failCount: info.count,
          totalCount: toolEntries.length,
          failRate: info.count / toolEntries.length,
          example: info.example,
        });
      }
    }
  }

  // Sort by failCount descending
  patterns.sort((a, b) => b.failCount - a.failCount);

  return patterns;
}

/**
 * Build a "Known issues" text block from failure patterns, suitable for
 * injecting into the system prompt.
 *
 * Returns an empty string if there are no failure patterns.
 */
export function buildKnownIssuesText(patterns: FailurePattern[]): string {
  if (patterns.length === 0) {
    return '';
  }

  const lines: string[] = [
    '',
    '## Recent tool failures to avoid',
  ];

  for (const p of patterns) {
    const suggestion = suggestAlternative(p);
    const rateStr = `${p.failCount}/${p.totalCount}`;
    lines.push(
      `- ${p.tool}: ${rateStr} recent calls failed with "${truncateErrorMessage(p.example)}"${suggestion}`
    );
  }

  return lines.join('\n');
}

/**
 * Rotate the experience JSONL file if it exceeds the size limit.
 *
 * Keeps only the most recent entries that fit within half the max size.
 * This is a simple truncation strategy — we keep the tail of the file.
 */
export function rotateIfNeeded(maxBytes: number = DEFAULT_MAX_BYTES): void {
  try {
    const filePath = getExperiencePath();
    if (!fs.existsSync(filePath)) {
      return;
    }

    const stat = fs.statSync(filePath);
    if (stat.size < maxBytes) {
      return;
    }

    // File is too large — read all lines, keep only the most recent ones
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);

    // Keep approximately half the lines (these should be well under the size limit)
    const keepCount = Math.ceil(lines.length / 2);
    const kept = lines.slice(-keepCount);

    fs.writeFileSync(filePath, kept.join('\n') + '\n', 'utf-8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to rotate experience log: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Categorize an error message into a short label for grouping.
 *
 * Extracts the key signal from common error patterns so that
 * similar errors (e.g. "ENOENT: no such file 'foo'" and
 * "ENOENT: no such file 'bar'") get grouped together.
 */
function categorizeError(errMsg: string): string {
  // Common Node.js error codes
  const codeMatch = errMsg.match(/^(ENOENT|EACCES|EISDIR|ENOTDIR|EMFILE|ENOSPC|EPERM|ETIMEDOUT|ECONNREFUSED|ECONNRESET)/i);
  if (codeMatch) {
    return codeMatch[1].toUpperCase();
  }

  // Timeout patterns
  if (/timeout/i.test(errMsg)) {
    return 'Timeout';
  }

  // Permission denied patterns
  if (/permission|forbidden|unauthorized/i.test(errMsg)) {
    return 'Permission';
  }

  // Browser-specific patterns
  if (/navigation|page\.goto|waiting.*selector/i.test(errMsg)) {
    return 'Browser-Navigation';
  }
  if (/click|tap|intercept/i.test(errMsg)) {
    return 'Browser-Interaction';
  }

  // Syntax/parse errors
  if (/syntax|parse|unexpected token/i.test(errMsg)) {
    return 'Syntax';
  }

  // Default: use first 30 chars of the message as category
  return errMsg.slice(0, 30);
}

/**
 * Truncate an error message to a reasonable display length.
 */
function truncateErrorMessage(msg: string, maxLen: number = 80): string {
  if (msg.length <= maxLen) {
    return msg;
  }
  return msg.slice(0, maxLen - 3) + '...';
}

/**
 * Suggest an alternative approach based on the failure pattern.
 */
function suggestAlternative(p: FailurePattern): string {
  const example = p.example.toLowerCase();

  if (example.includes('timeout')) {
    return ' — consider adding wait time or using a different approach';
  }
  if (example.includes('enoent') || example.includes('not found') || example.includes('no such file')) {
    return ' — double-check file paths before executing';
  }
  if (example.includes('eacces') || example.includes('permission')) {
    return ' — verify file/directory permissions';
  }
  if (example.includes('eisdir') || example.includes('enotdir')) {
    return ' — verify paths are the correct type (file vs directory)';
  }
  if (example.includes('syntax') || example.includes('parse')) {
    return ' — validate syntax before executing';
  }
  if (example.includes('navigation') || example.includes('page') || example.includes('browser')) {
    return ' — consider retrying with wait or checking the URL';
  }

  return '';
}
