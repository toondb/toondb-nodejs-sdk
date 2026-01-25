# SochDB Node.js SDK v0.4.2 - Vector Search Update

## What Changed

Added **native HNSW FFI bindings** to the Node.js SDK for high-performance vector similarity search.

## What This Means

### ✅ Now Available: Direct HNSW Access

```typescript
import { HnswIndex } from '@sochdb/sochdb';

const index = new HnswIndex({ dimension: 384, maxConnections: 16, efConstruction: 200 });
index.insertBatch(ids, vectors);
const results = index.search(queryVector, 10);
```

**Performance**: Sub-millisecond search for millions of vectors using native Rust HNSW implementation.

### ⚠️ Collection API Status

The Collection API exists but **does NOT yet use HNSW** in embedded mode:

```typescript
// This API works but uses O(n) linear search currently:
const collection = await ns.createCollection({ name: 'docs', dimension: 384 });
await collection.insert(vector, metadata);
const results = await collection.search({ queryVector, k: 10 });
```

**Current**: O(n) scan with JavaScript cosine similarity  
**Future (v0.4.3)**: Will use native HNSW automatically

### ✅ Production Solution: Use gRPC Mode

For production workloads, use SochDB in **server mode** which has full HNSW support:

```typescript
import { SochDBClient } from '@sochdb/sochdb';

const client = new SochDBClient({ address: 'localhost:50051' });
await client.createIndex('docs', { dimension: 1536 });
await client.insertBatch('docs', ids, vectors);
const results = await client.search('docs', queryVector, 10);
```

This uses native HNSW and is production-ready.

## Quick Start

### 1. Install

```bash
npm install @sochdb/sochdb
```

### 2. Choose Your Mode

**For Development** (simple, no server):
```typescript
import { Database, HnswIndex } from '@sochdb/sochdb';

const db = await Database.open('./mydb');
const index = new HnswIndex({ dimension: 384 });
// Use index directly for vector search
```

**For Production** (scalable, distributed):
```bash
# Start server
sochdb-grpc --port 50051
```

```typescript
import { SochDBClient } from '@sochdb/sochdb';

const client = new SochDBClient({ address: 'localhost:50051' });
// Full HNSW vector search available
```

## Examples

- **Basic Vector Search**: [06_native_vector_search.ts](../sochdb-nodejs-examples/06_native_vector_search.ts)
- **AI PDF Chatbot**: [ai-pdf-chatbot-langchain/](../sochdb-nodejs-examples/ai-pdf-chatbot-langchain/)

## API Reference

See [VECTOR_SEARCH.md](./VECTOR_SEARCH.md) for complete documentation.

## Roadmap

- **v0.4.2** (current): FFI bindings for HNSW
- **v0.4.3** (next): Collection API uses HNSW automatically
- **v0.5.0**: Persistent HNSW indexes

## Why Two Approaches?

- **HnswIndex** (low-level): Direct FFI bindings, full control, minimal overhead
- **Collection API** (high-level): LangChain-compatible, metadata support, persistence
- **gRPC Client**: Enterprise-ready, distributed, battle-tested

Choose based on your needs:
- Prototyping → HnswIndex
- RAG/AI apps → Collection API (when v0.4.3 releases)
- Production → gRPC mode

## Migration

If you're using the AI PDF chatbot example:

**Current** (works but slow for >10K docs):
```typescript
// Uses O(n) linear search
const vectorStore = new SochDBVectorStore({ dbPath, namespace, embeddings });
```

**Recommended Now**:
```typescript
// Option 1: Use gRPC mode
const client = new SochDBClient({ address: 'localhost:50051' });

// Option 2: Use vectorstore-hnsw.ts (new file)
// This will be merged into main vectorstore once Collection API is updated
```

## Questions?

See [VECTOR_SEARCH.md](./VECTOR_SEARCH.md) or open an issue!
