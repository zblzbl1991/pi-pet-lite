/**
 * Workflow execution engine.
 *
 * Runs workflow definitions by building a DAG, executing steps in dependency
 * order with parallelism for independent steps. Each step delegates to an
 * agent via PetManager.
 *
 * Lifecycle:
 * - run(): start a workflow, returns run ID
 * - pause(): stop scheduling new steps (current steps finish)
 * - resume(): continue from where paused
 * - cancel(): abort running steps, skip remaining
 * - getStatus(): get current run state
 * - listRuns(): get all runs
 */

import type { PetManager } from '../pet-manager';
import { TaskPriority } from '../task-scheduler';
import { buildDAG, validateWorkflow, resolveTemplate, evaluateCondition } from './parser';
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowRun,
  StepResult,
  DAGNode,
  WorkflowRunSnapshot,
} from './types';
import { WorkflowRunStatus } from './types';

// ---------------------------------------------------------------------------
// Run ID counter
// ---------------------------------------------------------------------------

let runCounter = 0;

function generateRunId(): string {
  return `wf-run-${++runCounter}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// WorkflowEngine
// ---------------------------------------------------------------------------

export class WorkflowEngine {
  private readonly petManager: PetManager;
  private readonly runs: Map<string, WorkflowRun> = new Map();
  private readonly activeExecutions: Map<string, {
    runId: string;
    abortControllers: Set<string>; // step IDs with active AbortController
  }> = new Map();

  constructor(petManager: PetManager) {
    this.petManager = petManager;
  }

  /**
   * Start a workflow run.
   *
   * Validates the workflow, creates a run record, and begins executing
   * steps from the DAG's entry points (nodes with inDegree 0).
   *
   * @returns The run ID
   */
  run(workflow: WorkflowDefinition, inputs: Record<string, unknown>): string {
    // Validate
    const errors = validateWorkflow(workflow);
    if (errors.length > 0) {
      const errorMessages = errors.map((e) => e.message).join('; ');
      throw new Error(`Workflow validation failed: ${errorMessages}`);
    }

    // Validate required inputs
    for (const inp of workflow.inputs) {
      if (inp.required && (inputs[inp.name] === undefined || inputs[inp.name] === '')) {
        throw new Error(`Missing required input: "${inp.name}"`);
      }
    }

    // Create run
    const runId = generateRunId();
    const run: WorkflowRun = {
      id: runId,
      workflowName: workflow.name,
      status: WorkflowRunStatus.RUNNING,
      inputs,
      stepResults: new Map(),
      startedAt: Date.now(),
    };

    // Initialize step results
    for (const step of workflow.steps) {
      run.stepResults.set(step.id, {
        stepId: step.id,
        status: 'pending',
      });
    }

    this.runs.set(runId, run);

    // Start execution
    this.executeWorkflow(runId, workflow).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[workflow] Unhandled error in workflow "${workflow.name}" run ${runId}: ${msg}`);
      const existingRun = this.runs.get(runId);
      if (existingRun && existingRun.status === WorkflowRunStatus.RUNNING) {
        existingRun.status = WorkflowRunStatus.FAILED;
        existingRun.completedAt = Date.now();
      }
    });

    return runId;
  }

  /**
   * Pause a workflow run.
   * Currently running steps will complete, but no new steps will be scheduled.
   */
  pause(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status !== WorkflowRunStatus.RUNNING) {
      throw new Error(`Cannot pause run in status: ${run.status}`);
    }
    run.status = WorkflowRunStatus.PAUSED;
    console.log(`[workflow] Paused run ${runId}`);
  }

  /**
   * Resume a paused workflow run.
   */
  resume(runId: string, workflow: WorkflowDefinition): void {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status !== WorkflowRunStatus.PAUSED) {
      throw new Error(`Cannot resume run in status: ${run.status}`);
    }
    run.status = WorkflowRunStatus.RUNNING;
    console.log(`[workflow] Resumed run ${runId}`);

    // Continue execution
    this.executeWorkflow(runId, workflow).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[workflow] Error resuming run ${runId}: ${msg}`);
    });
  }

  /**
   * Cancel a workflow run.
   * Aborts currently running steps and marks remaining steps as skipped.
   */
  cancel(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    run.status = WorkflowRunStatus.CANCELLED;
    run.completedAt = Date.now();

    // Abort any running steps
    const activeExec = this.activeExecutions.get(runId);
    if (activeExec) {
      for (const stepId of activeExec.abortControllers) {
        // Try to abort via PetManager - find which agent this step targets
        const stepResult = run.stepResults.get(stepId);
        if (stepResult?.status === 'running') {
          stepResult.status = 'failed';
          stepResult.error = 'Workflow cancelled';
          stepResult.completedAt = Date.now();
        }
      }
      this.activeExecutions.delete(runId);
    }

    // Mark all pending steps as skipped
    for (const [_stepId, stepResult] of run.stepResults) {
      if (stepResult.status === 'pending') {
        stepResult.status = 'skipped';
      }
    }

    console.log(`[workflow] Cancelled run ${runId}`);
  }

  /**
   * Get the status of a workflow run.
   */
  getStatus(runId: string): WorkflowRun | null {
    return this.runs.get(runId) ?? null;
  }

  /**
   * List all workflow runs.
   */
  listRuns(): WorkflowRun[] {
    return Array.from(this.runs.values());
  }

  /**
   * Get a snapshot of a run (serializable for IPC).
   */
  getRunSnapshot(runId: string): WorkflowRunSnapshot | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    return runToSnapshot(run);
  }

  /**
   * Get snapshots of all runs (serializable for IPC).
   */
  listRunSnapshots(): WorkflowRunSnapshot[] {
    return Array.from(this.runs.values()).map(runToSnapshot);
  }

  // ---------------------------------------------------------------------------
  // Private: execution logic
  // ---------------------------------------------------------------------------

  /**
   * Execute a workflow run by processing the DAG.
   *
   * Algorithm:
   * 1. Build DAG from steps
   * 2. Find all nodes with inDegree 0 (no unmet dependencies)
   * 3. Execute them in parallel
   * 4. When a step completes, decrement inDegree of dependents
   * 5. Repeat until no more steps can run
   */
  private async executeWorkflow(runId: string, workflow: WorkflowDefinition): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    // Build DAG
    const dag = buildDAG(workflow.steps);

    // Track remaining in-degrees (mutable copy)
    const remainingInDegree = new Map<string, number>();
    for (const [stepId, node] of dag) {
      // If step already completed/failed/skipped, don't count it
      const stepResult = run.stepResults.get(stepId);
      if (stepResult?.status === 'completed' || stepResult?.status === 'failed' || stepResult?.status === 'skipped') {
        remainingInDegree.set(stepId, 0); // Already processed
        continue;
      }
      // Recalculate in-degree based on completed dependencies
      let inDeg = 0;
      if (node.step.dependsOn) {
        for (const depId of node.step.dependsOn) {
          const depResult = run.stepResults.get(depId);
          if (depResult?.status !== 'completed') {
            inDeg++;
          }
        }
      }
      remainingInDegree.set(stepId, inDeg);
    }

    const activeExec = {
      runId,
      abortControllers: new Set<string>(),
    };
    this.activeExecutions.set(runId, activeExec);

    try {
      while (true) {
        // Check if run is still active
        if (run.status === WorkflowRunStatus.CANCELLED || run.status === WorkflowRunStatus.FAILED) {
          break;
        }
        if (run.status === WorkflowRunStatus.PAUSED) {
          // Stop scheduling; resume() will call executeWorkflow again
          break;
        }

        // Find ready steps (inDegree === 0 and not yet started)
        const readySteps: WorkflowStep[] = [];
        for (const [stepId, inDeg] of remainingInDegree) {
          if (inDeg === 0) {
            const stepResult = run.stepResults.get(stepId);
            if (stepResult?.status === 'pending') {
              readySteps.push(dag.get(stepId)!.step);
            }
          }
        }

        if (readySteps.length === 0) {
          // No more steps to run - check if we're done or stuck
          const hasRunning = Array.from(run.stepResults.values()).some(
            (sr) => sr.status === 'running'
          );
          if (!hasRunning) {
            // All steps processed
            break;
          }
          // Wait for running steps to complete
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }

        // Execute ready steps in parallel
        const promises = readySteps.map((step) =>
          this.executeStep(runId, step, dag, run, workflow)
        );

        await Promise.allSettled(promises);

        // Update remaining in-degrees based on completed steps
        for (const step of readySteps) {
          remainingInDegree.set(step.id, -1); // Mark as processed

          // Decrement dependents' in-degree
          const node = dag.get(step.id)!;
          for (const depStepId of node.dependents) {
            const currentDeg = remainingInDegree.get(depStepId) ?? 0;
            if (currentDeg > 0) {
              remainingInDegree.set(depStepId, currentDeg - 1);
            }
          }
        }
      }
    } finally {
      this.activeExecutions.delete(runId);
    }

    // Set final status
    if (run.status === WorkflowRunStatus.RUNNING) {
      const allCompleted = Array.from(run.stepResults.values()).every(
        (sr) => sr.status === 'completed' || sr.status === 'skipped'
      );
      const anyFailed = Array.from(run.stepResults.values()).some(
        (sr) => sr.status === 'failed'
      );

      if (anyFailed) {
        run.status = WorkflowRunStatus.FAILED;
      } else if (allCompleted) {
        run.status = WorkflowRunStatus.COMPLETED;
      }
      run.completedAt = Date.now();
      console.log(`[workflow] Run ${runId} finished with status: ${run.status}`);
    }
  }

  /**
   * Execute a single workflow step.
   */
  private async executeStep(
    runId: string,
    step: WorkflowStep,
    _dag: Map<string, DAGNode>,
    run: WorkflowRun,
    workflow: WorkflowDefinition
  ): Promise<void> {
    const stepResult = run.stepResults.get(step.id)!;
    const activeExec = this.activeExecutions.get(runId);

    // Check condition
    if (step.condition) {
      const conditionMet = evaluateCondition(step.condition, run.stepResults);
      if (!conditionMet) {
        stepResult.status = 'skipped';
        stepResult.completedAt = Date.now();
        console.log(`[workflow] Step "${step.id}" skipped (condition not met: "${step.condition}")`);
        return;
      }
    }

    // Resolve prompt template
    const resolvedPrompt = resolveTemplate(step.prompt, run.inputs, run.stepResults);
    if (!resolvedPrompt) {
      stepResult.status = 'failed';
      stepResult.error = 'Empty prompt after template resolution';
      stepResult.completedAt = Date.now();
      console.warn(`[workflow] Step "${step.id}" failed: empty prompt`);
      return;
    }

    // Mark as running
    stepResult.status = 'running';
    stepResult.startedAt = Date.now();
    activeExec?.abortControllers.add(step.id);

    try {
      console.log(`[workflow] Executing step "${step.id}" on agent "${step.agent}"`);

      // Delegate to agent via PetManager with scheduled priority
      const result = await this.petManager.delegateWithPriority(
        step.agent,
        resolvedPrompt,
        TaskPriority.scheduled
      );

      if (result.success) {
        stepResult.status = 'completed';
        stepResult.output = result.output;
        stepResult.completedAt = Date.now();
        console.log(`[workflow] Step "${step.id}" completed (${result.durationMs}ms)`);
      } else {
        stepResult.status = 'failed';
        stepResult.error = result.output;
        stepResult.completedAt = Date.now();
        console.warn(`[workflow] Step "${step.id}" failed: ${result.output}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      stepResult.status = 'failed';
      stepResult.error = msg;
      stepResult.completedAt = Date.now();
      console.error(`[workflow] Step "${step.id}" threw error: ${msg}`);
    } finally {
      activeExec?.abortControllers.delete(step.id);
    }
  }

  /**
   * Dispose: cancel all running workflows.
   */
  dispose(): void {
    for (const [runId, run] of this.runs) {
      if (run.status === WorkflowRunStatus.RUNNING) {
        this.cancel(runId);
      }
    }
    this.runs.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runToSnapshot(run: WorkflowRun): WorkflowRunSnapshot {
  return {
    id: run.id,
    workflowName: run.workflowName,
    status: run.status,
    inputs: run.inputs,
    stepResults: Array.from(run.stepResults.entries()),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}
