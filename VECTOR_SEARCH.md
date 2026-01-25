# Vector Search in SochDB Node.js SDK

## Overview

SochDB supports efficient vector similarity search using HNSW (Hierarchical Navigable Small World) indexing. This document explains how to use vector search in both modes.

## Two Modes

### 1. Embedded Mode (Limited Vector Support)

**Current State**: The embedded mode Collection API provides a convenient interface but **does not yet have native HNSW bindings**. It uses linear search (O(n) scan with cosine similarity).

```typescript
import { Database } from '@sochdb/sochdb';

const db = await Database.open('./mydb');
const ns = await db.createNamespace({ name: 'docs' });

// Collection API - convenient but uses linear search
const collection = await ns.createCollection({
  name: 'embeddings',
  dimension: 384,
  indexed: true  // Currently ignored in embedded mode
});

// Insert works fine
await collection.insert([1.0, 2.0, ...], { text: 'hello' }, 'doc1');

// Search uses O(n) linear scan (slow for >10K vectors)
const results = await collection.search({
  queryVector: [1.0, 2.0, ...],
  k: 5
});
```

**Performance**: Linear search is acceptable for <10,000 vectors but doesn't scale.

**Workaround for Production**: Use gRPC mode for native HNSW (see below).

### 2. gRPC/Server Mode (Full HNSW Support) ✅

**Recommended for production** - Native HNSW with sub-millisecond search:

```typescript
import { SochDBClient } from '@sochdb/sochdb';

// Connect to sochdb-grpc server
const client = new SochDBClient({ address: 'localhost:50051' });

// Create HNSW index
await client.createIndex('docs', {
  dimension: 1536,
  config: {
    m: 16,              // Connections per node
    ef_construction: 200 // Build quality
  },
  metric: 'cosine'
});

// Batch insert
await client.insertBatch('docs', [id1, id2, ...], vectors);

// Native HNSW search - O(log n)
const results = await client.search('docs', queryVector, 10);
```

**Performance**: 
- Insert: ~100K vectors/sec (batched)
- Search: <1ms for 1M vectors
- Scales to billions of vectors

## FFI Bindings (Advanced)

For advanced users, direct FFI bindings to HNSW are available:

```typescript
import { HnswIndex } from '@sochdb/sochdb';

// Create HNSW index directly
const index = new HnswIndex({
  dimension: 384,
  maxConnections: 16,
  efConstruction: 200
});

// Insert vectors
index.insert('doc1', [1.0, 2.0, ...]);
index.insertBatch(ids, vectors); // Much faster

// Search
const results = index.search(queryVector, 10);
console.log(results); // [{ id: 'doc1', distance: 0.15 }, ...]

// Clean up
index.close();
```

**Note**: These are low-level bindings. The Collection API will integrate them in a future release.

## Roadmap

- [ ] **v0.4.3**: Integrate HNSW FFI into Collection API (embedded mode)
- [ ] **v0.4.4**: Persistence for HNSW indexes
- [ ] **v0.5.0**: Metadata filtering in HNSW search

## Migration Guide

### From Linear Search to HNSW

If you're using the Collection API and need better performance:

**Option 1**: Switch to gRPC mode (production-ready now)

**Option 2**: Wait for v0.4.3 with native HNSW in Collections

**Option 3**: Use FFI bindings directly (advanced)

## Benchmarks

| Mode | Dataset Size | Search Latency | Throughput |
|------|--------------|----------------|------------|
| Embedded Linear | 10K vectors | ~50ms | 20 QPS |
| Embedded Linear | 100K vectors | ~500ms | 2 QPS |
| gRPC HNSW | 10K vectors | <0.5ms | 2000 QPS |
| gRPC HNSW | 1M vectors | <1ms | 1000 QPS |
| gRPC HNSW | 10M vectors | ~2ms | 500 QPS |

## Examples

See:
- [06_native_vector_search.ts](../sochdb-nodejs-examples/06_native_vector_search.ts) - Collection API example
- [ai-pdf-chatbot-langchain/](../sochdb-nodejs-examples/ai-pdf-chatbot-langchain/) - RAG example

## Support

For questions or issues:
- GitHub Issues: https://github.com/sushanthpy/sochdb/issues
- Discord: https://discord.gg/sochdb
