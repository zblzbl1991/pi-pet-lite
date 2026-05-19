/**
 * Centralized PetManager for managing multiple agent instances.
 *
 * Creates, tracks, and disposes agent instances for multiple pets.
 * Features:
 * - On-demand agent creation from PetProfile
 * - Idle reaping: agents unused for N minutes are disposed
 * - Max concurrent limit (default 3 active agents)
 * - Per-pet FIFO task queues (max depth 5)
 * - Health tracking per pet (success/error counts, latency)
 * - Abort capability per pet
 * - Status reporting via callback
 *
 * NOTE: This class runs in the agent utility process, NOT the main process.
 * It manages AgentRuntime instances in-process. The main process communicates
 * with it via MessagePort, routing messages per petId.
 */

import { createAgentRuntime, AgentRuntime, AgentEventCallback, ConfirmationHandler } from './runtime';
import { TaskQueue, TaskResult } from './task-queue';
import { getProfileById, getDefaultProfile, getProfileIds } from './profiles';
import {
  PET_MANAGER_MAX_CONCURRENT,
  PET_MANAGER_IDLE_TIMEOUT_MINUTES,
  PET_MANAGER_MAX_QUEUE_DEPTH,
} from '../shared/constants';
import type { PetProfile, PetStatus, PetStatusReportMessage } from '../shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A managed pet: profile, runtime, and health metadata */
interface ManagedPet {
  /** The pet's profile */
  profile: PetProfile;
  /** The agent runtime instance */
  agent: AgentRuntime;
  /** Current status */
  status: PetStatus;
  /** Timestamp of last activity (prompt or response) */
  lastActivity: number;
  /** Number of successful task completions */
  successCount: number;
  /** Number of failed task completions */
  errorCount: number;
  /** Whether the agent is currently executing a task */
  isExecuting: boolean;
}

/** Configuration for PetManager */
export interface PetManagerConfig {
  /** Maximum concurrent active agents (default: 3) */
  maxConcurrent: number;
  /** Idle timeout in minutes before reaping an agent (default: 15) */
  idleTimeoutMinutes: number;
  /** Maximum task queue depth per pet (default: 5) */
  maxQueueDepth: number;
}

/** Re-export for consumers that need the report shape */
export type { PetStatusReportMessage as PetStatusReport };

/** Callback for pet status changes */
export type StatusChangeCallback = (petId: string, status: PetStatus) => void;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PetManagerConfig = {
  maxConcurrent: PET_MANAGER_MAX_CONCURRENT,
  idleTimeoutMinutes: PET_MANAGER_IDLE_TIMEOUT_MINUTES,
  maxQueueDepth: PET_MANAGER_MAX_QUEUE_DEPTH,
};

// ---------------------------------------------------------------------------
// PetManager
// ---------------------------------------------------------------------------

/**
 * Centralized manager for multi-pet agent instances.
 *
 * Provides on-demand creation, idle reaping, task queuing, and
 * health tracking for each pet profile.
 */
export class PetManager {
  private agents: Map<string, ManagedPet> = new Map();
  private taskQueues: Map<string, TaskQueue> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly config: PetManagerConfig;
  private readonly onStatusChange: StatusChangeCallback | null;
  private readonly onEvent: AgentEventCallback;
  private readonly getConfirmation: ConfirmationHandler;
  private reaperInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * @param onEvent - Callback for agent events forwarded to the renderer
   * @param getConfirmation - Confirmation handler for tool calls
   * @param onStatusChange - Optional callback for pet status changes
   * @param config - Optional configuration overrides
   */
  constructor(
    onEvent: AgentEventCallback,
    getConfirmation: ConfirmationHandler,
    onStatusChange?: StatusChangeCallback,
    config?: Partial<PetManagerConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onEvent = onEvent;
    this.onStatusChange = onStatusChange ?? null;
    this.getConfirmation = getConfirmation;
  }

  /**
   * Start the idle reaper that periodically checks for idle agents.
   */
  startReaper(): void {
    if (this.reaperInterval) return;
    // Check every minute
    this.reaperInterval = setInterval(() => {
      this.reapIdle();
    }, 60_000);
  }

  /**
   * Stop the idle reaper.
   */
  stopReaper(): void {
    if (this.reaperInterval) {
      clearInterval(this.reaperInterval);
      this.reaperInterval = null;
    }
  }

  /**
   * Send a task to a pet's agent. Creates the agent on-demand if needed.
   *
   * If the pet is busy, the task is queued (FIFO, max depth 5).
   * If the max concurrent limit is reached, the least recently used
   * idle agent is disposed to make room.
   *
   * @param petId - The target pet's profile id
   * @param prompt - The task prompt text
   * @returns Promise resolving to the task result
   */
  async delegate(petId: string, prompt: string): Promise<TaskResult> {
    const profile = getProfileById(petId) ?? getDefaultProfile();
    const actualPetId = profile.id;

    // Ensure the agent exists
    await this.ensureAgent(actualPetId, profile);

    // Get or create the task queue
    let queue = this.taskQueues.get(actualPetId);
    if (!queue) {
      queue = new TaskQueue(this.config.maxQueueDepth);
      this.taskQueues.set(actualPetId, queue);
    }

    // Enqueue the task
    const { task, promise } = queue.enqueue(prompt);

    // If the agent is idle, start processing the queue
    const managed = this.agents.get(actualPetId);
    if (managed && !managed.isExecuting) {
      // Process asynchronously so the caller gets the promise immediately
      this.processQueue(actualPetId).catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`Error processing queue for ${actualPetId}: ${errorMessage}`);
      });
    }

    return promise;
  }

  /**
   * Ensure an agent exists for the given pet without sending a prompt.
   * Useful for pre-creating the Chief agent on startup.
   *
   * @param petId - The pet's profile id to ensure is active
   */
  async ensure(petId: string): Promise<void> {
    const profile = getProfileById(petId) ?? getDefaultProfile();
    await this.ensureAgent(profile.id, profile);
  }

  /**
   * Get the current status of a pet.
   */
  getStatus(petId: string): PetStatus {
    const managed = this.agents.get(petId);
    if (!managed) return 'offline';
    return managed.status;
  }

  /**
   * Get status reports for all known pet profiles.
   */
  getAllStatuses(): PetStatusReportMessage[] {
    const allProfileIds = getProfileIds();
    return allProfileIds.map((petId) => {
      const managed = this.agents.get(petId);
      const queue = this.taskQueues.get(petId);
      return {
        petId,
        status: managed?.status ?? 'offline',
        queueLength: queue?.length ?? 0,
        successCount: managed?.successCount ?? 0,
        errorCount: managed?.errorCount ?? 0,
        lastActivity: managed?.lastActivity ?? 0,
      };
    });
  }

  /**
   * Abort a specific pet's current task.
   * Does not affect other pets.
   */
  abort(petId: string): void {
    const managed = this.agents.get(petId);
    if (managed && managed.agent) {
      managed.agent.abort();
      managed.status = 'idle';
      managed.isExecuting = false;
      this.emitStatusChange(petId, 'idle');
    }
  }

  /**
   * Dispose a specific pet's agent and clear its queue.
   */
  dispose(petId: string): void {
    const managed = this.agents.get(petId);
    if (managed) {
      managed.agent.dispose();
      this.agents.delete(petId);
    }

    const queue = this.taskQueues.get(petId);
    if (queue) {
      queue.clear('Pet agent disposed');
      this.taskQueues.delete(petId);
    }

    this.clearTimer(petId);
    this.emitStatusChange(petId, 'offline');
  }

  /**
   * Dispose all agents and clear all queues.
   */
  disposeAll(): void {
    this.stopReaper();

    for (const [petId, managed] of this.agents) {
      try {
        managed.agent.dispose();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error disposing agent ${petId}: ${msg}`);
      }
    }
    this.agents.clear();

    for (const [_petId, queue] of this.taskQueues) {
      queue.clear('PetManager shutdown');
    }
    this.taskQueues.clear();

    for (const [petId, _timer] of this.timers) {
      this.clearTimer(petId);
    }

    // Emit offline for all known profiles
    const allProfileIds = getProfileIds();
    for (const petId of allProfileIds) {
      this.emitStatusChange(petId, 'offline');
    }
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  /**
   * Ensure an agent exists for the given pet. Creates on-demand.
   * If max concurrent is reached, evicts the least recently used idle agent.
   */
  private async ensureAgent(petId: string, profile: PetProfile): Promise<void> {
    // Already active
    if (this.agents.has(petId)) {
      this.resetIdleTimer(petId);
      return;
    }

    // Check concurrent limit and evict if needed
    if (this.agents.size >= this.config.maxConcurrent) {
      this.evictLruIdle();
    }

    // If still at limit after eviction attempt, throw
    if (this.agents.size >= this.config.maxConcurrent) {
      throw new Error(
        `Maximum concurrent agents (${this.config.maxConcurrent}) reached. ` +
        'Please wait for an agent to become idle or reduce active pets.'
      );
    }

    // Create the agent runtime
    try {
      const agent = await createAgentRuntime(
        this.onEvent,
        this.getConfirmation,
        profile
      );

      const managed: ManagedPet = {
        profile,
        agent,
        status: 'idle',
        lastActivity: Date.now(),
        successCount: 0,
        errorCount: 0,
        isExecuting: false,
      };

      this.agents.set(petId, managed);
      this.resetIdleTimer(petId);
      this.emitStatusChange(petId, 'idle');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to create agent for ${petId}: ${msg}`);
      this.emitStatusChange(petId, 'error');
      throw err;
    }
  }

  /**
   * Evict the least recently used idle agent.
   * Prefers agents that are not busy.
   */
  private evictLruIdle(): void {
    let lruPetId: string | null = null;
    let lruTime = Infinity;

    for (const [petId, managed] of this.agents) {
      // Only evict idle agents, never busy ones
      if (!managed.isExecuting && managed.lastActivity < lruTime) {
        lruTime = managed.lastActivity;
        lruPetId = petId;
      }
    }

    if (lruPetId) {
      console.log(`Evicting LRU idle agent: ${lruPetId} (idle for ${Math.round((Date.now() - lruTime) / 60000)}min)`);
      this.dispose(lruPetId);
    }
  }

  /**
   * Process the task queue for a pet.
   * Executes tasks sequentially (FIFO) until the queue is empty.
   */
  private async processQueue(petId: string): Promise<void> {
    const managed = this.agents.get(petId);
    if (!managed) return;

    const queue = this.taskQueues.get(petId);
    if (!queue || queue.isEmpty) return;

    // Mark as executing
    managed.isExecuting = true;
    managed.status = 'busy';
    this.emitStatusChange(petId, 'busy');

    try {
      while (!queue.isEmpty) {
        const task = queue.dequeue();
        if (!task) break;

        const startTime = Date.now();

        try {
          // Reset idle timer since we're active
          this.resetIdleTimer(petId);

          const agentOutput = await managed.agent.prompt(task.prompt);

          const durationMs = Date.now() - startTime;
          managed.successCount++;
          managed.lastActivity = Date.now();

          task.resolve({
            success: true,
            output: agentOutput || 'Task completed successfully',
            durationMs,
          });
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const durationMs = Date.now() - startTime;
          managed.errorCount++;
          managed.lastActivity = Date.now();

          task.resolve({
            success: false,
            output: errorMessage,
            durationMs,
          });
        }

        // Check if agent was aborted or disposed during execution
        if (!this.agents.has(petId)) {
          // Agent was disposed, stop processing
          break;
        }
      }
    } finally {
      // Mark as idle if agent still exists
      if (this.agents.has(petId)) {
        managed.isExecuting = false;
        managed.status = 'idle';
        this.emitStatusChange(petId, 'idle');

        // Dispose specialist agents immediately after their queue empties.
        // Chief stays alive permanently as the main coordinator.
        if (petId !== 'chief') {
          this.dispose(petId);
        } else {
          this.resetIdleTimer(petId);
        }
      }
    }
  }

  /**
   * Reap idle agents that have exceeded the idle timeout.
   */
  private reapIdle(): void {
    const now = Date.now();
    const timeoutMs = this.config.idleTimeoutMinutes * 60_000;

    for (const [petId, managed] of this.agents) {
      if (!managed.isExecuting && (now - managed.lastActivity) > timeoutMs) {
        console.log(
          `Reaping idle agent: ${petId} ` +
          `(idle for ${Math.round((now - managed.lastActivity) / 60000)}min)`
        );
        this.dispose(petId);
      }
    }
  }

  /**
   * Reset the idle timer for a pet.
   */
  private resetIdleTimer(petId: string): void {
    this.clearTimer(petId);

    const timeoutMs = this.config.idleTimeoutMinutes * 60_000;
    const timer = setTimeout(() => {
      const managed = this.agents.get(petId);
      if (managed && !managed.isExecuting) {
        console.log(`Idle timeout reached for ${petId}`);
        this.dispose(petId);
      }
    }, timeoutMs);

    this.timers.set(petId, timer);
  }

  /**
   * Clear the idle timer for a pet.
   */
  private clearTimer(petId: string): void {
    const timer = this.timers.get(petId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(petId);
    }
  }

  /**
   * Emit a status change event.
   */
  private emitStatusChange(petId: string, status: PetStatus): void {
    if (this.onStatusChange) {
      this.onStatusChange(petId, status);
    }
  }
}
