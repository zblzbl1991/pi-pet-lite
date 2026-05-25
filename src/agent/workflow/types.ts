/**
 * Workflow DSL type definitions.
 *
 * Defines the types for declarative multi-agent workflow orchestration.
 * Workflows are defined in YAML/JSON files and executed by the WorkflowEngine
 * which builds a DAG and runs steps in dependency order with parallelism.
 */

// ---------------------------------------------------------------------------
// Workflow Definition (parsed from YAML/JSON)
// ---------------------------------------------------------------------------

/** A single input parameter for a workflow */
export interface WorkflowInput {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  default?: unknown;
}

/** A single step in a workflow */
export interface WorkflowStep {
  /** Unique step identifier (referenced by dependsOn) */
  id: string;
  /** Target agent role or petId (e.g. "scout", "coder", "analyst", "chief") */
  agent: string;
  /** Prompt template with {input.name} and {stepId.output} references */
  prompt: string;
  /** Step IDs this step depends on (must complete before this step starts) */
  dependsOn?: string[];
  /** Key for referencing this step's output in later templates */
  outputKey?: string;
  /** Simple condition expression: "stepId.output contains 'text'" or "stepId.output not_empty" */
  condition?: string;
}

/** Full workflow definition parsed from a YAML/JSON file */
export interface WorkflowDefinition {
  name: string;
  description: string;
  inputs: WorkflowInput[];
  steps: WorkflowStep[];
}

// ---------------------------------------------------------------------------
// Workflow Run (runtime state)
// ---------------------------------------------------------------------------

/** Status of a workflow run */
export const WorkflowRunStatus = {
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type WorkflowRunStatus = (typeof WorkflowRunStatus)[keyof typeof WorkflowRunStatus];

/** Status of an individual step within a run */
export const StepStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;
export type StepStatus = (typeof StepStatus)[keyof typeof StepStatus];

/** Result of a single step execution */
export interface StepResult {
  stepId: string;
  status: StepStatus;
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

/** A workflow run instance */
export interface WorkflowRun {
  id: string;
  workflowName: string;
  status: WorkflowRunStatus;
  inputs: Record<string, unknown>;
  stepResults: Map<string, StepResult>;
  startedAt: number;
  completedAt?: number;
}

/** Serializable version of WorkflowRun for IPC */
export interface WorkflowRunSnapshot {
  id: string;
  workflowName: string;
  status: WorkflowRunStatus;
  inputs: Record<string, unknown>;
  stepResults: Array<[string, StepResult]>;
  startedAt: number;
  completedAt?: number;
}

// ---------------------------------------------------------------------------
// DAG (internal)
// ---------------------------------------------------------------------------

/** A node in the DAG built from workflow steps */
export interface DAGNode {
  step: WorkflowStep;
  /** Number of unfinished dependencies */
  inDegree: number;
  /** Steps that depend on this step */
  dependents: string[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validation error for a workflow definition */
export interface WorkflowValidationError {
  stepId?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// IPC Message Types
// ---------------------------------------------------------------------------

/** Messages from renderer to agent for workflow operations */
export type WorkflowRendererMessage =
  | { type: 'workflow:list' }
  | { type: 'workflow:run'; workflowName: string; inputs: Record<string, unknown> }
  | { type: 'workflow:pause'; runId: string }
  | { type: 'workflow:resume'; runId: string }
  | { type: 'workflow:cancel'; runId: string }
  | { type: 'workflow:status'; runId: string }
  | { type: 'workflow:history' };

/** Responses from agent to renderer for workflow operations */
export type WorkflowAgentResponse =
  | { type: 'workflow-list-response'; workflows: WorkflowDefinition[] }
  | { type: 'workflow-run-response'; runId: string; success: boolean; error?: string }
  | { type: 'workflow-pause-response'; runId: string; success: boolean; error?: string }
  | { type: 'workflow-resume-response'; runId: string; success: boolean; error?: string }
  | { type: 'workflow-cancel-response'; runId: string; success: boolean; error?: string }
  | { type: 'workflow-status-response'; run: WorkflowRunSnapshot | null }
  | { type: 'workflow-history-response'; runs: WorkflowRunSnapshot[] };

/** Summary of a workflow for display in UI */
export interface WorkflowSummary {
  name: string;
  description: string;
  stepCount: number;
  inputs: WorkflowInput[];
}
