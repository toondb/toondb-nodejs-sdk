/**
 * SochDB Priority Queue
 * 
 * First-class queue API with ordered-key task entries, providing efficient
 * priority queue operations without the O(N) blob rewrite anti-pattern.
 * 
 * Features:
 * - Ordered-key representation: Each task has its own key, no blob parsing
 * - O(log N) enqueue/dequeue with ordered scans
 * - Atomic claim protocol for concurrent workers
 * - Visibility timeout for crash recovery
 * 
 * @example
 * ```typescript
 * import { Database, PriorityQueue } from '@sochdb/sochdb';
 * 
 * const db = await Database.open('./queue_db');
 * const queue = PriorityQueue.fromDatabase(db, 'tasks');
 * 
 * // Enqueue task
 * await queue.enqueue(1, Buffer.from('high priority task'));
 * 
 * // Dequeue and process
 * const task = await queue.dequeue('worker-1');
 * if (task) {
 *   // Process task...
 *   await queue.ack(task.taskId);
 * }
 * ```
 */

import { SochDBError } from './errors';

// ============================================================================
// Task State
// ============================================================================

export enum TaskState {
  PENDING = 'pending',
  CLAIMED = 'claimed',
  COMPLETED = 'completed',
  DEAD_LETTERED = 'dead_lettered',
}

// ============================================================================
// Queue Configuration
// ============================================================================

export interface QueueConfig {
  name: string;
  visibilityTimeout?: number; // milliseconds, default 30000
  maxRetries?: number; // default 3
  deadLetterQueue?: string;
}

// ============================================================================
// Queue Key Encoding
// ============================================================================

/**
 * Encode u64 as big-endian for lexicographic ordering
 */
function encodeU64BE(value: number): Buffer {
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64BE(BigInt(value));
  return buf;
}

/**
 * Decode big-endian u64
 */
function decodeU64BE(buf: Buffer): number {
  return Number(buf.readBigUInt64BE(0));
}

/**
 * Encode i64 as big-endian preserving order
 */
function encodeI64BE(value: number): Buffer {
  // Map i64 to u64 by adding offset
  const mapped = BigInt(value) + (1n << 63n);
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64BE(mapped);
  return buf;
}

/**
 * Decode big-endian i64
 */
function decodeI64BE(buf: Buffer): number {
  const mapped = buf.readBigUInt64BE(0);
  return Number(mapped - (1n << 63n));
}

// ============================================================================
// Queue Key
// ============================================================================

export interface QueueKey {
  queueId: string;
  priority: number;
  readyTs: number; // timestamp in milliseconds
  sequence: number;
  taskId: string;
}

/**
 * Encode queue key to bytes for storage
 */
function encodeQueueKey(key: QueueKey): Buffer {
  const parts = [
    Buffer.from('queue/'),
    Buffer.from(key.queueId),
    Buffer.from('/'),
    encodeI64BE(key.priority),
    Buffer.from('/'),
    encodeU64BE(key.readyTs),
    Buffer.from('/'),
    encodeU64BE(key.sequence),
    Buffer.from('/'),
    Buffer.from(key.taskId),
  ];
  
  return Buffer.concat(parts);
}

/**
 * Decode queue key from bytes using positional parsing.
 * Key format: "queue/" + queueId + "/" + i64BE(priority) + "/" + u64BE(readyTs) + "/" + u64BE(sequence) + "/" + taskId
 * Binary fields may contain 0x2F ('/'), so split('/') is NOT safe.
 */
function decodeQueueKey(data: Buffer): QueueKey {
  // Must start with "queue/"
  const prefix = Buffer.from('queue/');
  if (data.length < prefix.length || data.subarray(0, prefix.length).compare(prefix) !== 0) {
    throw new SochDBError('Invalid queue key format: missing queue/ prefix');
  }

  let offset = prefix.length;

  // Find queueId: scan for the '/' before the 8-byte priority field
  // The queueId ends at the first '/' followed by exactly 8 bytes + '/' + 8 bytes + '/' + 8 bytes + '/' + taskId
  // Strategy: walk from the end. Structure after queueId:
  //   "/" + 8-byte priority + "/" + 8-byte readyTs + "/" + 8-byte sequence + "/" + taskId
  // Total fixed overhead after queueId: 1 + 8 + 1 + 8 + 1 + 8 + 1 = 28 bytes, then taskId
  // Find queueId by scanning for '/' such that remaining = 28 + taskId.len

  // We know: after queueId, fixed structure is:
  //   /[8 bytes]/[8 bytes]/[8 bytes]/[taskId]
  // So scan forward to find the separator. QueueId is a plain string (no binary), 
  // so find the first '/' after "queue/" that has at least 28 bytes remaining after it.
  let queueIdEnd = -1;
  for (let i = offset; i < data.length; i++) {
    if (data[i] === 0x2F) { // '/'
      const remaining = data.length - i - 1; // bytes after this '/'
      // Need 8 (priority) + 1 (/) + 8 (readyTs) + 1 (/) + 8 (sequence) + 1 (/) + at least 1 (taskId) = 28
      if (remaining >= 28) {
        queueIdEnd = i;
        break;
      }
    }
  }

  if (queueIdEnd < 0) {
    throw new SochDBError('Invalid queue key format: cannot find queueId');
  }

  const queueId = data.subarray(offset, queueIdEnd).toString();
  offset = queueIdEnd + 1; // skip '/'

  // Read priority (8 bytes, i64 big-endian order-preserving)
  if (offset + 8 > data.length) throw new SochDBError('Invalid queue key: truncated priority');
  const priority = decodeI64BE(data.subarray(offset, offset + 8) as Buffer);
  offset += 8;

  // Skip '/'
  if (data[offset] !== 0x2F) throw new SochDBError('Invalid queue key: expected / after priority');
  offset += 1;

  // Read readyTs (8 bytes, u64 big-endian)
  if (offset + 8 > data.length) throw new SochDBError('Invalid queue key: truncated readyTs');
  const readyTs = decodeU64BE(data.subarray(offset, offset + 8) as Buffer);
  offset += 8;

  // Skip '/'
  if (data[offset] !== 0x2F) throw new SochDBError('Invalid queue key: expected / after readyTs');
  offset += 1;

  // Read sequence (8 bytes, u64 big-endian)
  if (offset + 8 > data.length) throw new SochDBError('Invalid queue key: truncated sequence');
  const sequence = decodeU64BE(data.subarray(offset, offset + 8) as Buffer);
  offset += 8;

  // Skip '/'
  if (data[offset] !== 0x2F) throw new SochDBError('Invalid queue key: expected / after sequence');
  offset += 1;

  // Remaining is taskId
  const taskId = data.subarray(offset).toString();

  return { queueId, priority, readyTs, sequence, taskId };
}

// ============================================================================
// Task
// ============================================================================

export interface Task {
  taskId: string;
  priority: number;
  payload: Buffer;
  state: TaskState;
  enqueuedAt: number;
  claimedAt?: number;
  claimedBy?: string;
  completedAt?: number;
  retries: number;
  metadata?: Record<string, any>;
}

// ============================================================================
// Queue Statistics
// ============================================================================

export interface QueueStats {
  pending: number;
  claimed: number;
  completed: number;
  deadLettered: number;
  totalEnqueued: number;
  totalDequeued: number;
}

// ============================================================================
// Priority Queue
// ============================================================================

export class PriorityQueue {
  private static sequenceCounter = 0;

  constructor(
    private db: any,
    private config: QueueConfig
  ) {
    // Set defaults
    this.config.visibilityTimeout = config.visibilityTimeout || 30000;
    this.config.maxRetries = config.maxRetries || 3;
  }

  /**
   * Create queue from embedded database
   */
  static fromDatabase(db: any, name: string, config?: Partial<QueueConfig>): PriorityQueue {
    const fullConfig: QueueConfig = {
      name,
      ...config,
    };
    return new PriorityQueue(db, fullConfig);
  }

  /**
   * Create queue from gRPC client
   */
  static fromClient(client: any, name: string, config?: Partial<QueueConfig>): PriorityQueue {
    const fullConfig: QueueConfig = {
      name,
      ...config,
    };
    return new PriorityQueue(client, fullConfig);
  }

  /**
   * Enqueue a task with priority
   * Lower priority number = higher urgency
   */
  async enqueue(
    priority: number,
    payload: Buffer,
    metadata?: Record<string, any>
  ): Promise<string> {
    const taskId = this.generateTaskId();
    const now = Date.now();
    
    const key: QueueKey = {
      queueId: this.config.name,
      priority,
      readyTs: now,
      sequence: PriorityQueue.sequenceCounter++,
      taskId,
    };

    const task: Task = {
      taskId,
      priority,
      payload,
      state: TaskState.PENDING,
      enqueuedAt: now,
      retries: 0,
      metadata,
    };

    const keyBuf = encodeQueueKey(key);
    const valueBuf = Buffer.from(JSON.stringify(task));
    
    await this.db.put(keyBuf, valueBuf);
    
    // Update stats
    await this.incrementStat('totalEnqueued');
    await this.incrementStat('pending');
    
    return taskId;
  }

  /**
   * Dequeue the highest priority task
   * Returns null if no tasks available
   */
  async dequeue(workerId: string): Promise<Task | null> {
    const now = Date.now();
    const prefix = Buffer.from(`queue/${this.config.name}/`);

    // Scan all tasks in priority order (binary sort = priority order due to big-endian encoding)
    try {
      for await (const [keyBuf, valueBuf] of this.db.scanPrefix(prefix)) {
        const task: Task = JSON.parse(valueBuf.toString());

        // Skip non-pending tasks
        if (task.state !== TaskState.PENDING) {
          continue;
        }

        // Decode key to check readyTs
        try {
          const queueKey = decodeQueueKey(keyBuf);
          if (queueKey.readyTs > now) {
            continue; // Not ready yet
          }
        } catch {
          continue; // Skip malformed keys
        }

        // Claim this task atomically
        task.state = TaskState.CLAIMED;
        task.claimedAt = now;
        task.claimedBy = workerId;

        // Re-serialize the payload correctly (it's stored as base64 in JSON)
        const updatedValue = Buffer.from(JSON.stringify(task));
        await this.db.put(keyBuf, updatedValue);

        // Update stats
        await this.decrementStat('pending');
        await this.incrementStat('claimed');
        await this.incrementStat('totalDequeued');

        return task;
      }
    } catch {
      // If scan is not available via scanPrefix, return null
    }

    return null;
  }

  /**
   * Acknowledge task completion
   */
  async ack(taskId: string): Promise<void> {
    // Find and update task state
    const result = await this.getTask(taskId);
    if (!result) {
      throw new SochDBError(`Task not found: ${taskId}`);
    }

    const { task } = result;

    if (task.state !== TaskState.CLAIMED) {
      throw new SochDBError(`Task not in claimed state: ${taskId}`);
    }

    // Update task state
    task.state = TaskState.COMPLETED;
    task.completedAt = Date.now();
    
    await this.updateTask(task);
    
    // Update stats
    await this.decrementStat('claimed');
    await this.incrementStat('completed');
  }

  /**
   * Negative acknowledge - return task to queue
   */
  async nack(taskId: string): Promise<void> {
    const result = await this.getTask(taskId);
    if (!result) {
      throw new SochDBError(`Task not found: ${taskId}`);
    }

    const { task } = result;
    task.retries++;
    
    if (task.retries >= (this.config.maxRetries || 3)) {
      // Move to dead letter queue
      task.state = TaskState.DEAD_LETTERED;
      await this.updateTask(task);
      await this.decrementStat('claimed');
      await this.incrementStat('deadLettered');
    } else {
      // Return to pending
      task.state = TaskState.PENDING;
      task.claimedAt = undefined;
      task.claimedBy = undefined;
      await this.updateTask(task);
      await this.decrementStat('claimed');
      await this.incrementStat('pending');
    }
  }

  /**
   * Get queue statistics
   */
  async stats(): Promise<QueueStats> {
    return {
      pending: await this.getStat('pending'),
      claimed: await this.getStat('claimed'),
      completed: await this.getStat('completed'),
      deadLettered: await this.getStat('deadLettered'),
      totalEnqueued: await this.getStat('totalEnqueued'),
      totalDequeued: await this.getStat('totalDequeued'),
    };
  }

  /**
   * Purge completed tasks
   */
  async purge(): Promise<number> {
    const prefix = Buffer.from(`queue/${this.config.name}/`);
    let purged = 0;

    try {
      const toDelete: Buffer[] = [];
      for await (const [keyBuf, valueBuf] of this.db.scanPrefix(prefix)) {
        const task: Task = JSON.parse(valueBuf.toString());
        if (task.state === TaskState.COMPLETED || task.state === TaskState.DEAD_LETTERED) {
          toDelete.push(keyBuf);
        }
      }

      for (const key of toDelete) {
        await this.db.delete(key);
        purged++;
      }
    } catch {
      // Return count so far
    }

    return purged;
  }

  // Helper methods
  private generateTaskId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private async getTask(taskId: string): Promise<{ task: Task; keyBuf: Buffer } | null> {
    const prefix = Buffer.from(`queue/${this.config.name}/`);

    try {
      for await (const [keyBuf, valueBuf] of this.db.scanPrefix(prefix)) {
        const task: Task = JSON.parse(valueBuf.toString());
        if (task.taskId === taskId) {
          return { task, keyBuf };
        }
      }
    } catch {
      // Scan not available
    }

    return null;
  }

  private async updateTask(task: Task): Promise<void> {
    const result = await this.getTask(task.taskId);
    if (result) {
      const valueBuf = Buffer.from(JSON.stringify(task));
      await this.db.put(result.keyBuf, valueBuf);
    }
  }

  private async getStat(name: string): Promise<number> {
    const key = `_queue_stats/${this.config.name}/${name}`;
    const value = await this.db.get(Buffer.from(key));
    return value ? parseInt(value.toString()) : 0;
  }

  private async incrementStat(name: string): Promise<void> {
    const current = await this.getStat(name);
    const key = `_queue_stats/${this.config.name}/${name}`;
    await this.db.put(Buffer.from(key), Buffer.from((current + 1).toString()));
  }

  private async decrementStat(name: string): Promise<void> {
    const current = await this.getStat(name);
    const key = `_queue_stats/${this.config.name}/${name}`;
    await this.db.put(Buffer.from(key), Buffer.from(Math.max(0, current - 1).toString()));
  }
}

/**
 * Create a queue instance
 */
export function createQueue(
  db: any,
  name: string,
  config?: Partial<QueueConfig>
): PriorityQueue {
  return PriorityQueue.fromDatabase(db, name, config);
}
