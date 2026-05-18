/**
 * Per-pet FIFO task queue with bounded depth.
 *
 * Each pet has its own task queue. When a pet is busy executing a task,
 * incoming tasks are queued. The queue has a maximum depth to prevent
 * unbounded memory growth. Oldest tasks are dropped when the queue overflows.
 */

/** A pending task awaiting execution */
export interface QueuedTask {
  /** Unique task identifier */
  id: string;
  /** The prompt text to send to the agent */
  prompt: string;
  /** Timestamp when the task was enqueued */
  enqueuedAt: number;
  /** Resolve callback for the promise returned by delegate() */
  resolve: (result: TaskResult) => void;
  /** Reject callback for the promise returned by delegate() */
  reject: (error: Error) => void;
}

/** Result of executing a task */
export interface TaskResult {
  /** Whether the task completed successfully */
  success: boolean;
  /** Response text from the agent (or error message) */
  output: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/** Default maximum queue depth per pet */
const DEFAULT_MAX_DEPTH = 5;

/**
 * Bounded FIFO task queue for a single pet.
 *
 * Tasks are processed in order. When the queue is full, the oldest
 * pending task is evicted (rejected with an overflow error).
 */
export class TaskQueue {
  private queue: QueuedTask[] = [];
  private readonly maxDepth: number;
  private taskCounter = 0;

  constructor(maxDepth: number = DEFAULT_MAX_DEPTH) {
    this.maxDepth = maxDepth;
  }

  /**
   * Enqueue a task. Returns a promise that resolves when the task completes.
   *
   * If the queue is at capacity, the oldest pending task is evicted
   * to make room for the new one.
   */
  enqueue(prompt: string): { task: QueuedTask; promise: Promise<TaskResult> } {
    // Evict oldest if at capacity
    if (this.queue.length >= this.maxDepth) {
      const evicted = this.queue.shift();
      if (evicted) {
        evicted.reject(new Error('Task evicted: queue overflow'));
      }
    }

    const id = `task-${++this.taskCounter}-${Date.now()}`;

    let resolve!: (result: TaskResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<TaskResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const task: QueuedTask = {
      id,
      prompt,
      enqueuedAt: Date.now(),
      resolve,
      reject,
    };

    this.queue.push(task);
    return { task, promise };
  }

  /**
   * Dequeue the next task (FIFO order).
   * Returns undefined if the queue is empty.
   */
  dequeue(): QueuedTask | undefined {
    return this.queue.shift();
  }

  /**
   * Peek at the next task without removing it.
   */
  peek(): QueuedTask | undefined {
    return this.queue[0];
  }

  /**
   * Number of tasks currently in the queue.
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Whether the queue is empty.
   */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Reject all pending tasks (used during disposal).
   */
  clear(reason: string): void {
    for (const task of this.queue) {
      task.reject(new Error(reason));
    }
    this.queue.length = 0;
  }
}
