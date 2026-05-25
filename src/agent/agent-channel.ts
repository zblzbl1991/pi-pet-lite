/**
 * Agent-to-Agent direct messaging channel.
 *
 * Provides in-memory messaging between local agents without
 * requiring Chief to relay. Each agent has an inbox that
 * other agents can send messages to.
 *
 * Design decisions (from PRD):
 * - D1: Async messaging. Sender does NOT wait for response.
 * - D2: No persistence. Inbox is in-memory, lost on dispose.
 * - R5: Remote (A2A) agents cannot use direct messaging.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single message between agents */
export interface AgentMessage {
  /** Unique message identifier */
  id: string;
  /** Sender petId */
  from: string;
  /** Receiver petId */
  to: string;
  /** Message type (question, answer, notification, or custom) */
  type: string;
  /** Message content */
  payload: string;
  /** Unix timestamp (ms) when the message was created */
  timestamp: number;
  /** Whether the message has been read by the recipient */
  read: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum inbox size per pet (evicts oldest when exceeded) */
const MAX_INBOX_SIZE = 20;

/** Maximum payload length in characters */
const MAX_PAYLOAD_LENGTH = 4000;

// ---------------------------------------------------------------------------
// AgentChannel
// ---------------------------------------------------------------------------

/**
 * In-memory agent-to-agent messaging channel.
 *
 * Maintains a per-recipient inbox. Messages are evicted from
 * full inboxes on a FIFO basis (oldest first).
 */
export class AgentChannel {
  private inboxes: Map<string, AgentMessage[]> = new Map();
  private messageCounter = 0;

  /**
   * Send a message from one agent to another.
   *
   * @returns The created AgentMessage
   * @throws Error if payload exceeds MAX_PAYLOAD_LENGTH
   */
  send(message: Omit<AgentMessage, 'id' | 'timestamp' | 'read'>): AgentMessage {
    if (message.payload.length > MAX_PAYLOAD_LENGTH) {
      throw new Error(
        `Message payload too large (${message.payload.length} chars). ` +
        `Maximum is ${MAX_PAYLOAD_LENGTH} characters. Use write_blackboard for large data.`
      );
    }

    const full: AgentMessage = {
      ...message,
      id: `msg-${++this.messageCounter}-${Date.now()}`,
      timestamp: Date.now(),
      read: false,
    };

    let inbox = this.inboxes.get(message.to);
    if (!inbox) {
      inbox = [];
      this.inboxes.set(message.to, inbox);
    }

    inbox.push(full);

    // Evict oldest messages if inbox is full
    while (inbox.length > MAX_INBOX_SIZE) {
      inbox.shift();
    }

    return full;
  }

  /**
   * Get all messages in a pet's inbox.
   */
  getInbox(petId: string): AgentMessage[] {
    return this.inboxes.get(petId) ?? [];
  }

  /**
   * Get unread messages in a pet's inbox.
   */
  getUnread(petId: string): AgentMessage[] {
    const inbox = this.inboxes.get(petId);
    if (!inbox) return [];
    return inbox.filter((m) => !m.read);
  }

  /**
   * Get the count of unread messages for a pet.
   */
  getUnreadCount(petId: string): number {
    const inbox = this.inboxes.get(petId);
    if (!inbox) return 0;
    let count = 0;
    for (const m of inbox) {
      if (!m.read) count++;
    }
    return count;
  }

  /**
   * Get the set of unique senders who have unread messages for a pet.
   */
  getUnreadSenders(petId: string): string[] {
    const inbox = this.inboxes.get(petId);
    if (!inbox) return [];
    const senders = new Set<string>();
    for (const m of inbox) {
      if (!m.read) senders.add(m.from);
    }
    return Array.from(senders);
  }

  /**
   * Mark all messages in a pet's inbox as read.
   */
  markAllRead(petId: string): void {
    const inbox = this.inboxes.get(petId);
    if (!inbox) return;
    for (const m of inbox) {
      m.read = true;
    }
  }

  /**
   * Clear all messages from a pet's inbox.
   * Called when a pet is disposed.
   */
  clearInbox(petId: string): void {
    this.inboxes.delete(petId);
  }

  /**
   * Clear all inboxes. Called on shutdown.
   */
  clearAll(): void {
    this.inboxes.clear();
  }
}
