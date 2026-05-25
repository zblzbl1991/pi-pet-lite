/**
 * YAML/JSON parser for workflow definitions.
 *
 * Parses workflow files (YAML or JSON) into typed WorkflowDefinition objects.
 * Builds DAG from steps and validates for cycles and missing dependencies.
 *
 * The YAML parser is a minimal implementation that handles the subset of YAML
 * needed for workflow definitions (key-value pairs, lists, nested objects, strings).
 * Falls back to JSON.parse for JSON files.
 */

import * as fs from 'fs';
import type {
  WorkflowDefinition,
  WorkflowInput,
  WorkflowStep,
  DAGNode,
  WorkflowValidationError,
} from './types';

// ---------------------------------------------------------------------------
// Minimal YAML parser
// ---------------------------------------------------------------------------

/**
 * Parse a YAML string into a JavaScript object.
 *
 * Handles:
 * - Key: value pairs
 * - Lists (with - prefix)
 * - Nested objects via indentation
 * - Quoted and unquoted strings
 * - Numbers, booleans, null
 * - Flow syntax for inline arrays [a, b]
 *
 * This is intentionally minimal - only the subset needed for workflow YAML files.
 */
export function parseYaml(content: string): unknown {
  const lines = content.split('\n');
  return parseLines(lines, 0, 0).value;
}

interface ParseResult {
  value: unknown;
  nextLine: number;
}

function parseLines(lines: string[], startLine: number, baseIndent: number): ParseResult {
  // Determine if this is a list or an object
  let i = startLine;
  while (i < lines.length) {
    const trimmed = lines[i].trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    const indent = lines[i].length - lines[i].trimStart().length;
    if (indent < baseIndent && baseIndent > 0) {
      // We've dedented past our level - done
      return { value: null, nextLine: i };
    }
    break;
  }

  if (i >= lines.length) {
    return { value: null, nextLine: i };
  }

  const firstTrimmed = lines[i].trimStart();
  const firstIndent = lines[i].length - firstTrimmed.length;

  if (firstIndent < baseIndent && baseIndent > 0) {
    return { value: null, nextLine: i };
  }

  // Check if this is a list
  if (firstTrimmed.startsWith('- ') || firstTrimmed === '-') {
    return parseYamlList(lines, i, firstIndent);
  } else {
    return parseYamlObject(lines, i, firstIndent);
  }
}

function parseYamlObject(lines: string[], startLine: number, baseIndent: number): ParseResult {
  const obj: Record<string, unknown> = {};
  let i = startLine;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (trimmed === '' || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    const indent = line.length - trimmed.length;
    if (indent < baseIndent) {
      break;
    }
    if (indent > baseIndent) {
      // Skip unexpected indentation
      i++;
      continue;
    }

    // Parse key: value
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    const afterColon = trimmed.slice(colonIdx + 1).trim();

    if (afterColon === '' || afterColon === '|' || afterColon === '>') {
      // Value is on the next lines (block)
      i++;
      if (i < lines.length) {
        const nextTrimmed = lines[i].trimStart();
        const nextIndent = lines[i].length - nextTrimmed.length;

        if (nextIndent > baseIndent) {
          // Could be a list or nested object
          if (nextTrimmed.startsWith('- ') || nextTrimmed === '-') {
            const result = parseYamlList(lines, i, nextIndent);
            obj[key] = result.value;
            i = result.nextLine;
          } else if (nextTrimmed.includes(':')) {
            const result = parseYamlObject(lines, i, nextIndent);
            obj[key] = result.value;
            i = result.nextLine;
          } else {
            // Multi-line string
            const strs: string[] = [];
            while (i < lines.length) {
              const sTrimmed = lines[i].trimStart();
              const sIndent = lines[i].length - sTrimmed.length;
              if (sIndent < nextIndent && sTrimmed !== '') break;
              if (sTrimmed !== '') strs.push(sTrimmed);
              i++;
            }
            obj[key] = strs.join('\n');
          }
        } else {
          obj[key] = null;
        }
      }
    } else {
      // Inline value
      obj[key] = parseScalar(afterColon);
      i++;
    }
  }

  return { value: obj, nextLine: i };
}

function parseYamlList(lines: string[], startLine: number, baseIndent: number): ParseResult {
  const arr: unknown[] = [];
  let i = startLine;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (trimmed === '' || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    const indent = line.length - trimmed.length;
    if (indent < baseIndent) {
      break;
    }
    if (indent > baseIndent) {
      // Continuation of previous item - skip
      i++;
      continue;
    }

    if (!trimmed.startsWith('- ') && trimmed !== '-') {
      break;
    }

    const afterDash = trimmed.startsWith('- ') ? trimmed.slice(2) : '';

    if (afterDash === '') {
      // Item value on next lines
      i++;
      if (i < lines.length) {
        const nextTrimmed = lines[i].trimStart();
        const nextIndent = lines[i].length - nextTrimmed.length;
        if (nextIndent > baseIndent) {
          if (nextTrimmed.startsWith('- ')) {
            const result = parseYamlList(lines, i, nextIndent);
            arr.push(result.value);
            i = result.nextLine;
          } else if (nextTrimmed.includes(':')) {
            const result = parseYamlObject(lines, i, nextIndent);
            arr.push(result.value);
            i = result.nextLine;
          } else {
            arr.push(parseScalar(nextTrimmed));
            i++;
          }
        }
      }
    } else if (afterDash.includes(': ')) {
      // Inline object start: - key: value ...
      // Collect all key: value pairs at the same indent level after the dash
      const obj: Record<string, unknown> = {};
      const colonIdx = afterDash.indexOf(': ');
      const key = afterDash.slice(0, colonIdx).trim();
      const value = afterDash.slice(colonIdx + 2).trim();
      obj[key] = parseScalar(value);

      // Check next lines for more key: value at indent + 2 (dash continuation)
      i++;
      const itemIndent = baseIndent + 2; // "- " adds 2 chars
      while (i < lines.length) {
        const nextLine = lines[i];
        const nextTrimmed = nextLine.trimStart();
        if (nextTrimmed === '' || nextTrimmed.startsWith('#')) {
          i++;
          continue;
        }
        const nextIndent = nextLine.length - nextTrimmed.length;
        if (nextIndent < itemIndent) break;
        if (nextIndent === itemIndent && nextTrimmed.includes(': ')) {
          const nc = nextTrimmed.indexOf(': ');
          const nk = nextTrimmed.slice(0, nc).trim();
          const nv = nextTrimmed.slice(nc + 2).trim();
          obj[nk] = parseScalar(nv);
          i++;
        } else if (nextIndent >= itemIndent) {
          // Nested value
          if (nextTrimmed.startsWith('- ')) {
            const result = parseYamlList(lines, i, nextIndent);
            const lastKey = Object.keys(obj).pop();
            if (lastKey && obj[lastKey] === null) {
              obj[lastKey] = result.value;
            }
            i = result.nextLine;
          } else if (nextTrimmed.includes(':')) {
            const nc = nextTrimmed.indexOf(':');
            const nk = nextTrimmed.slice(0, nc).trim();
            obj[nk] = null; // placeholder
            i++;
            // Parse the nested value
            if (i < lines.length) {
              const deeperTrimmed = lines[i].trimStart();
              const deeperIndent = lines[i].length - deeperTrimmed.length;
              if (deeperIndent > nextIndent) {
                if (deeperTrimmed.startsWith('- ')) {
                  const result = parseYamlList(lines, i, deeperIndent);
                  obj[nk] = result.value;
                  i = result.nextLine;
                } else {
                  const result = parseYamlObject(lines, i, deeperIndent);
                  obj[nk] = result.value;
                  i = result.nextLine;
                }
              }
            }
          } else {
            i++;
          }
        } else {
          break;
        }
      }
      arr.push(obj);
    } else {
      // Simple scalar value
      arr.push(parseScalar(afterDash));
      i++;
    }
  }

  return { value: arr, nextLine: i };
}

function parseScalar(value: string): unknown {
  // Remove quotes if present
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  // Boolean
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Null
  if (trimmed === 'null' || trimmed === '~') return null;

  // Number
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== '') return num;

  // Flow array [a, b, c]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => parseScalar(s.trim()));
  }

  return trimmed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a workflow file (YAML or JSON) into a WorkflowDefinition.
 * Returns null if parsing fails.
 */
export function parseWorkflowFile(filePath: string): WorkflowDefinition | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[workflow] Failed to read ${filePath}: ${msg}`);
    return null;
  }

  return parseWorkflowContent(content, filePath);
}

/**
 * Parse workflow content string into a WorkflowDefinition.
 */
export function parseWorkflowContent(content: string, sourcePath?: string): WorkflowDefinition | null {
  let raw: unknown;
  const ext = sourcePath?.toLowerCase();

  if (ext?.endsWith('.json')) {
    try {
      raw = JSON.parse(content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[workflow] JSON parse error in ${sourcePath}: ${msg}`);
      return null;
    }
  } else {
    // Try YAML first, fall back to JSON
    try {
      raw = parseYaml(content);
    } catch (_err: unknown) {
      try {
        raw = JSON.parse(content);
      } catch (err2: unknown) {
        const msg = err2 instanceof Error ? err2.message : String(err2);
        console.warn(`[workflow] Parse error in ${sourcePath}: ${msg}`);
        return null;
      }
    }
  }

  if (!raw || typeof raw !== 'object') {
    console.warn(`[workflow] Parsed content is not an object in ${sourcePath}`);
    return null;
  }

  return coerceToWorkflowDefinition(raw as Record<string, unknown>);
}

/**
 * Coerce a raw parsed object into a WorkflowDefinition.
 * Validates basic structure and applies defaults.
 */
function coerceToWorkflowDefinition(raw: Record<string, unknown>): WorkflowDefinition | null {
  const name = typeof raw.name === 'string' ? raw.name : '';
  const description = typeof raw.description === 'string' ? raw.description : '';

  if (!name) {
    console.warn('[workflow] Missing "name" field in workflow definition');
    return null;
  }

  // Parse inputs
  const inputs: WorkflowInput[] = [];
  if (Array.isArray(raw.inputs)) {
    for (const inp of raw.inputs) {
      if (inp && typeof inp === 'object') {
        const obj = inp as Record<string, unknown>;
        inputs.push({
          name: typeof obj.name === 'string' ? obj.name : '',
          type: (typeof obj.type === 'string' && ['string', 'number', 'boolean'].includes(obj.type))
            ? obj.type as 'string' | 'number' | 'boolean'
            : 'string',
          required: obj.required !== false,
          default: obj.default,
        });
      }
    }
  }

  // Parse steps
  const steps: WorkflowStep[] = [];
  if (Array.isArray(raw.steps)) {
    for (const step of raw.steps) {
      if (step && typeof step === 'object') {
        const obj = step as Record<string, unknown>;
        const id = typeof obj.id === 'string' ? obj.id : '';
        const agent = typeof obj.agent === 'string' ? obj.agent : '';

        if (!id || !agent) {
          console.warn(`[workflow] Step missing "id" or "agent" in workflow "${name}"`);
          continue;
        }

        steps.push({
          id,
          agent,
          prompt: typeof obj.prompt === 'string' ? obj.prompt : '',
          dependsOn: Array.isArray(obj.depends_on || obj.dependsOn)
            ? (obj.depends_on || obj.dependsOn) as string[]
            : undefined,
          outputKey: typeof (obj.output_key || obj.outputKey) === 'string'
            ? (obj.output_key || obj.outputKey) as string
            : undefined,
          condition: typeof obj.condition === 'string' ? obj.condition : undefined,
        });
      }
    }
  }

  if (steps.length === 0) {
    console.warn(`[workflow] No valid steps found in workflow "${name}"`);
    return null;
  }

  return { name, description, inputs, steps };
}

// ---------------------------------------------------------------------------
// DAG building
// ---------------------------------------------------------------------------

/**
 * Build a DAG from workflow steps.
 * Returns nodes keyed by step ID.
 */
export function buildDAG(steps: WorkflowStep[]): Map<string, DAGNode> {
  const nodes = new Map<string, DAGNode>();

  // Create nodes
  for (const step of steps) {
    nodes.set(step.id, {
      step,
      inDegree: step.dependsOn?.length ?? 0,
      dependents: [],
    });
  }

  // Build edges: for each step's dependsOn, add this step as a dependent
  for (const step of steps) {
    if (step.dependsOn) {
      for (const depId of step.dependsOn) {
        const depNode = nodes.get(depId);
        if (depNode) {
          depNode.dependents.push(step.id);
        }
      }
    }
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a workflow definition.
 * Returns an array of validation errors (empty if valid).
 */
export function validateWorkflow(def: WorkflowDefinition): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];

  if (!def.name) {
    errors.push({ message: 'Workflow name is required' });
  }

  if (def.steps.length === 0) {
    errors.push({ message: 'Workflow must have at least one step' });
  }

  // Check for duplicate step IDs
  const stepIds = new Set<string>();
  for (const step of def.steps) {
    if (stepIds.has(step.id)) {
      errors.push({ stepId: step.id, message: `Duplicate step ID: "${step.id}"` });
    }
    stepIds.add(step.id);

    if (!step.agent) {
      errors.push({ stepId: step.id, message: `Step "${step.id}" is missing "agent" field` });
    }
    if (!step.prompt) {
      errors.push({ stepId: step.id, message: `Step "${step.id}" is missing "prompt" field` });
    }
  }

  // Check for missing dependencies
  for (const step of def.steps) {
    if (step.dependsOn) {
      for (const depId of step.dependsOn) {
        if (!stepIds.has(depId)) {
          errors.push({
            stepId: step.id,
            message: `Step "${step.id}" depends on unknown step "${depId}"`,
          });
        }
      }
    }
  }

  // Check for cycles using topological sort (Kahn's algorithm)
  const cycleErrors = detectCycles(def.steps);
  errors.push(...cycleErrors);

  // Validate inputs
  const inputNames = new Set<string>();
  for (const inp of def.inputs) {
    if (inputNames.has(inp.name)) {
      errors.push({ message: `Duplicate input name: "${inp.name}"` });
    }
    inputNames.add(inp.name);
  }

  return errors;
}

/**
 * Detect cycles in the workflow step graph using Kahn's algorithm.
 */
function detectCycles(steps: WorkflowStep[]): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];
  const inDegree: Record<string, number> = {};
  const adjacency: Record<string, string[]> = {};

  for (const step of steps) {
    inDegree[step.id] = step.dependsOn?.length ?? 0;
    adjacency[step.id] = [];
  }

  for (const step of steps) {
    if (step.dependsOn) {
      for (const depId of step.dependsOn) {
        if (adjacency[depId]) {
          adjacency[depId].push(step.id);
        }
      }
    }
  }

  const queue: string[] = [];
  for (const step of steps) {
    if (inDegree[step.id] === 0) {
      queue.push(step.id);
    }
  }

  let processedCount = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processedCount++;
    for (const next of adjacency[current]) {
      inDegree[next]--;
      if (inDegree[next] === 0) {
        queue.push(next);
      }
    }
  }

  if (processedCount < steps.length) {
    // Find the steps involved in the cycle
    const cycleSteps = steps
      .filter((s) => inDegree[s.id] > 0)
      .map((s) => s.id);
    errors.push({
      message: `Cycle detected involving steps: ${cycleSteps.join(', ')}`,
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

/**
 * Resolve template references in a prompt string.
 *
 * Supports:
 * - {inputs.topic} - workflow input values
 * - {research.output} - output of a completed step
 * - {research.status} - status of a step
 * - {research_result} - alias for output via outputKey
 */
export function resolveTemplate(
  template: string,
  inputs: Record<string, unknown>,
  stepResults: Map<string, { status: string; output?: string }>
): string {
  let result = template;

  // Replace {inputs.x} or {input.x} with input values
  result = result.replace(/\{input(?:s)?\.(\w+)\}/g, (_match, key: string) => {
    const value = inputs[key];
    if (value === undefined) return `[missing input: ${key}]`;
    return String(value);
  });

  // Replace {stepId.output} with step output
  result = result.replace(/\{(\w+)\.(output|status)\}/g, (_match, stepId: string, field: string) => {
    const stepResult = stepResults.get(stepId);
    if (!stepResult) return `[unknown step: ${stepId}]`;
    if (field === 'output') return stepResult.output ?? '';
    if (field === 'status') return stepResult.status;
    return '';
  });

  // Replace {outputKey} references (from step outputKey fields)
  result = result.replace(/\{(\w+)\}/g, (match, key: string) => {
    // Don't replace if already processed or if it looks like a nested reference
    if (key.includes('.')) return match;
    // Check if it matches a step id directly and has output
    const stepResult = stepResults.get(key);
    if (stepResult?.output !== undefined) return stepResult.output;
    // Return as-is if not resolved
    return match;
  });

  return result;
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a condition expression.
 *
 * Supported formats:
 * - "stepId.output contains 'text'" - checks if step output contains text
 * - "stepId.output equals 'text'" - checks if step output equals text
 * - "stepId.output not_empty" - checks if step output is not empty
 *
 * Returns true if condition is met, false otherwise.
 * Returns true if condition string is empty/undefined.
 */
export function evaluateCondition(
  condition: string | undefined,
  stepResults: Map<string, { status: string; output?: string }>
): boolean {
  if (!condition || condition.trim() === '') return true;

  const trimmed = condition.trim();

  // "stepId.output not_empty"
  const notEmptyMatch = trimmed.match(/^(\w+)\.output\s+not_empty$/);
  if (notEmptyMatch) {
    const stepId = notEmptyMatch[1];
    const result = stepResults.get(stepId);
    return !!result?.output && result.output.trim().length > 0;
  }

  // "stepId.output contains 'text'"
  const containsMatch = trimmed.match(/^(\w+)\.output\s+contains\s+['"](.+)['"]$/);
  if (containsMatch) {
    const stepId = containsMatch[1];
    const text = containsMatch[2];
    const result = stepResults.get(stepId);
    return !!result?.output && result.output.includes(text);
  }

  // "stepId.output equals 'text'"
  const equalsMatch = trimmed.match(/^(\w+)\.output\s+equals\s+['"](.+)['"]$/);
  if (equalsMatch) {
    const stepId = equalsMatch[1];
    const text = equalsMatch[2];
    const result = stepResults.get(stepId);
    return result?.output === text;
  }

  // Unknown condition format - log warning and return true (don't block execution)
  console.warn(`[workflow] Unknown condition format: "${trimmed}"`);
  return true;
}
