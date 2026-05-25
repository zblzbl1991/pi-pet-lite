/**
 * Priority-based task scheduler with dependency tracking and Blackboard watchers.
 *
 * Replaces the simple FIFO TaskQueue with:
 * - Priority scheduling: critical > user > scheduled > background
 * - Task dependencies: tasks can wait for other tasks to complete
 * - Blackboard watchers: trigger tasks when Blackboard keys change (stub)
 * - Dependency timeout and failure policies
 *
 * Design decisions (from PRD):
 * - D1: No preemption. High-priority tasks go to queue head; current task completes first.
 * - D2: Dependencies are task-level (by task ID), not agent-level.
 */

import { TaskResult } from './task-queue';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Task priority levels (lower number = higher priority) */
const TaskPriority = {
  critical: 0,   // user direct input
  user: 1,       // user-initiated non-immediate ops
  scheduled: 2,  // cron tasks
  background: 3, // maintenance tasks
} as const;
type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

export { TaskPriority };

/** A task awaiting execution in the scheduler */
interface ScheduledTask {
  /** Unique task identifier */
  id: string;
  /** The pet this task is for */
  petId: string;
  /** The prompt text to send to the agent */
  prompt: string;
  /** Task priority */
  priority: TaskPriority;
  /** Task IDs this task waits for before it can execute */
  dependsOn?: string[];
  /** What to do if a dependency fails: 'skip' rejects the task, 'retry' keeps waiting */
  dependencyPolicy?: 'skip' | 'retry';
  /** Dependency wait timeout in ms. If exceeded, treat dependency as failed */
  timeout?: number;
  /** Arbitrary metadata attached to this task */
  metadata?: Record<string, unknown>;
}

/** Lifecycle status of a scheduled task */
const TaskStatus = {
  PENDING: 'pending',
  WAITING: 'waiting',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export { TaskStatus };
export type { ScheduledTask };

/** Handle returned when a task is enqueued */
export interface TaskHandle {
  /** The enqueued task's unique ID */
  taskId: string;
  /** Promise that resolves/rejects when the task completes */
  promise: Promise<TaskResult>;
  /** Cancel the pending task */
  cancel(): void;
}

/** Callback for Blackboard key changes */
export type WatchHandler = (change: {
  namespace: string;
  key: string;
  newValue: string;
  oldValue: string | null;
}) => void;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Internal tracked task state */
interface TrackedTask {
  task: ScheduledTask;
  resolve: (result: TaskResult) => void;
  reject: (error: Error) => void;
  status: TaskStatus;
  /** Timestamp when the task was enqueued (for timeout tracking) */
  enqueuedAt: number;
  /** Timeout timer handle (for dependency waits) */
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

/** Default maximum total tasks (ready + waiting) */
const DEFAULT_MAX_DEPTH = 5;

/** Default dependency timeout in ms (5 minutes) */
const DEFAULT_DEPENDENCY_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// TaskScheduler
// ---------------------------------------------------------------------------

/**
 * Priority-based task scheduler with dependency support.
 *
 * Maintains two internal queues:
 * - readyQueue: tasks whose dependencies are satisfied, sorted by priority
 * - waitingQueue: tasks waiting for dependencies to complete
 *
 * On enqueue: if all deps met -> readyQueue, else -> waitingQueue.
 * On complete: check waiting tasks, promote those whose deps are now met.
 * No preemption: the highest-priority ready task runs after the current one finishes.
 */
export class TaskScheduler {
  private readyQueue: TrackedTask[] = [];
  private waitingQueue: TrackedTask[] = [];
  private readonly taskMap: Map<string, TrackedTask> = new Map();
  private readonly maxDepth: number;
  private taskCounter = 0;

  /** Blackboard watcher subscriptions */
  private watchers: Map<string, Set<{ handler: WatchHandler; persistent: boolean }>> = new Map();

  constructor(maxDepth: number = DEFAULT_MAX_DEPTH) {
    this.maxDepth = maxDepth;
  }

  /**
   * Enqueue a task. Returns a TaskHandle with a promise that resolves on completion.
   *
   * If all dependencies are satisfied, the task goes to the ready queue (sorted by priority).
   * Otherwise, it goes to the waiting queue until deps are resolved.
   *
   * If the total task count exceeds maxDepth, the lowest-priority task in the
   * ready queue is evicted.
   */
  enqueue(task: ScheduledTask): TaskHandle {
    // Evict lowest-priority ready task if at capacity
    if (this.totalCount >= this.maxDepth) {
      this.evictLowestPriority();
    }

    let resolve!: (result: TaskResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<TaskResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const tracked: TrackedTask = {
      task,
      resolve,
      reject,
      status: this.areDependenciesMet(task) ? TaskStatus.PENDING : TaskStatus.WAITING,
      enqueuedAt: Date.now(),
      timeoutTimer: null,
    };

    this.taskMap.set(task.id, tracked);

    if (tracked.status === TaskStatus.PENDING) {
      // All deps satisfied -> ready queue
      this.insertByPriority(tracked);
    } else {
      // Has unmet deps -> waiting queue
      this.waitingQueue.push(tracked);
      // Set up dependency timeout
      this.setupDependencyTimeout(tracked);
    }

    return {
      taskId: task.id,
      promise,
      cancel: () => this.cancel(task.id),
    };
  }

  /**
   * Cancel a pending or waiting task.
   */
  cancel(taskId: string): void {
    const tracked = this.taskMap.get(taskId);
    if (!tracked) return;

    if (tracked.status === TaskStatus.RUNNING) {
      // Cannot cancel a running task
      return;
    }

    tracked.status = TaskStatus.CANCELLED;
    this.clearTimeoutTimer(tracked);
    this.removeFromQueues(taskId);
    tracked.reject(new Error('Task cancelled'));
    this.taskMap.delete(taskId);
  }

  /**
   * Get the current status of a task.
   */
  getStatus(taskId: string): TaskStatus | undefined {
    return this.taskMap.get(taskId)?.status;
  }

  /**
   * List all tasks currently in the ready queue (pending execution).
   */
  listPending(): ScheduledTask[] {
    return this.readyQueue.map((t) => t.task);
  }

  /**
   * Dequeue the next ready task (highest priority, all deps met).
   * Returns undefined if no tasks are ready.
   */
  dequeue(): ScheduledTask | undefined {
    if (this.readyQueue.length === 0) return undefined;

    const tracked = this.readyQueue.shift()!;
    tracked.status = TaskStatus.RUNNING;
    this.clearTimeoutTimer(tracked);
    return tracked.task;
  }

  /**
   * Mark a task as completed and resolve its promise.
   * Checks the waiting queue for tasks that can now be promoted.
   */
  complete(taskId: string, result: TaskResult): void {
    const tracked = this.taskMap.get(taskId);
    if (!tracked) return;

    tracked.status = result.success ? TaskStatus.COMPLETED : TaskStatus.FAILED;
    this.clearTimeoutTimer(tracked);
    tracked.resolve(result);
    this.taskMap.delete(taskId);

    // Promote waiting tasks whose dependencies are now satisfied
    this.promoteWaitingTasks();
  }

  /**
   * Register a Blackboard watcher for a specific namespace:key.
   *
   * When the Blackboard key changes, the handler is invoked.
   * If `persistent` is false, the watcher auto-removes after first invocation.
   * Returns an unsubscribe function.
   */
  watchBlackboard(
    namespace: string,
    key: string,
    handler: WatchHandler,
    persistent: boolean = true
  ): () => void {
    const watcherKey = `${namespace}:${key}`;
    let watchers = this.watchers.get(watcherKey);
    if (!watchers) {
      watchers = new Set();
      this.watchers.set(watcherKey, watchers);
    }

    const entry = { handler, persistent };
    watchers.add(entry);

    return () => {
      const w = this.watchers.get(watcherKey);
      if (w) {
        w.delete(entry);
        if (w.size === 0) {
          this.watchers.delete(watcherKey);
        }
      }
    };
  }

  /**
   * Notify watchers of a Blackboard key change.
   * Called externally when the Blackboard is updated.
   */
  notifyBlackboardChange(
    namespace: string,
    key: string,
    newValue: string,
    oldValue: string | null
  ): void {
    const watcherKey = `${namespace}:${key}`;
    const watchers = this.watchers.get(watcherKey);
    if (!watchers) return;

    const change = { namespace, key, newValue, oldValue };

    // Copy to avoid mutation during iteration
    const entries = Array.from(watchers);
    for (const entry of entries) {
      // Remove one-shot watchers before invoking
      if (!entry.persistent) {
        watchers.delete(entry);
        if (watchers.size === 0) {
          this.watchers.delete(watcherKey);
        }
      }
      try {
        entry.handler(change);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[task-scheduler] Watcher error for ${watcherKey}: ${message}`);
      }
    }
  }

  /** Total number of tasks across both queues */
  get totalCount(): number {
    return this.readyQueue.length + this.waitingQueue.length;
  }

  /** Number of ready tasks */
  get readyCount(): number {
    return this.readyQueue.length;
  }

  /** Number of waiting tasks */
  get waitingCount(): number {
    return this.waitingQueue.length;
  }

  /** Whether the ready queue is empty */
  get isEmpty(): boolean {
    return this.readyQueue.length === 0;
  }

  /**
   * Reject all pending/waiting tasks and clear the scheduler.
   */
  clear(reason: string): void {
    for (const tracked of this.readyQueue) {
      this.clearTimeoutTimer(tracked);
      tracked.reject(new Error(reason));
    }
    for (const tracked of this.waitingQueue) {
      this.clearTimeoutTimer(tracked);
      tracked.reject(new Error(reason));
    }
    this.readyQueue.length = 0;
    this.waitingQueue.length = 0;
    // Remove cleared tasks from taskMap (keep running/completed)
    for (const [id, tracked] of this.taskMap) {
      if (
        tracked.status === TaskStatus.PENDING ||
        tracked.status === TaskStatus.WAITING
      ) {
        this.taskMap.delete(id);
      }
    }
  }

  /**
   * Dispose the scheduler: clear all tasks and watchers.
   */
  dispose(): void {
    this.clear('TaskScheduler disposed');
    this.watchers.clear();
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  /**
   * Check if all dependencies for a task are satisfied (completed).
   */
  private areDependenciesMet(task: ScheduledTask): boolean {
    if (!task.dependsOn || task.dependsOn.length === 0) return true;

    return task.dependsOn.every((depId) => {
      const dep = this.taskMap.get(depId);
      return dep?.status === TaskStatus.COMPLETED;
    });
  }

  /**
   * Check if any dependency of a task has failed.
   */
  private hasFailedDependency(task: ScheduledTask): boolean {
    if (!task.dependsOn || task.dependsOn.length === 0) return false;

    return task.dependsOn.some((depId) => {
      const dep = this.taskMap.get(depId);
      return dep?.status === TaskStatus.FAILED || dep?.status === TaskStatus.CANCELLED;
    });
  }

  /**
   * Insert a tracked task into the ready queue, sorted by priority (ascending = higher first).
   * Stable sort: tasks with the same priority maintain insertion order.
   */
  private insertByPriority(tracked: TrackedTask): void {
    // Find the insertion point: insert before the first task with lower priority (higher number)
    let insertIdx = this.readyQueue.length;
    for (let i = 0; i < this.readyQueue.length; i++) {
      if (this.readyQueue[i].task.priority > tracked.task.priority) {
        insertIdx = i;
        break;
      }
    }
    this.readyQueue.splice(insertIdx, 0, tracked);
  }

  /**
   * Promote waiting tasks whose dependencies are now satisfied.
   * Also handles tasks whose dependencies have failed.
   */
  private promoteWaitingTasks(): void {
    const stillWaiting: TrackedTask[] = [];

    for (const tracked of this.waitingQueue) {
      // Check if any dependency failed
      if (this.hasFailedDependency(tracked.task)) {
        const policy = tracked.task.dependencyPolicy ?? 'skip';
        if (policy === 'skip') {
          // Reject the task
          tracked.status = TaskStatus.FAILED;
          this.clearTimeoutTimer(tracked);
          tracked.resolve({
            success: false,
            output: 'Dependency task failed or was cancelled',
            durationMs: Date.now() - tracked.enqueuedAt,
          });
          this.taskMap.delete(tracked.task.id);
          continue;
        }
        // 'retry' policy: keep waiting (dependency might be re-enqueued)
        stillWaiting.push(tracked);
        continue;
      }

      // Check if all deps are met
      if (this.areDependenciesMet(tracked.task)) {
        tracked.status = TaskStatus.PENDING;
        this.clearTimeoutTimer(tracked);
        this.insertByPriority(tracked);
      } else {
        stillWaiting.push(tracked);
      }
    }

    this.waitingQueue = stillWaiting;
  }

  /**
   * Set up a timeout timer for a waiting task's dependencies.
   * If the timeout fires before deps are met, treat as dependency failure.
   */
  private setupDependencyTimeout(tracked: TrackedTask): void {
    const timeoutMs = tracked.task.timeout ?? DEFAULT_DEPENDENCY_TIMEOUT_MS;
    tracked.timeoutTimer = setTimeout(() => {
      if (tracked.status !== TaskStatus.WAITING) return;

      const policy = tracked.task.dependencyPolicy ?? 'skip';
      if (policy === 'skip') {
        tracked.status = TaskStatus.FAILED;
        tracked.resolve({
          success: false,
          output: 'Dependency wait timed out',
          durationMs: Date.now() - tracked.enqueuedAt,
        });
        this.taskMap.delete(tracked.task.id);
        // Remove from waiting queue
        const idx = this.waitingQueue.indexOf(tracked);
        if (idx !== -1) {
          this.waitingQueue.splice(idx, 1);
        }
      }
      // 'retry' policy: just keep waiting
    }, timeoutMs);
  }

  /**
   * Clear a tracked task's timeout timer.
   */
  private clearTimeoutTimer(tracked: TrackedTask): void {
    if (tracked.timeoutTimer !== null) {
      clearTimeout(tracked.timeoutTimer);
      tracked.timeoutTimer = null;
    }
  }

  /**
   * Remove a task from both queues by ID.
   */
  private removeFromQueues(taskId: string): void {
    const readyIdx = this.readyQueue.findIndex((t) => t.task.id === taskId);
    if (readyIdx !== -1) {
      this.readyQueue.splice(readyIdx, 1);
    }
    const waitIdx = this.waitingQueue.findIndex((t) => t.task.id === taskId);
    if (waitIdx !== -1) {
      this.waitingQueue.splice(waitIdx, 1);
    }
  }

  /**
   * Evict the lowest-priority task from the ready queue.
   * If the ready queue is empty, evict the lowest-priority from the waiting queue.
   */
  private evictLowestPriority(): void {
    if (this.readyQueue.length > 0) {
      // Ready queue is sorted by priority, so last element is lowest priority
      const evicted = this.readyQueue.pop()!;
      evicted.status = TaskStatus.CANCELLED;
      this.clearTimeoutTimer(evicted);
      evicted.reject(new Error('Task evicted: scheduler overflow'));
      this.taskMap.delete(evicted.task.id);
      return;
    }

    if (this.waitingQueue.length > 0) {
      // Find lowest priority in waiting queue
      let lowestIdx = 0;
      for (let i = 1; i < this.waitingQueue.length; i++) {
        if (this.waitingQueue[i].task.priority > this.waitingQueue[lowestIdx].task.priority) {
          lowestIdx = i;
        }
      }
      const evicted = this.waitingQueue.splice(lowestIdx, 1)[0];
      evicted.status = TaskStatus.CANCELLED;
      this.clearTimeoutTimer(evicted);
      evicted.reject(new Error('Task evicted: scheduler overflow'));
      this.taskMap.delete(evicted.task.id);
    }
  }
}
