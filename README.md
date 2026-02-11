# SochDB Node.js SDK

**LLM-Optimized Embedded Database with Native Vector Search**

---

## Installation

```bash
npm install @sochdb/sochdb
```

Or from source:
```bash
cd sochdb-typescript-sdk
npm install
```

---

## Architecture: Flexible Deployment

**Tri-mode architecture: Embedded + Concurrent + Server (gRPC/IPC)**  
Choose the deployment mode that fits your needs.

---

# SochDB Node.js SDK Documentation

> **Version 0.5.2** — LLM-Optimized Embedded Database with Native Vector Search

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Features](#features)
   - [Memory System](#memory-system---llm-native-memory-for-ai-agents)
   - [Semantic Cache](#semantic-cache---llm-response-caching)
   - [Context Query Builder](#context-query-builder---token-aware-llm-context)
   - [Namespace API](#namespace-api---multi-tenant-isolation)
   - [Priority Queue API](#priority-queue-api---task-processing)
3. [Architecture](#architecture-flexible-deployment)
4. [System Requirements](#system-requirements)
5. [Troubleshooting](#troubleshooting)
6. [Vector Search (Native HNSW)](#-vector-search---native-hnsw)
7. [API Reference](#api-reference)
   - [Core Key-Value Operations](#core-key-value-operations)
   - [Transactions (ACID with SSI)](#transactions-acid-with-ssi)
   - [Prefix Scanning](#prefix-scanning)
   - [Namespaces & Collections](#namespaces--collections)
   - [Priority Queues](#priority-queues)
   - [Graph Operations](#graph-operations)
   - [Semantic Cache](#semantic-cache)
   - [Context Query Builder](#context-query-builder)
   - [Memory System (LLM-Native)](#memory-system-llm-native)
   - [Data Formats (TOON/JSON/Columnar)](#data-formats-toonjsoncolumnar)
   - [Policy Service & MCP](#policy-service--mcp)
   - [Server Mode (IPC / gRPC)](#server-mode-ipc--grpc)
   - [Checkpoints & Statistics](#checkpoints--statistics)
   - [Error Handling](#error-handling)
   - [Configuration Reference](#configuration-reference)
   - [Performance](#performance)

---

## 1. Quick Start

### Concurrent Embedded Mode

For web applications with multiple Node.js processes (PM2 cluster, multiple workers):

```typescript
import { EmbeddedDatabase } from '@sochdb/sochdb';
import express from 'express';

// Open in concurrent mode - multiple processes can access simultaneously
const db = EmbeddedDatabase.openConcurrent('./web_db');

const app = express();

app.get('/user/:id', async (req, res) => {
  // Multiple concurrent requests can read simultaneously (~100ns)
  const data = await db.get(Buffer.from(`user:${req.params.id}`));
  if (!data) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.send(data);
});

app.post('/user/:id', async (req, res) => {
  // Writes are automatically coordinated (~60µs amortized)
  await db.put(Buffer.from(`user:${req.params.id}`), req.body);
  res.json({ status: 'ok' });
});

// Check concurrent mode status
console.log(`Concurrent mode: ${db.isConcurrent}`);  // true

// Start with PM2 cluster mode (multiple workers can access DB)
// pm2 start app.js -i max
app.listen(3000);
```

### Performance

| Operation | Standard Mode | Concurrent Mode |
|-----------|---------------|-----------------|
| Read (single process) | ~100ns | ~100ns |
| Read (multi-process) | **Blocked** ❌ | ~100ns ✅ |
| Write | ~5ms (fsync) | ~60µs (amortized) |
| Max concurrent readers | 1 | 1024 |

### PM2 Cluster Example

```bash
# Install PM2
npm install -g pm2

# Start with automatic worker scaling
pm2 start server.js -i max

# All workers can access the same database concurrently!
pm2 logs
```

### PM2 Ecosystem File

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'api-server',
    script: './server.js',
    instances: 'max',  // Scale across all CPU cores
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      DB_PATH: './shared_db'  // All workers use same DB
    }
  }]
};
```

```bash
# Deploy with ecosystem file
pm2 start ecosystem.config.js

# Monitor all workers
pm2 monit
```

### Docker Compose with PM2

```yaml
version: '3.8'
services:
  app:
    build: .
    environment:
      - NODE_ENV=production
      - INSTANCES=4  # 4 PM2 workers
    volumes:
      - ./data:/app/data  # Shared database volume
    ports:
      - "3000:3000"
    command: pm2-runtime start ecosystem.config.js
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sochdb-app
spec:
  replicas: 4  # 4 pods share the database
  template:
    spec:
      containers:
      - name: app
        image: myapp:latest
        volumeMounts:
        - name: db-storage
          mountPath: /app/data
      volumes:
      - name: db-storage
        persistentVolumeClaim:
          claimName: sochdb-pvc  # Shared PVC with ReadWriteMany
```

---

## Features

### Memory System - LLM-Native Memory for AI Agents
Complete memory system with extraction, consolidation, and hybrid retrieval:

```typescript
import {
  EmbeddedDatabase,
  ExtractionPipeline,
  Consolidator,
  HybridRetriever,
  AllowedSet,
} from '@sochdb/sochdb';

const db = await EmbeddedDatabase.open('./memory_db');

// Extract entities and relations from text
const pipeline = ExtractionPipeline.fromDatabase(db, 'user_123', {
  entityTypes: ['person', 'organization', 'location'],
  minConfidence: 0.7,
});

const result = await pipeline.extractAndCommit(
  'Alice works at Acme Corp',
  myLLMExtractor  // Your LLM integration
);
console.log(`Extracted ${result.entities.length} entities`);

// Consolidate facts with event sourcing
const consolidator = Consolidator.fromDatabase(db, 'user_123');
await consolidator.add({
  fact: { subject: 'Alice', predicate: 'lives_in', object: 'SF' },
  source: 'conversation_1',
  confidence: 0.9,
});

const updated = await consolidator.consolidate();
const facts = await consolidator.getCanonicalFacts();

// Hybrid retrieval with RRF fusion
const retriever = HybridRetriever.fromDatabase(db, 'user_123', 'documents');
await retriever.indexDocuments(docs);

const results = await retriever.retrieve(
  'machine learning papers',
  queryEmbedding,
  AllowedSet.fromNamespace('user_123')
);
```

**[→ See Full Example](./examples/memory-system-example.ts)**

**Key Features:**
- ✅ Extraction Pipeline: Compile LLM outputs into typed facts
- ✅ Event-Sourced Consolidation: Append-only with temporal updates
- ✅ Hybrid Retrieval: RRF fusion of vector + keyword search
- ✅ Namespace Isolation: Multi-tenant security with pre-filtering
- ✅ Schema Validation: Type checking and confidence thresholds

### Semantic Cache - LLM Response Caching
Vector similarity-based caching for LLM responses to reduce costs and latency:

```typescript
import { EmbeddedDatabase, SemanticCache } from '@sochdb/sochdb';

const db = await EmbeddedDatabase.open('./mydb');
const cache = new SemanticCache(db, 'llm_responses');

// Store LLM response with embedding
await cache.put(
  'What is machine learning?',
  'Machine learning is a subset of AI...',
  embedding,  // 384-dim vector
  3600,       // TTL in seconds
  { model: 'gpt-4', tokens: 150 }
);

// Check cache before calling LLM
const hit = await cache.get(queryEmbedding, 0.85);
if (hit) {
  console.log(`Cache HIT! Similarity: ${hit.score.toFixed(4)}`);
  console.log(`Response: ${hit.value}`);
}

// Get statistics
const stats = await cache.stats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
```

**[→ See Full Example](./examples/semantic-cache-example.ts)**

**Key Benefits:**
- ✅ Cosine similarity matching (0-1 threshold)
- ✅ TTL-based expiration
- ✅ Hit/miss statistics tracking
- ✅ Memory usage monitoring
- ✅ Automatic expired entry purging

### Context Query Builder - Token-Aware LLM Context
Assemble LLM context with priority-based truncation and token budgeting:

```typescript
import { ContextQueryBuilder, ContextOutputFormat, TruncationStrategy } from '@sochdb/sochdb';

const builder = new ContextQueryBuilder()
  .withBudget(4096)  // Token limit
  .setFormat(ContextOutputFormat.TOON)
  .setTruncation(TruncationStrategy.TAIL_DROP);

builder
  .literal('SYSTEM', 0, 'You are a helpful AI assistant.')
  .literal('USER_PROFILE', 1, 'User: Alice, Role: Engineer')
  .literal('HISTORY', 2, 'Recent conversation context...')
  .literal('KNOWLEDGE', 3, 'Retrieved documents...');

const result = builder.execute();
console.log(`Tokens: ${result.tokenCount}/${4096}`);
console.log(`Context:\n${result.text}`);
```

**[→ See Full Example](./examples/context-builder-example.ts)**

**Key Benefits:**
- ✅ Priority-based section ordering (lower = higher priority)
- ✅ Token budget enforcement
- ✅ Multiple truncation strategies (tail drop, head drop, proportional)
- ✅ Multiple output formats (TOON, JSON, Markdown)
- ✅ Token count estimation

### Namespace API - Multi-Tenant Isolation
First-class namespace handles for secure multi-tenancy and data isolation:

```typescript
import { Database, Namespace, Collection, DistanceMetric } from '@sochdb/sochdb';

const db = await Database.open('./mydb');

// Create isolated namespace for each tenant
const namespace = new Namespace(db, 'tenant_acme', {
  name: 'tenant_acme',
  displayName: 'ACME Corporation',
  labels: { plan: 'enterprise', region: 'us-west' }
});

// Create vector collection
const collection = await namespace.createCollection({
  name: 'documents',
  dimension: 384,
  metric: DistanceMetric.Cosine,
  indexed: true
});

// Insert and search vectors
await collection.insert([1.0, 2.0, ...], { title: 'Doc 1' });
const results = await collection.search({ queryVector: [...], k: 10 });
```

**[→ See Full Example](./examples/namespace-example.ts)**

### Priority Queue API - Task Processing
Efficient priority queue with ordered-key storage (no O(N) blob rewrites):

```typescript
import { Database, PriorityQueue } from '@sochdb/sochdb';

const db = await Database.open('./queue_db');
const queue = PriorityQueue.fromDatabase(db, 'tasks');

// Enqueue with priority (lower = higher urgency)
await queue.enqueue(1, Buffer.from('urgent task'), { type: 'payment' });

// Worker processes tasks
const task = await queue.dequeue('worker-1');
if (task) {
  // Process task...
  await queue.ack(task.taskId);
}

// Get statistics
const stats = await queue.stats();
console.log(`Pending: ${stats.pending}, Completed: ${stats.completed}`);
```

**[→ See Full Example](./examples/queue-example.ts)**

**Key Benefits:**
- ✅ O(log N) enqueue/dequeue with ordered scans
- ✅ Atomic claim protocol for concurrent workers
- ✅ Visibility timeout for crash recovery
- ✅ Dead letter queue for failed tasks
- ✅ Multiple queues per database

---

## Architecture: Flexible Deployment

```
┌─────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT OPTIONS                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. EMBEDDED MODE (FFI)          2. SERVER MODE (gRPC)      │
│  ┌─────────────────────┐         ┌─────────────────────┐   │
│  │   Node.js App        │         │   Node.js App        │   │
│  │   ├─ Database.open()│         │   ├─ SochDBClient() │   │
│  │   └─ Direct FFI     │         │   └─ gRPC calls     │   │
│  │         │           │         │         │           │   │
│  │         ▼           │         │         ▼           │   │
│  │   libsochdb_storage │         │   sochdb-grpc       │   │
│  │   (Rust native)     │         │   (Rust server)     │   │
│  └─────────────────────┘         └─────────────────────┘   │
│                                                               │
│  ✅ No server needed               ✅ Multi-language          │
│  ✅ Local files                    ✅ Centralized logic      │
│  ✅ Simple deployment              ✅ Production scale       │
└─────────────────────────────────────────────────────────────┘
```

### When to Use Each Mode

**Embedded Mode (FFI):**
- ✅ Local development and testing
- ✅ Jupyter notebooks and data science
- ✅ Single-process applications
- ✅ Edge deployments without network
- ✅ No server setup required

**Server Mode (gRPC):**
- ✅ Production deployments
- ✅ Multi-language teams (Python, Node.js, Go)
- ✅ Distributed systems
- ✅ Centralized business logic
- ✅ Horizontal scaling

---

---

## System Requirements

### For Concurrent Mode

- **SochDB Core**: Latest version
- **Node.js**: 14.0+ (18.0+ recommended)
- **Native Library**: `libsochdb_storage.{dylib,so}`
- **FFI**: Koffi (automatically installed)

**Operating Systems:**
- ✅ Linux (Ubuntu 20.04+, RHEL 8+)
- ✅ macOS (10.15+, both Intel and Apple Silicon)
- ⚠️  Windows (requires native builds)

**File Descriptors:**
- Default limit: 1024 (sufficient for most workloads)
- For high concurrency with PM2: `ulimit -n 4096`

**Memory:**
- Standard mode: ~50MB base + data
- Concurrent mode: +4KB per concurrent reader slot (1024 slots = ~4MB overhead)
- PM2 cluster: Each worker has independent memory

---

## Troubleshooting

### "Database is locked" Error (Standard Mode)

```
Error: SQLITE_BUSY: database is locked
```

**Solution**: Use concurrent mode for multi-process access:

```typescript
// ❌ Standard mode - PM2 cluster will fail
const db = new EmbeddedDatabase('./data.db');

// ✅ Concurrent mode - PM2 cluster works!
const db = EmbeddedDatabase.openConcurrent('./data.db');
```

### Library Not Found Error

```
Error: Dynamic library 'libsochdb_storage.dylib' not found
```

**macOS**:
```bash
# Build and install library
cd /path/to/sochdb
cargo build --release
sudo cp target/release/libsochdb_storage.dylib /usr/local/lib/
```

**Linux**:
```bash
cd /path/to/sochdb
cargo build --release
sudo cp target/release/libsochdb_storage.so /usr/local/lib/
sudo ldconfig
```

**Development Mode** (no install):
```bash
export DYLD_LIBRARY_PATH=/path/to/sochdb/target/release  # macOS
export LD_LIBRARY_PATH=/path/to/sochdb/target/release    # Linux
```

### PM2 Cluster Issues

**Symptom**: Workers crash with "database locked"

**Solution**: Ensure concurrent mode is used:
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'api',
    script: './server.js',
    instances: 4,
    exec_mode: 'cluster',
    env: {
      USE_CONCURRENT_MODE: 'true'  // Flag to use openConcurrent()
    }
  }]
};
```

```typescript
// server.ts
const db = process.env.USE_CONCURRENT_MODE 
  ? EmbeddedDatabase.openConcurrent('./db')
  : new EmbeddedDatabase('./db');

console.log('Concurrent mode:', db.isConcurrent);  // Should be true
```

### Docker Volume Permissions

**Symptom**: `EACCES: permission denied` when opening database

**Solution**: Fix volume ownership:
```dockerfile
FROM node:18
WORKDIR /app

# Create data directory with correct permissions
RUN mkdir -p /app/data && chown -R node:node /app

# Switch to non-root user
USER node

COPY --chown=node:node . .
RUN npm install

CMD ["npm", "start"]
```

### Performance Issues

**Symptom**: Concurrent reads slower than expected

**Check 1** - Verify concurrent mode:
```typescript
if (!db.isConcurrent) {
    console.error('Database is not in concurrent mode!');
    process.exit(1);
}
```

**Check 2** - Monitor PM2 workers:
```bash
pm2 monit  # Real-time monitoring
pm2 logs --lines 200  # Check for errors
```

**Check 3** - Batch writes:
```typescript
// ❌ Slow - individual writes
for (const item of items) {
    await collection.insert(item);
}

// ✅ Fast - batch write
await collection.insertBatch(items);
```

---

## 🆕 Vector Search - Native HNSW

SochDB now includes **native HNSW (Hierarchical Navigable Small World)** vector search for sub-millisecond similarity search across millions of vectors.

### Quick Start - Vector Search

```typescript
import { HnswIndex } from '@sochdb/sochdb';

// Create HNSW index
const index = new HnswIndex({
  dimension: 384,           // Vector dimension
  maxConnections: 16,       // M parameter (default: 16)
  efConstruction: 200,      // Build quality (default: 200)
  efSearch: 100             // Search quality (default: 100)
});

// Insert vectors (batch is 10-100× faster)
index.insertBatch(
  ['doc1', 'doc2', 'doc3'],
  [[1.0, 2.0, ...], [3.0, 4.0, ...], [5.0, 6.0, ...]]
);

// Search for similar vectors
const results = index.search(queryVector, 10);
console.log(results);
// [{ id: 'doc1', distance: 0.15 }, { id: 'doc3', distance: 0.23 }, ...]

// Clean up
index.close();
```

### Performance Comparison

| Implementation | 10K vectors | 100K vectors | 1M vectors |
|----------------|-------------|--------------|------------|
| **Linear Scan (old)** | ~50ms | ~500ms | ~5000ms |
| **Native HNSW (new)** | <0.5ms | <1ms | <1ms |
| **Speedup** | **100×** | **500×** | **5000×** |

### Two Ways to Use Vector Search

#### 1. Direct HNSW API (Recommended for Production)

Best performance, full control:

```typescript
import { HnswIndex } from '@sochdb/sochdb';

const index = new HnswIndex({ dimension: 1536 });
index.insertBatch(ids, embeddings);
const results = index.search(queryEmbedding, 10);
```

**✅ Use when:**
- You need maximum performance
- Working with large datasets (>10K vectors)
- Building RAG/AI applications
- Have existing embedding pipeline

#### 2. Collection API (Simple, High-Level)

Convenient API with metadata support:

```typescript
import { Database } from '@sochdb/sochdb';

const db = await Database.open('./mydb');
const ns = await db.createNamespace({ name: 'docs' });

const collection = await ns.createCollection({
  name: 'embeddings',
  dimension: 384,
  indexed: true  // Note: Currently uses linear search in embedded mode
});

await collection.insert([1.0, 2.0, ...], { title: 'Document 1' }, 'doc1');
const results = await collection.search({ queryVector: [...], k: 10 });
```

**⚠️ Current Limitation:** Collection API uses O(n) linear search in embedded mode. For production use with >10K vectors, use:
- Direct HNSW API (above), OR
- gRPC Server Mode (see below)

#### 3. gRPC Server Mode (Production-Ready)

For distributed systems, multi-language support:

```typescript
import { SochDBClient } from '@sochdb/sochdb';

// Start server: sochdb-grpc --port 50051
const client = new SochDBClient({ address: 'localhost:50051' });

// Create HNSW index
await client.createIndex('docs', {
  dimension: 1536,
  config: { m: 16, ef_construction: 200 },
  metric: 'cosine'
});

// Insert and search
await client.insertBatch('docs', ids, vectors);
const results = await client.search('docs', queryVector, 10);
```

**✅ Full HNSW support with:**
- Native Rust implementation
- Persistence
- Distributed queries
- Multi-language clients

### Migration from Linear Search

If you're using the Collection API with large datasets and experiencing slow search:

**Before (slow):**
```typescript
// O(n) scan through all documents
const results = await collection.search({ queryVector, k: 10 });
```

**After (fast) - Option 1: Use HnswIndex directly:**
```typescript
import { HnswIndex } from '@sochdb/sochdb';

const index = new HnswIndex({ dimension: 384 });
index.insertBatch(ids, vectors);
const results = index.search(queryVector, 10); // <1ms
```

**After (fast) - Option 2: Use gRPC mode:**
```bash
# Terminal 1: Start server
sochdb-grpc --port 50051

# Terminal 2: Use client
```
```typescript
const client = new SochDBClient({ address: 'localhost:50051' });
await client.createIndex('docs', { dimension: 384 });
const results = await client.search('docs', queryVector, 10);
```

### Complete Examples

- **[06_native_vector_search.ts](https://github.com/sochdb/sochdb-nodejs-examples/blob/main/06_native_vector_search.ts)** - Direct HNSW usage with benchmarks
- **[AI PDF Chatbot](https://github.com/sochdb/sochdb-nodejs-examples/tree/main/ai-pdf-chatbot-langchain)** - LangChain RAG example

### API Reference

```typescript
// HnswIndex Configuration
interface HnswConfig {
  dimension: number;           // Required: vector dimension
  maxConnections?: number;     // M parameter (default: 16)
  efConstruction?: number;     // Build quality (default: 200)
  efSearch?: number;           // Search quality (default: 100)
}

// Search Result
interface SearchResult {
  id: string;                  // Vector ID
  distance: number;            // Distance (lower = more similar)
}

// Main Methods
class HnswIndex {
  constructor(config: HnswConfig)
  insert(id: string, vector: number[]): void
  insertBatch(ids: string[], vectors: number[][]): void
  search(queryVector: number[], k: number, fast?: boolean): SearchResult[]
  searchUltra(queryVector: number[], k: number): SearchResult[]
  close(): void
  
  // Properties
  get length(): number         // Number of vectors
  get dimension(): number      // Vector dimension
  get efSearch(): number
  set efSearch(value: number)  // Adjust search quality
}
```

### Engine Status

| Component | Status |
|-----------|--------|
| **Cost-based optimizer** | ✅ Production-ready — full cost model, cardinality estimation, plan caching |
| **Adaptive group commit** | ✅ Implemented — Little's Law-based batch sizing |
| **WAL compaction** | ⚠️ Partial — manual `checkpoint()` + `truncateWal()` available |
| **HNSW vector index** | ✅ Production-ready — direct FFI bindings |

### Roadmap

- **Current**: Direct HNSW FFI bindings with production cost-based optimizer
- **Next**: Collection API auto-uses HNSW in embedded mode
- **Future**: Persistent HNSW indexes with disk storage

---

---

## API Reference

> **Version 0.5.2** — Complete API documentation with TypeScript examples.

All core logic runs in the Rust engine via FFI. The SDK is a thin client.

---

### Core Key-Value Operations

```typescript
import { EmbeddedDatabase } from '@sochdb/sochdb';

const db = EmbeddedDatabase.open('./mydb');

// Put / Get / Delete
await db.put(Buffer.from('user:1'), Buffer.from('{"name":"Alice"}'));
const value = await db.get(Buffer.from('user:1'));
console.log(value?.toString()); // {"name":"Alice"}
await db.delete(Buffer.from('user:1'));

// Path-based keys (hierarchical)
await db.putPath('/users/alice/profile', Buffer.from('{"age":30}'));
const profile = await db.getPath('/users/alice/profile');

db.close();
```

---

### Transactions (ACID with SSI)

SochDB uses Serializable Snapshot Isolation for full ACID transactions:

```typescript
const db = EmbeddedDatabase.open('./mydb');

// Auto-managed transaction
await db.withTransaction(async (txn) => {
  await txn.put(Buffer.from('key1'), Buffer.from('val1'));
  await txn.put(Buffer.from('key2'), Buffer.from('val2'));
  const v = await txn.get(Buffer.from('key1'));
  // Auto-commits on success, auto-aborts on throw
});

// Manual transaction control
const txn = db.transaction();
try {
  await txn.put(Buffer.from('balance:alice'), Buffer.from('100'));
  await txn.put(Buffer.from('balance:bob'), Buffer.from('200'));
  await txn.commit(); // Single atomic fsync
} catch (err) {
  await txn.abort();
  throw err;
}
```

---

### Prefix Scanning

```typescript
const db = EmbeddedDatabase.open('./mydb');

// Insert test data
await db.put(Buffer.from('user:1'), Buffer.from('Alice'));
await db.put(Buffer.from('user:2'), Buffer.from('Bob'));
await db.put(Buffer.from('user:3'), Buffer.from('Charlie'));

// Scan all keys with prefix
for await (const [key, value] of db.scanPrefix(Buffer.from('user:'))) {
  console.log(`${key.toString()} = ${value.toString()}`);
}

// Transaction-scoped scan
const txn = db.transaction();
for await (const [k, v] of txn.scanPrefix(Buffer.from('order:'))) {
  console.log(`${k.toString()} = ${v.toString()}`);
}
await txn.commit();
```

---

### Namespaces & Collections

Multi-tenant isolation with vector-enabled collections:

```typescript
import { EmbeddedDatabase } from '@sochdb/sochdb';

const db = EmbeddedDatabase.open('./mydb');

// Create or get a namespace
const ns = await db.getOrCreateNamespace('tenant_1', {
  displayName: 'Tenant One',
  labels: { tier: 'premium' },
});

// Create a collection with vector search
const docs = await ns.createCollection({
  name: 'documents',
  dimension: 384,
  metric: 'cosine',
  indexed: true,
  hnswM: 16,
  hnswEfConstruction: 100,
});

// Insert vectors with metadata
const id = await docs.insert(
  [0.1, 0.2, 0.3 /* ...384 dims */],
  { title: 'Introduction to AI', author: 'Alice' },
);

// Batch insert
const ids = await docs.insertMany(
  [[0.1, 0.2 /* ... */], [0.3, 0.4 /* ... */]],
  [{ title: 'Doc 1' }, { title: 'Doc 2' }],
);

// Search with optional filter
const results = await docs.search({
  queryVector: [0.1, 0.2, 0.3 /* ...384 dims */],
  k: 5,
  filter: { author: 'Alice' },
  includeMetadata: true,
});
results.forEach(r => console.log(`${r.id}: score=${r.score.toFixed(4)}`));

// Collection management
const count = await docs.count();
const collections = await ns.listCollections(); // ['documents']
await ns.deleteCollection('documents');

// Namespace management
const namespaces = await db.listNamespaces();
await db.deleteNamespace('tenant_1');
```

---

### Priority Queues

Ordered task queues with priority-based dequeue, ack/nack, and dead-letter support:

```typescript
import { createQueue, EmbeddedDatabase } from '@sochdb/sochdb';

const db = EmbeddedDatabase.open('./mydb');

// Create a queue
const queue = createQueue(db, 'background-jobs', {
  visibilityTimeout: 30,
  maxRetries: 3,
  deadLetterQueue: 'failed-jobs',
});

// Enqueue tasks (lower priority = higher urgency)
const taskId = await queue.enqueue(
  1,
  Buffer.from(JSON.stringify({ action: 'send_email', to: 'alice@example.com' })),
  { source: 'api', retryable: true },
);

await queue.enqueue(10, Buffer.from('low priority'));
await queue.enqueue(1, Buffer.from('high priority'));

// Dequeue highest priority task
const task = await queue.dequeue('worker-1');
if (task) {
  console.log(`Processing: ${task.taskId}`);
  console.log(`Priority: ${task.priority}, State: ${task.state}`);

  try {
    // Process task...
    await queue.ack(task.taskId);  // Mark completed
  } catch (err) {
    await queue.nack(task.taskId); // Re-queue for retry
  }
}

// Queue statistics
const stats = await queue.stats();
console.log(`Pending: ${stats.pending}, Claimed: ${stats.claimed}`);

// Purge completed/dead-lettered tasks
const purged = await queue.purge();
```

---

### Graph Operations

Graph overlay stored as key-value pairs in the Rust engine:

```typescript
const db = EmbeddedDatabase.open('./mydb');

// Add nodes
await db.addNode('social', 'alice', 'person', { name: 'Alice', role: 'engineer' });
await db.addNode('social', 'bob', 'person', { name: 'Bob', role: 'designer' });
await db.addNode('social', 'acme', 'company', { name: 'Acme Corp' });

// Add edges
await db.addEdge('social', 'alice', 'works_at', 'acme');
await db.addEdge('social', 'bob', 'works_at', 'acme');
await db.addEdge('social', 'alice', 'knows', 'bob');

// Graph traversal (BFS or DFS)
const result = await db.traverse('social', 'alice', 2, 'bfs');
console.log(`Nodes: ${result.nodes.length}, Edges: ${result.edges.length}`);
```

---

### Semantic Cache

Cache LLM responses with vector-similarity retrieval:

```typescript
import { SemanticCache, EmbeddedDatabase } from '@sochdb/sochdb';

const db = EmbeddedDatabase.open('./cache_db');
const cache = new SemanticCache(db, 'llm_responses');

// Store response with embedding
await cache.put(
  'What is machine learning?',
  'Machine learning is a subset of AI...',
  [0.1, 0.2, 0.3 /* ... */],  // embedding vector
  3600,  // TTL seconds
  { model: 'gpt-4', tokens: 42 },
);

// Check cache before calling LLM
const hit = await cache.get(queryEmbedding, 0.85);
if (hit) {
  console.log(`Cache HIT (score: ${hit.score.toFixed(4)})`);
  console.log(`Response: ${hit.value}`);
}

// Cache management
const stats = await cache.stats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
await cache.purgeExpired();
await cache.clear();
```

Convenience methods on `EmbeddedDatabase`:

```typescript
await db.cachePut('my_cache', 'key', 'value', [0.1, 0.2 /* ... */], 3600);
const val = await db.cacheGet('my_cache', [0.1, 0.2 /* ... */], 0.85);
await db.cacheDelete('my_cache', 'key');
await db.cacheClear('my_cache');
```

---

### Context Query Builder

Token-budget-aware context assembly for LLM prompts:

```typescript
import { createContextBuilder, ContextOutputFormat, TruncationStrategy } from '@sochdb/sochdb';

const result = createContextBuilder()
  .forSession('session_123')
  .withBudget(4096)
  .setFormat(ContextOutputFormat.MARKDOWN)
  .setTruncation(TruncationStrategy.PROPORTIONAL)
  .literal('system', 100, 'You are a helpful assistant.')
  .literal('user_query', 90, 'Tell me about SochDB')
  .section('context')
  .execute();

console.log(`Tokens used: ${result.tokenCount}`);
console.log(result.text);
```

---

### Memory System (LLM-Native)

Complete memory for AI agents — extraction, consolidation, hybrid retrieval:

```typescript
import {
  EmbeddedDatabase, ExtractionPipeline, Consolidator, HybridRetriever, AllowedSet,
} from '@sochdb/sochdb';

const db = EmbeddedDatabase.open('./memory_db');

// 1. Extract entities and relations
const pipeline = ExtractionPipeline.fromDatabase(db, 'user_123', {
  entityTypes: ['person', 'organization', 'location'],
  minConfidence: 0.7,
});
const extracted = await pipeline.extractAndCommit(
  'Alice joined Acme Corp in San Francisco.',
  async (text) => ({
    entities: [
      { name: 'Alice', entity_type: 'person', confidence: 0.95 },
      { name: 'Acme Corp', entity_type: 'organization', confidence: 0.9 },
    ],
    relations: [
      { from_entity: 'Alice', relation_type: 'works_at', to_entity: 'Acme Corp' },
    ],
  }),
);

// 2. Consolidate facts
const consolidator = Consolidator.fromDatabase(db, 'user_123');
await consolidator.add({
  fact: { subject: 'Alice', predicate: 'lives_in', object: 'SF' },
  source: 'conversation_1',
  confidence: 0.9,
});
await consolidator.consolidate();
const facts = await consolidator.getCanonicalFacts();

// 3. Hybrid retrieval (vector + BM25 with RRF fusion)
const retriever = HybridRetriever.fromDatabase(db, 'user_123', 'documents');
await retriever.indexDocuments([
  { id: 'doc1', content: 'Alice is a software engineer', embedding: [0.1, 0.2 /* ... */] },
]);
const results = await retriever.retrieve('Who is Alice?', [0.1, 0.2 /* ... */], AllowedSet.allowAll(), 5);
```

---

### Data Formats (TOON/JSON/Columnar)

```typescript
// TOON format — compact, LLM-optimized
const toon = EmbeddedDatabase.toToon('users', [
  { id: 1, name: 'Alice', role: 'engineer' },
  { id: 2, name: 'Bob', role: 'designer' },
]);
// [users]
// id|name|role
// 1|Alice|engineer
// 2|Bob|designer

// JSON round-trip
const json = EmbeddedDatabase.toJson('users', [{ id: 1, name: 'Alice' }]);
const parsed = EmbeddedDatabase.fromJson(json);
```

---

### Policy Service & MCP

```typescript
import { PolicyService, McpServer } from '@sochdb/sochdb';

// Access control
const policy = new PolicyService(db);
policy.addRule({
  name: 'Allow Write for Admins',
  resource: '*', action: 'write', effect: 'allow',
  condition: (ctx) => ctx.role === 'admin',
});
const allowed = policy.evaluate({ role: 'admin' }, 'documents', 'write');

// MCP — expose DB tools to AI agents
const server = new McpServer(db, { name: 'my-db', version: '1.0.0' });
server.registerDefaultTools();
await server.start();
```

---

### Server Mode (IPC / gRPC)

```typescript
import { IpcClient, SochDBClient } from '@sochdb/sochdb';

// IPC Client (Unix socket)
const ipc = new IpcClient('/tmp/sochdb.sock');
await ipc.connect();
await ipc.put(Buffer.from('key'), Buffer.from('value'));
const val = await ipc.get(Buffer.from('key'));
await ipc.addNode('ns', 'alice', 'person', { name: 'Alice' });
ipc.close();

// gRPC Client
const grpc = new SochDBClient('localhost:50051');
await grpc.createIndex('embeddings', 384, 'cosine');
await grpc.insertVectors('embeddings', [1, 2], [[0.1, 0.2 /* ... */], [0.3, 0.4 /* ... */]]);
const searchResults = await grpc.search('embeddings', [0.1, 0.2 /* ... */], 5);
grpc.close();
```

---

### Checkpoints & Statistics

```typescript
const db = EmbeddedDatabase.open('./mydb');

const lsn = await db.checkpoint();
console.log(`Checkpoint LSN: ${lsn}`);

const stats = await db.stats();
console.log(`Memtable: ${stats.memtableSizeBytes} bytes`);
console.log(`WAL: ${stats.walSizeBytes} bytes`);
console.log(`Active txns: ${stats.activeTransactions}`);
```

---

### Error Handling

```typescript
import {
  SochDBError, TransactionError, DatabaseLockedError,
  NamespaceNotFoundError, CollectionExistsError,
} from '@sochdb/sochdb';

try {
  await db.withTransaction(async (txn) => {
    await txn.put(Buffer.from('key'), Buffer.from('value'));
  });
} catch (err) {
  if (err instanceof DatabaseLockedError) {
    console.error('Database locked by another process');
  } else if (err instanceof TransactionError) {
    console.error('Transaction conflict (SSI) — retry');
  } else if (err instanceof NamespaceNotFoundError) {
    console.error('Namespace does not exist');
  }
}
```

---

### Configuration Reference

```typescript
const db = EmbeddedDatabase.open('./mydb', {
  walEnabled: true,
  syncMode: 'full',       // 'full' | 'normal' | 'off'
  memtableSizeBytes: 64 * 1024 * 1024,
  groupCommit: true,
  indexPolicy: 'balanced', // 'write_optimized' | 'balanced' | 'scan_optimized' | 'append_only'
});
```

| Environment Variable | Description |
|---------------------|-------------|
| `SOCHDB_LIB_PATH` | Custom path to native library |
| `SOCHDB_LOG_LEVEL` | Log level (DEBUG, INFO, WARN, ERROR) |

---

### Performance

| Operation | Latency |
|-----------|---------|
| KV Read | ~100ns |
| KV Write (fsync) | ~5ms |
| KV Write (concurrent, amortized) | ~60µs |
| Vector Search (HNSW, 1M vectors) | <5ms |
| Prefix Scan (per item) | ~200ns |
| Max Concurrent Readers | 1024 |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, building from source, and pull request guidelines.

---

## License

Apache License 2.0
