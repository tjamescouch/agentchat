/**
 * HNSW - Hierarchical Navigable Small World
 * Pure TypeScript, zero deps, base64 binary serialization.
 *
 * Based on: Malkov & Yashunin, "Efficient and robust approximate nearest
 * neighbor search using Hierarchical Navigable Small World graphs" (2018)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HNSWConfig {
  /** Vector dimensionality */
  dim: number;
  /** Max connections per node per layer (default: 16) */
  M: number;
  /** Max connections for layer 0 (default: 2*M) */
  M0: number;
  /** Size of dynamic candidate list during construction (default: 200) */
  efConstruction: number;
  /** Normalization factor for level generation: 1/ln(M) */
  mL: number;
}

export interface HNSWNode {
  id: number;
  vector: Float32Array;
  level: number;
  /** neighbors[layer] = array of neighbor node ids */
  neighbors: number[][];
  /** Optional metadata attached to the node */
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  id: number;
  distance: number;
  metadata?: Record<string, unknown>;
}

// ─── Distance Functions ──────────────────────────────────────────────────────

/** Cosine distance = 1 - cosine_similarity. Range [0, 2]. */
export function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

/** Euclidean (L2) distance squared — skip sqrt for perf since we only compare. */
export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

export type DistanceFunction = (a: Float32Array, b: Float32Array) => number;

// ─── Priority Queue (min-heap) ───────────────────────────────────────────────

interface HeapItem {
  id: number;
  distance: number;
}

class MinHeap {
  private data: HeapItem[] = [];

  get size(): number { return this.data.length; }

  push(item: HeapItem): void {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): HeapItem | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  peek(): HeapItem | undefined { return this.data[0]; }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[i].distance >= this.data[parent].distance) break;
      [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
      i = parent;
    }
  }

  private sinkDown(i: number): void {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.data[left].distance < this.data[smallest].distance) smallest = left;
      if (right < n && this.data[right].distance < this.data[smallest].distance) smallest = right;
      if (smallest === i) break;
      [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
      i = smallest;
    }
  }

  toArray(): HeapItem[] { return [...this.data].sort((a, b) => a.distance - b.distance); }
}

class MaxHeap {
  private data: HeapItem[] = [];

  get size(): number { return this.data.length; }

  push(item: HeapItem): void {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): HeapItem | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  peek(): HeapItem | undefined { return this.data[0]; }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[i].distance <= this.data[parent].distance) break;
      [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
      i = parent;
    }
  }

  private sinkDown(i: number): void {
    const n = this.data.length;
    while (true) {
      let largest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.data[left].distance > this.data[largest].distance) largest = left;
      if (right < n && this.data[right].distance > this.data[largest].distance) largest = right;
      if (largest === i) break;
      [this.data[i], this.data[largest]] = [this.data[largest], this.data[i]];
      i = largest;
    }
  }

  toArray(): HeapItem[] { return [...this.data].sort((a, b) => a.distance - b.distance); }
}

// ─── HNSW Index ──────────────────────────────────────────────────────────────

export class HNSW {
  private config: HNSWConfig;
  private nodes: Map<number, HNSWNode> = new Map();
  private entryPointId: number = -1;
  private maxLevel: number = -1;
  private nextId: number = 0;
  private distanceFn: DistanceFunction;

  /** Optional callback fired after every insert — use for write-through persistence. */
  public onInsert?: (index: HNSW) => void;

  constructor(
    dim: number,
    opts: Partial<Pick<HNSWConfig, 'M' | 'efConstruction'>> & { distance?: DistanceFunction } = {}
  ) {
    const M = opts.M ?? 16;
    this.config = {
      dim,
      M,
      M0: 2 * M,
      efConstruction: opts.efConstruction ?? 200,
      mL: 1 / Math.log(M),
    };
    this.distanceFn = opts.distance ?? cosineDistance;
  }

  get size(): number { return this.nodes.size; }
  get dimensions(): number { return this.config.dim; }

  // ─── Random Level ────────────────────────────────────────────────────────

  private randomLevel(): number {
    let level = 0;
    while (Math.random() < (1 / this.config.M) && level < 32) level++;
    return level;
  }

  // ─── Search Layer ────────────────────────────────────────────────────────

  /** Greedy search on a single layer. Returns ef closest nodes. */
  private searchLayer(
    query: Float32Array,
    entryId: number,
    ef: number,
    layer: number
  ): HeapItem[] {
    const visited = new Set<number>();
    const candidates = new MinHeap();
    const results = new MaxHeap();

    const entryNode = this.nodes.get(entryId)!;
    const dist = this.distanceFn(query, entryNode.vector);

    candidates.push({ id: entryId, distance: dist });
    results.push({ id: entryId, distance: dist });
    visited.add(entryId);

    while (candidates.size > 0) {
      const current = candidates.pop()!;
      const farthestResult = results.peek()!;

      if (current.distance > farthestResult.distance) break;

      const currentNode = this.nodes.get(current.id)!;
      const neighbors = currentNode.neighbors[layer] ?? [];

      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const neighborNode = this.nodes.get(neighborId)!;
        const d = this.distanceFn(query, neighborNode.vector);
        const farthest = results.peek()!;

        if (d < farthest.distance || results.size < ef) {
          candidates.push({ id: neighborId, distance: d });
          results.push({ id: neighborId, distance: d });
          if (results.size > ef) results.pop();
        }
      }
    }

    return results.toArray();
  }

  // ─── Select Neighbors (simple heuristic) ─────────────────────────────────

  private selectNeighbors(candidates: HeapItem[], maxConn: number): HeapItem[] {
    return candidates
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxConn);
  }

  // ─── Insert ──────────────────────────────────────────────────────────────

  insert(vector: number[] | Float32Array, metadata?: Record<string, unknown>): number {
    const vec = vector instanceof Float32Array ? vector : new Float32Array(vector);
    if (vec.length !== this.config.dim) {
      throw new Error(`Expected ${this.config.dim}-d vector, got ${vec.length}-d`);
    }

    const id = this.nextId++;
    const level = this.randomLevel();
    const node: HNSWNode = {
      id,
      vector: vec,
      level,
      neighbors: Array.from({ length: level + 1 }, () => []),
      metadata,
    };

    this.nodes.set(id, node);

    // First node — just set as entry
    if (this.entryPointId === -1) {
      this.entryPointId = id;
      this.maxLevel = level;
      this.onInsert?.(this);
      return id;
    }

    let currentId = this.entryPointId;

    // Phase 1: Greedy descent from top to node's level + 1
    for (let l = this.maxLevel; l > level; l--) {
      const results = this.searchLayer(vec, currentId, 1, l);
      currentId = results[0].id;
    }

    // Phase 2: Insert at each layer from min(level, maxLevel) down to 0
    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const candidates = this.searchLayer(vec, currentId, this.config.efConstruction, l);
      const maxConn = l === 0 ? this.config.M0 : this.config.M;
      const neighbors = this.selectNeighbors(candidates, maxConn);

      // Connect new node to selected neighbors
      node.neighbors[l] = neighbors.map(n => n.id);

      // Connect neighbors back to new node, pruning if necessary
      for (const neighbor of neighbors) {
        const neighborNode = this.nodes.get(neighbor.id)!;
        if (!neighborNode.neighbors[l]) neighborNode.neighbors[l] = [];
        neighborNode.neighbors[l].push(id);

        if (neighborNode.neighbors[l].length > maxConn) {
          // Prune: keep only the closest maxConn neighbors
          const scored = neighborNode.neighbors[l].map(nId => ({
            id: nId,
            distance: this.distanceFn(neighborNode.vector, this.nodes.get(nId)!.vector),
          }));
          neighborNode.neighbors[l] = this.selectNeighbors(scored, maxConn).map(s => s.id);
        }
      }

      if (candidates.length > 0) currentId = candidates[0].id;
    }

    // Update entry point if new node has higher level
    if (level > this.maxLevel) {
      this.entryPointId = id;
      this.maxLevel = level;
    }

    this.onInsert?.(this);
    return id;
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  search(query: number[] | Float32Array, k: number = 10, efSearch?: number): SearchResult[] {
    if (this.nodes.size === 0) return [];

    const q = query instanceof Float32Array ? query : new Float32Array(query);
    const ef = Math.max(k, efSearch ?? k);
    let currentId = this.entryPointId;

    // Greedy descent from top layer to layer 1
    for (let l = this.maxLevel; l > 0; l--) {
      const results = this.searchLayer(q, currentId, 1, l);
      currentId = results[0].id;
    }

    // Search layer 0 with ef
    const candidates = this.searchLayer(q, currentId, ef, 0);

    return candidates.slice(0, k).map(c => {
      const node = this.nodes.get(c.id)!;
      return {
        id: c.id,
        distance: c.distance,
        metadata: node.metadata,
      };
    });
  }

  // ─── Get Node ────────────────────────────────────────────────────────────

  getNode(id: number): HNSWNode | undefined {
    return this.nodes.get(id);
  }

  // ─── Binary Serialization ────────────────────────────────────────────────

  /**
   * Binary layout:
   * [Header: 24 bytes]
   *   magic (4 bytes): "HNSW"
   *   version (4 bytes): 1
   *   dim (4 bytes)
   *   nodeCount (4 bytes)
   *   entryPointId (4 bytes, signed)
   *   maxLevel (4 bytes, signed)
   *
   * [Config: 16 bytes]
   *   M (4 bytes)
   *   M0 (4 bytes)
   *   efConstruction (4 bytes)
   *   nextId (4 bytes)
   *
   * [Nodes: variable]
   *   For each node:
   *     id (4 bytes)
   *     level (4 bytes)
   *     metadataLength (4 bytes) — byte length of JSON metadata string
   *     metadata (metadataLength bytes) — UTF-8 JSON
   *     vector (dim * 4 bytes) — float32
   *     For each layer 0..level:
   *       neighborCount (4 bytes)
   *       neighborIds (neighborCount * 4 bytes)
   */
  serialize(): string {
    // Calculate total size
    let totalSize = 24 + 16; // header + config
    const encoder = new TextEncoder();
    const metadataBuffers: Map<number, Uint8Array> = new Map();

    for (const [id, node] of this.nodes) {
      const metaStr = node.metadata ? JSON.stringify(node.metadata) : '';
      const metaBuf = encoder.encode(metaStr);
      metadataBuffers.set(id, metaBuf);

      totalSize += 4 + 4 + 4; // id + level + metadataLength
      totalSize += metaBuf.length; // metadata
      totalSize += this.config.dim * 4; // vector
      for (let l = 0; l <= node.level; l++) {
        totalSize += 4; // neighborCount
        totalSize += (node.neighbors[l]?.length ?? 0) * 4; // neighborIds
      }
    }

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let offset = 0;

    // Header
    bytes[offset++] = 0x48; // H
    bytes[offset++] = 0x4E; // N
    bytes[offset++] = 0x53; // S
    bytes[offset++] = 0x57; // W
    view.setInt32(offset, 1, true); offset += 4; // version
    view.setInt32(offset, this.config.dim, true); offset += 4;
    view.setInt32(offset, this.nodes.size, true); offset += 4;
    view.setInt32(offset, this.entryPointId, true); offset += 4;
    view.setInt32(offset, this.maxLevel, true); offset += 4;

    // Config
    view.setInt32(offset, this.config.M, true); offset += 4;
    view.setInt32(offset, this.config.M0, true); offset += 4;
    view.setInt32(offset, this.config.efConstruction, true); offset += 4;
    view.setInt32(offset, this.nextId, true); offset += 4;

    // Nodes
    for (const [id, node] of this.nodes) {
      view.setInt32(offset, node.id, true); offset += 4;
      view.setInt32(offset, node.level, true); offset += 4;

      const metaBuf = metadataBuffers.get(id)!;
      view.setInt32(offset, metaBuf.length, true); offset += 4;
      bytes.set(metaBuf, offset); offset += metaBuf.length;

      // Vector
      for (let i = 0; i < this.config.dim; i++) {
        view.setFloat32(offset, node.vector[i], true); offset += 4;
      }

      // Neighbors per layer
      for (let l = 0; l <= node.level; l++) {
        const neighbors = node.neighbors[l] ?? [];
        view.setInt32(offset, neighbors.length, true); offset += 4;
        for (const nId of neighbors) {
          view.setInt32(offset, nId, true); offset += 4;
        }
      }
    }

    // Base64 encode
    return bufferToBase64(bytes);
  }

  static deserialize(base64: string, distance?: DistanceFunction): HNSW {
    const bytes = base64ToBuffer(base64);
    const buffer = bytes.buffer;
    const view = new DataView(buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;

    // Header
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    offset += 4;
    if (magic !== 'HNSW') throw new Error(`Invalid magic: ${magic}`);

    const version = view.getInt32(offset, true); offset += 4;
    if (version !== 1) throw new Error(`Unsupported version: ${version}`);

    const dim = view.getInt32(offset, true); offset += 4;
    const nodeCount = view.getInt32(offset, true); offset += 4;
    const entryPointId = view.getInt32(offset, true); offset += 4;
    const maxLevel = view.getInt32(offset, true); offset += 4;

    // Config
    const M = view.getInt32(offset, true); offset += 4;
    const M0 = view.getInt32(offset, true); offset += 4;
    const efConstruction = view.getInt32(offset, true); offset += 4;
    const nextId = view.getInt32(offset, true); offset += 4;

    const index = new HNSW(dim, { M, efConstruction, distance });
    index.config.M0 = M0;
    index.entryPointId = entryPointId;
    index.maxLevel = maxLevel;
    index.nextId = nextId;

    const decoder = new TextDecoder();

    // Nodes
    for (let n = 0; n < nodeCount; n++) {
      const id = view.getInt32(offset, true); offset += 4;
      const level = view.getInt32(offset, true); offset += 4;

      const metaLen = view.getInt32(offset, true); offset += 4;
      let metadata: Record<string, unknown> | undefined;
      if (metaLen > 0) {
        const metaStr = decoder.decode(bytes.slice(offset, offset + metaLen));
        metadata = JSON.parse(metaStr);
      }
      offset += metaLen;

      // Vector
      const vector = new Float32Array(dim);
      for (let i = 0; i < dim; i++) {
        vector[i] = view.getFloat32(offset, true); offset += 4;
      }

      // Neighbors
      const neighbors: number[][] = [];
      for (let l = 0; l <= level; l++) {
        const count = view.getInt32(offset, true); offset += 4;
        const layerNeighbors: number[] = [];
        for (let j = 0; j < count; j++) {
          layerNeighbors.push(view.getInt32(offset, true)); offset += 4;
        }
        neighbors.push(layerNeighbors);
      }

      index.nodes.set(id, { id, vector, level, neighbors, metadata });
    }

    return index;
  }
}

// ─── Base64 helpers (Node.js compatible) ─────────────────────────────────────

function bufferToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  // Browser fallback
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  // Browser fallback
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─── Default export ──────────────────────────────────────────────────────────

export default HNSW;
