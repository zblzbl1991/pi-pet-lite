/**
 * Centralized PetManager for managing multiple agent instances.
 *
 * Creates, tracks, and disposes agent instances for multiple pets.
 * Features:
 * - On-demand agent creation from PetProfile
 * - Idle reaping: agents unused for N minutes are disposed
 * - Max concurrent limit (default 3 active agents)
 * - Per-pet priority task queues with dependency support
 * - Health tracking per pet (success/error counts, latency)
 * - Abort capability per pet
 * - Status reporting via callback
 *
 * NOTE: This class runs in the agent utility process, NOT the main process.
 * It manages AgentRuntime instances in-process. The main process communicates
 * with it via MessagePort, routing messages per petId.
 */

import { createAgentRuntime, setCreatingPetId, AgentRuntime, AgentEventCallback, ConfirmationHandler } from './runtime';
import { createRemoteAgentRuntime } from './remote-runtime';
import { TaskResult } from './task-queue';
import { TaskScheduler, TaskPriority, ScheduledTask } from './task-scheduler';
import { AgentChannel } from './agent-channel';
import type { AgentMessage } from './agent-channel';
import { setCurrentPetId } from './tools/messaging';
import { AgentEvents, EventBus } from './event-bus';
import { getProfileById, getProfileByRole, getDefaultProfile, getProfileIds } from './profiles';
import {
  PET_MANAGER_MAX_CONCURRENT,
  PET_MANAGER_IDLE_TIMEOUT_MINUTES,
  PET_MANAGER_MAX_QUEUE_DEPTH,
} from '../shared/constants';
import type { PetProfile, PetStatus, PetStatusReportMessage } from '../shared/types';
import type { SessionStore } from '../storage/session-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A managed pet: profile, runtime, and health metadata */
interface ManagedPet {
  /** The pet's profile */
  profile: PetProfile;
  /** The agent runtime instance */
  agent: AgentRuntime;
  /** Active session ID for conversation persistence */
  sessionId: string;
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
  private taskSchedulers: Map<string, TaskScheduler> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly config: PetManagerConfig;
  private readonly onStatusChange: StatusChangeCallback | null;
  private readonly onEvent: AgentEventCallback;
  private readonly getConfirmation: ConfirmationHandler;
  private reaperInterval: ReturnType<typeof setInterval> | null = null;
  private readonly eventBus: EventBus | null;
  private readonly sessionStore: SessionStore | null;
  private taskCounter = 0;
  private readonly agentChannel: AgentChannel;

  /**
   * @param onEvent - Callback for agent events forwarded to the renderer
   * @param getConfirmation - Confirmation handler for tool calls
   * @param onStatusChange - Optional callback for pet status changes
   * @param eventBus - Optional event bus for decoupled event distribution
   * @param sessionStore - Optional session store for conversation persistence
   * @param config - Optional configuration overrides
   */
  constructor(
    onEvent: AgentEventCallback,
    getConfirmation: ConfirmationHandler,
    onStatusChange?: StatusChangeCallback,
    eventBus?: EventBus,
    sessionStore?: SessionStore,
    config?: Partial<PetManagerConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onEvent = onEvent;
    this.onStatusChange = onStatusChange ?? null;
    this.getConfirmation = getConfirmation;
    this.eventBus = eventBus ?? null;
    this.sessionStore = sessionStore ?? null;
    this.agentChannel = new AgentChannel();
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
   * If the pet is busy, the task is queued (priority-based, max depth 5).
   * If the max concurrent limit is reached, the least recently used
   * idle agent is disposed to make room.
   *
   * Default priority is `user`.
   *
   * @param petId - The target pet's profile id
   * @param prompt - The task prompt text
   * @returns Promise resolving to the task result
   */
  async delegate(petIdOrRole: string, prompt: string): Promise<TaskResult> {
    return this.delegateWithPriority(petIdOrRole, prompt, TaskPriority.user);
  }

  /**
   * Send a task to a pet's agent with explicit priority.
   *
   * @param petIdOrRole - The target pet's profile id or role
   * @param prompt - The task prompt text
   * @param priority - Task priority (critical, user, scheduled, background)
   * @param options - Optional scheduling options (dependencies, timeout, etc.)
   * @returns Promise resolving to the task result
   */
  async delegateWithPriority(
    petIdOrRole: string,
    prompt: string,
    priority: TaskPriority = TaskPriority.user,
    options?: { dependsOn?: string[]; dependencyPolicy?: 'skip' | 'retry'; timeout?: number; metadata?: Record<string, unknown> }
  ): Promise<TaskResult> {
    // Resolve by id first, then by role (for cases like "remote" where id is "remote-1234")
    const profile = getProfileById(petIdOrRole) ?? getProfileByRole(petIdOrRole) ?? getDefaultProfile();
    const actualPetId = profile.id;
    console.log(`[pet-mgr] delegate(${petIdOrRole}) resolved to petId=${actualPetId}, role=${profile.role}, priority=${priority}`);

    // Ensure the agent exists
    await this.ensureAgent(actualPetId, profile);

    // Get or create the task scheduler
    let scheduler = this.taskSchedulers.get(actualPetId);
    if (!scheduler) {
      scheduler = new TaskScheduler(this.config.maxQueueDepth);
      this.taskSchedulers.set(actualPetId, scheduler);
    }

    // Build the scheduled task
    const taskId = `task-${++this.taskCounter}-${Date.now()}`;
    const task: ScheduledTask = {
      id: taskId,
      petId: actualPetId,
      prompt,
      priority,
      dependsOn: options?.dependsOn,
      dependencyPolicy: options?.dependencyPolicy,
      timeout: options?.timeout,
      metadata: options?.metadata,
    };

    // Enqueue the task
    const handle = scheduler.enqueue(task);

    // If the agent is idle, start processing the queue
    const managed = this.agents.get(actualPetId);
    if (managed && !managed.isExecuting) {
      // Process asynchronously so the caller gets the promise immediately
      this.processQueue(actualPetId).catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`Error processing queue for ${actualPetId}: ${errorMessage}`);
      });
    }

    return handle.promise;
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
      const scheduler = this.taskSchedulers.get(petId);
      return {
        petId,
        status: managed?.status ?? 'offline',
        queueLength: scheduler?.totalCount ?? 0,
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

  // ---------------------------------------------------------------------------
  // Agent-to-Agent messaging
  // ---------------------------------------------------------------------------

  /**
   * Route a direct message from one agent to another.
   *
   * Validates the target is online and local (not A2A/remote).
   * Sends via the AgentChannel and emits an AGENT_MESSAGE event on the EventBus.
   *
   * @param from - Sender petId
   * @param to - Receiver petId or role name
   * @param type - Message type (question, answer, notification, custom)
   * @param payload - Message content
   * @returns The created AgentMessage
   * @throws Error if target is offline, remote/A2A, or payload too large
   */
  routeMessage(from: string, to: string, type: string, payload: string): AgentMessage {
    // Resolve target: try as petId first, then as role
    const targetProfile = getProfileById(to) ?? getProfileByRole(to);
    if (!targetProfile) {
      throw new Error(`Unknown target "${to}". No matching profile found.`);
    }
    const targetPetId = targetProfile.id;

    // R5: Reject remote (A2A) targets
    if (targetProfile.a2a) {
      throw new Error(
        `Cannot send direct message to "${to}" — remote (A2A) agents do not support direct messaging. ` +
        'Use delegate_task through Chief instead.'
      );
    }

    // Check target is online
    if (!this.agents.has(targetPetId)) {
      throw new Error(
        `Cannot send message to "${to}" — the agent is currently offline. ` +
        'The target must be active to receive messages.'
      );
    }

    // Send through channel
    const message = this.agentChannel.send({
      from,
      to: targetPetId,
      type,
      payload,
    });

    // Emit EventBus event
    this.eventBus?.emit(AgentEvents.AGENT_MESSAGE, message);

    return message;
  }

  /**
   * Get all messages in a pet's inbox.
   */
  getInbox(petId: string): AgentMessage[] {
    return this.agentChannel.getInbox(petId);
  }

  /**
   * Mark all messages in a pet's inbox as read.
   */
  markInboxRead(petId: string): void {
    this.agentChannel.markAllRead(petId);
  }

  /**
   * Get unread message info for a pet (count and unique senders).
   * Used for system prompt injection.
   */
  getInboxSummary(petId: string): { unreadCount: number; senders: string[] } {
    return {
      unreadCount: this.agentChannel.getUnreadCount(petId),
      senders: this.agentChannel.getUnreadSenders(petId),
    };
  }

  /**
   * Dispose a specific pet's agent and clear its queue.
   */
  dispose(petId: string): void {
    const managed = this.agents.get(petId);
    if (managed) {
      managed.agent.dispose();
      // Mark session as disposed (data preserved for future restore)
      if (this.sessionStore && managed.sessionId) {
        this.sessionStore.disposeSession(petId);
      }
      this.agents.delete(petId);
    }

    const scheduler = this.taskSchedulers.get(petId);
    if (scheduler) {
      scheduler.clear('Pet agent disposed');
      this.taskSchedulers.delete(petId);
    }

    this.clearTimer(petId);

    // Clear inbox on dispose (D2: no persistence)
    this.agentChannel.clearInbox(petId);

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

    for (const [_petId, scheduler] of this.taskSchedulers) {
      scheduler.clear('PetManager shutdown');
    }
    this.taskSchedulers.clear();

    for (const [petId, _timer] of this.timers) {
      this.clearTimer(petId);
    }

    // Clear all message inboxes
    this.agentChannel.clearAll();

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
    console.log(`[pet-mgr] ensureAgent(${petId}, role=${profile.role}, a2a=${!!profile.a2a})`);

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

    // Create the agent runtime (local or remote)
    try {
      // Resolve session: restore existing or create new
      let sessionId: string | undefined;
      if (this.sessionStore && !profile.a2a) {
        sessionId = this.sessionStore.getOrCreateSession(petId);
      }

      console.log(`[pet-mgr] Creating ${profile.a2a ? 'REMOTE' : 'LOCAL'} runtime for ${petId}...`);
      // Set creating petId so runtime can check inbox and tools know their pet context
      setCreatingPetId(petId);
      const agent = profile.a2a
        ? await createRemoteAgentRuntime(this.onEvent, this.getConfirmation, profile)
        : await createAgentRuntime(
            this.onEvent,
            this.getConfirmation,
            profile,
            this.eventBus ?? undefined,
            this.sessionStore ?? undefined,
            sessionId
          );
      console.log(`[pet-mgr] Runtime created for ${petId}${sessionId ? ` (session: ${sessionId})` : ''}`);

      const managed: ManagedPet = {
        profile,
        agent,
        sessionId: sessionId ?? '',
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
   * Process the task scheduler for a pet.
   * Executes tasks by priority until no ready tasks remain.
   */
  private async processQueue(petId: string): Promise<void> {
    const managed = this.agents.get(petId);
    if (!managed) return;

    const scheduler = this.taskSchedulers.get(petId);
    if (!scheduler || scheduler.isEmpty) return;

    // Mark as executing
    managed.isExecuting = true;
    managed.status = 'busy';
    this.emitStatusChange(petId, 'busy');

    try {
      while (!scheduler.isEmpty) {
        const task = scheduler.dequeue();
        if (!task) break;

        const startTime = Date.now();

        try {
          // Reset idle timer since we're active
          this.resetIdleTimer(petId);

          // Set current petId so messaging tools know who they are
          setCurrentPetId(petId);

          const agentOutput = await managed.agent.prompt(task.prompt);

          const durationMs = Date.now() - startTime;
          managed.successCount++;
          managed.lastActivity = Date.now();

          scheduler.complete(task.id, {
            success: true,
            output: agentOutput || 'Task completed successfully',
            durationMs,
          });
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const durationMs = Date.now() - startTime;
          managed.errorCount++;
          managed.lastActivity = Date.now();

          scheduler.complete(task.id, {
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
