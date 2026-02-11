/**
 * HNSW tests — run with: npx tsx hnsw.test.ts
 */

import { HNSW, cosineDistance, euclideanDistance } from './hnsw';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function assertApprox(a: number, b: number, eps: number, msg: string): void {
  assert(Math.abs(a - b) < eps, `${msg} (got ${a}, expected ~${b})`);
}

// ─── Distance functions ──────────────────────────────────────────────────────

console.log('\n--- Distance Functions ---');

const v1 = new Float32Array([1, 0, 0]);
const v2 = new Float32Array([0, 1, 0]);
const v3 = new Float32Array([1, 0, 0]);

assertApprox(cosineDistance(v1, v3), 0, 0.001, 'cosine: identical vectors = 0');
assertApprox(cosineDistance(v1, v2), 1, 0.001, 'cosine: orthogonal vectors = 1');
assert(euclideanDistance(v1, v3) === 0, 'euclidean: identical vectors = 0');
assertApprox(euclideanDistance(v1, v2), 2, 0.001, 'euclidean: orthogonal unit vectors = 2');

// ─── Basic insert and search ─────────────────────────────────────────────────

console.log('\n--- Basic Insert & Search ---');

const index = new HNSW(3, { M: 4, efConstruction: 50 });

assert(index.size === 0, 'empty index has size 0');

index.insert([1, 0, 0], { label: 'x-axis' });
index.insert([0, 1, 0], { label: 'y-axis' });
index.insert([0, 0, 1], { label: 'z-axis' });
index.insert([1, 1, 0], { label: 'xy-diag' });
index.insert([1, 0, 1], { label: 'xz-diag' });

assert(index.size === 5, 'index has 5 nodes after inserts');

const results = index.search([1, 0, 0], 3);
assert(results.length === 3, 'search returns 3 results');
assert(results[0].metadata?.label === 'x-axis', 'nearest to [1,0,0] is x-axis');
assert(results[0].distance < 0.01, 'nearest distance is ~0');

// ─── Larger random dataset ───────────────────────────────────────────────────

console.log('\n--- Larger Dataset (100 vectors, 32-d) ---');

const dim = 32;
const n = 100;
const bigIndex = new HNSW(dim, { M: 16, efConstruction: 100 });

const vectors: Float32Array[] = [];
for (let i = 0; i < n; i++) {
  const v = new Float32Array(dim);
  for (let j = 0; j < dim; j++) v[j] = Math.random() * 2 - 1;
  vectors.push(v);
  bigIndex.insert(v, { idx: i });
}

assert(bigIndex.size === n, `big index has ${n} nodes`);

// Verify recall: for a random query, brute force should agree with HNSW
const query = new Float32Array(dim);
for (let j = 0; j < dim; j++) query[j] = Math.random() * 2 - 1;

// Brute force top-5
const bruteForce = vectors
  .map((v, i) => ({ id: i, distance: cosineDistance(query, v) }))
  .sort((a, b) => a.distance - b.distance)
  .slice(0, 5);

const hnswResults = bigIndex.search(query, 5, 50);

// Check that HNSW found the true nearest neighbor (recall@1)
const trueNearest = bruteForce[0].id;
const hnswNearest = hnswResults[0].id;
assert(trueNearest === hnswNearest, `recall@1: HNSW found true nearest (id=${trueNearest})`);

// Check recall@5 — at least 3 of top-5 should overlap
const bruteTop5 = new Set(bruteForce.map(r => r.id));
const hnswTop5 = new Set(hnswResults.map(r => r.id));
let overlap = 0;
for (const id of hnswTop5) if (bruteTop5.has(id)) overlap++;
assert(overlap >= 3, `recall@5: ${overlap}/5 overlap with brute force (need >= 3)`);

// ─── Serialization roundtrip ─────────────────────────────────────────────────

console.log('\n--- Serialization ---');

const serialized = bigIndex.serialize();
assert(typeof serialized === 'string', 'serialize returns a string');
assert(serialized.length > 0, 'serialized string is non-empty');
console.log(`  (serialized size: ${serialized.length} chars, ~${Math.round(serialized.length * 0.75)} bytes)`);

const restored = HNSW.deserialize(serialized);
assert(restored.size === n, `deserialized index has ${n} nodes`);
assert(restored.dimensions === dim, `deserialized index has dim=${dim}`);

// Search the restored index with the same query
const restoredResults = restored.search(query, 5, 50);
assert(restoredResults[0].id === hnswResults[0].id, 'restored index returns same nearest neighbor');
assert(
  restoredResults[0].metadata?.idx === hnswResults[0].metadata?.idx,
  'metadata survives serialization roundtrip'
);

// ─── Write-through callback ──────────────────────────────────────────────────

console.log('\n--- Write-through Callback ---');

let callbackCount = 0;
const persistIndex = new HNSW(3);
persistIndex.onInsert = () => { callbackCount++; };

persistIndex.insert([1, 0, 0]);
persistIndex.insert([0, 1, 0]);
persistIndex.insert([0, 0, 1]);

assert(callbackCount === 3, `onInsert called ${callbackCount} times (expected 3)`);

// ─── Euclidean distance mode ─────────────────────────────────────────────────

console.log('\n--- Euclidean Distance ---');

const eucIndex = new HNSW(2, { M: 4, distance: euclideanDistance });
eucIndex.insert([0, 0], { label: 'origin' });
eucIndex.insert([1, 0], { label: 'right' });
eucIndex.insert([10, 10], { label: 'far' });

const eucResults = eucIndex.search([0.1, 0], 2);
assert(eucResults[0].metadata?.label === 'origin', 'euclidean: nearest to [0.1,0] is origin');
assert(eucResults[1].metadata?.label === 'right', 'euclidean: second nearest is right');

// ─── Edge cases ──────────────────────────────────────────────────────────────

console.log('\n--- Edge Cases ---');

const emptyIndex = new HNSW(3);
assert(emptyIndex.search([1, 0, 0]).length === 0, 'search on empty index returns []');

const singleIndex = new HNSW(2);
singleIndex.insert([1, 1]);
const singleResult = singleIndex.search([0, 0], 5);
assert(singleResult.length === 1, 'search with k>size returns all nodes');

// Dimension mismatch
let threw = false;
try { new HNSW(3).insert([1, 2]); } catch { threw = true; }
assert(threw, 'insert with wrong dimensions throws');

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) process.exit(1);
