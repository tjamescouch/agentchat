/**
 * Callback Engine
 * Server-side timer queue that parses @@cb:Ns@@payload markers from messages
 * and delivers synthetic messages after a delay.
 *
 * OWL spec: agentchat/owl/callbacks.md
 */

// Configuration from environment
const MAX_DURATION_S = parseInt(process.env.AGENTCHAT_CB_MAX_DURATION_S || '3600', 10);
const MAX_PER_AGENT = parseInt(process.env.AGENTCHAT_CB_MAX_PER_AGENT || '50', 10);
const MAX_PAYLOAD = parseInt(process.env.AGENTCHAT_CB_MAX_PAYLOAD || '500', 10);
const POLL_MS = parseInt(process.env.AGENTCHAT_CB_POLL_MS || '1000', 10);

// Callback marker pattern: @@cb:Ns@@payload or @@cb:Ns#channel@@payload
const CB_PATTERN = /@@cb:(\d+(?:\.\d+)?)s(?:#([a-zA-Z0-9_-]+))?@@([\s\S]*?)(?=@@cb:|$)/g;

export interface CallbackEntry {
  id: string;
  fireAt: number;
  from: string;        // agent ID that created the callback
  target: string;      // where to deliver: agent ID (DM) or #channel
  payload: string;
  createdAt: number;
}

export interface ParseResult {
  cleanContent: string;       // message content with callback markers stripped
  callbacks: CallbackEntry[]; // parsed callbacks to schedule
}

/**
 * Parse callback markers from message content.
 * Returns cleaned content (markers stripped) and any callbacks to schedule.
 */
export function parseCallbacks(content: string, fromAgentId: string): ParseResult {
  const callbacks: CallbackEntry[] = [];
  let hasCallbacks = false;

  // Find all callback markers
  const matches = [...content.matchAll(CB_PATTERN)];

  if (matches.length === 0) {
    return { cleanContent: content, callbacks: [] };
  }

  for (const match of matches) {
    hasCallbacks = true;
    const delaySec = parseFloat(match[1]);
    const channelName = match[2]; // optional #channel target
    const payload = match[3].trim();

    // Clamp duration (don't reject, just clamp per spec)
    const clampedDelay = Math.min(delaySec, MAX_DURATION_S);

    // Enforce payload size
    if (payload.length > MAX_PAYLOAD) {
      continue; // Skip oversized payloads
    }

    const target = channelName ? `#${channelName}` : `@${fromAgentId}`;

    callbacks.push({
      id: `cb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fireAt: Date.now() + (clampedDelay * 1000),
      from: fromAgentId,
      target,
      payload,
      createdAt: Date.now(),
    });
  }

  // Strip all callback markers from the content
  const cleanContent = content.replace(CB_PATTERN, '').trim();

  return { cleanContent, callbacks };
}

/**
 * CallbackQueue - min-heap priority queue keyed by fireAt time.
 * Manages scheduling and delivery of callbacks.
 */
export class CallbackQueue {
  private heap: CallbackEntry[] = [];
  private agentCounts: Map<string, number> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private deliverFn: ((entry: CallbackEntry) => void) | null = null;
  private isAgentConnected: ((agentId: string) => boolean) | null = null;

  /**
   * Start the callback poll loop.
   * @param deliver - function called when a callback fires
   * @param isConnected - function to check if an agent is still connected
   */
  start(
    deliver: (entry: CallbackEntry) => void,
    isConnected: (agentId: string) => boolean
  ): void {
    this.deliverFn = deliver;
    this.isAgentConnected = isConnected;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    this.pollTimer = setInterval(() => this.tick(), POLL_MS);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Enqueue a callback entry.
   * Returns false if the agent has hit their max pending limit.
   */
  enqueue(entry: CallbackEntry): boolean {
    const count = this.agentCounts.get(entry.from) || 0;
    if (count >= MAX_PER_AGENT) {
      return false;
    }

    this.agentCounts.set(entry.from, count + 1);
    this.heapPush(entry);
    return true;
  }

  /**
   * Remove all pending callbacks for a disconnected agent.
   */
  removeAgent(agentId: string): void {
    this.heap = this.heap.filter(e => e.from !== agentId);
    this.agentCounts.delete(agentId);
    this.rebuildHeap();
  }

  /**
   * Get count of pending callbacks for an agent.
   */
  pendingCount(agentId: string): number {
    return this.agentCounts.get(agentId) || 0;
  }

  /**
   * Get total queue size.
   */
  get size(): number {
    return this.heap.length;
  }

  // --- Poll tick ---

  private tick(): void {
    const now = Date.now();

    while (this.heap.length > 0 && this.heap[0].fireAt <= now) {
      const entry = this.heapPop()!;

      // Decrement agent count
      const count = this.agentCounts.get(entry.from) || 1;
      if (count <= 1) {
        this.agentCounts.delete(entry.from);
      } else {
        this.agentCounts.set(entry.from, count - 1);
      }

      // Best-effort delivery: skip if agent disconnected
      if (this.isAgentConnected && !this.isAgentConnected(entry.from)) {
        continue;
      }

      // For channel callbacks, check agent is still in the channel
      // (caller's deliver function should handle this)
      if (this.deliverFn) {
        try {
          this.deliverFn(entry);
        } catch (err) {
          // Log but don't crash the poll loop
          console.error('[callback-engine] delivery error:', err);
        }
      }
    }
  }

  // --- Min-heap operations ---

  private heapPush(entry: CallbackEntry): void {
    this.heap.push(entry);
    this.siftUp(this.heap.length - 1);
  }

  private heapPop(): CallbackEntry | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[i].fireAt < this.heap[parent].fireAt) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;

      if (left < n && this.heap[left].fireAt < this.heap[smallest].fireAt) {
        smallest = left;
      }
      if (right < n && this.heap[right].fireAt < this.heap[smallest].fireAt) {
        smallest = right;
      }

      if (smallest !== i) {
        [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
        i = smallest;
      } else {
        break;
      }
    }
  }

  private rebuildHeap(): void {
    for (let i = (this.heap.length >> 1) - 1; i >= 0; i--) {
      this.siftDown(i);
    }
  }
}
