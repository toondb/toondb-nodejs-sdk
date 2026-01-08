# ToonDB Node.js SDK v0.3.4

**Ultra-thin client for ToonDB server.**  
All business logic runs on the server.

## Architecture: Thick Server / Thin Client

```
┌────────────────────────────────────────────────┐
│         Rust Server (toondb-grpc)              │
├────────────────────────────────────────────────┤
│  • All business logic (Graph, Policy, Search)  │
│  • Vector operations (HNSW)                    │
│  • SQL parsing & execution                     │
│  • Collections & Namespaces                    │
│  • Single source of truth                      │
└────────────────────────────────────────────────┘
                       │ gRPC/IPC
                       ▼
            ┌─────────────────────┐
            │   Node.js SDK       │
            │   (~200 LOC)        │
            ├─────────────────────┤
            │ • Transport layer   │
            │ • Type definitions  │
            │ • Zero logic        │
            └─────────────────────┘
```

### What This SDK Contains

**This SDK is ~1,282 lines of code, consisting of:**
- **Transport Layer** (~900 LOC): gRPC and IPC clients
- **Type Definitions** (~300 LOC): Errors, queries, results
- **Zero business logic**: Everything delegates to server

**This SDK does NOT contain:**
- ❌ No database logic (all server-side)
- ❌ No vector operations (all server-side)
- ❌ No SQL parsing (all server-side)
- ❌ No graph algorithms (all server-side)
- ❌ No policy evaluation (all server-side)

### Why This Design?

**Before (Fat Client - REMOVED):**
```typescript
// ❌ OLD: Business logic duplicated in every language
import { Database, VectorIndex } from '@sushanth/toondb';

const db = await Database.open('./data');  // 694 lines of logic
const index = new VectorIndex(384);        // 434 lines duplicate
await index.insert(id, vector);
```

**After (Thin Client - CURRENT):**
```typescript
// ✅ NEW: All logic on server, SDK just sends requests
import { ToonDBClient } from '@sushanth/toondb';

const client = new ToonDBClient({ address: 'localhost:50051' });
await client.insertVectors('my_index', [id], [vector]);  // → Server handles it
```

**Benefits:**
- 🎯 **Single source of truth**: Fix bugs once in Rust, not 3 times
- 🔧 **3x easier maintenance**: No semantic drift between languages
- 🚀 **Faster development**: Add features once, works everywhere
- 📦 **Smaller SDK size**: 75% code reduction

---

## Installation

```bash
npm install @sushanth/toondb
```

Or with Yarn:
```bash
yarn add @sushanth/toondb
```

---

## Quick Start

### 1. Start ToonDB Server

```bash
# Start the gRPC server
cd toondb
cargo run -p toondb-grpc --release

# Server listens on localhost:50051
```

### 2. Connect from Node.js

```typescript
import { ToonDBClient } from '@sushanth/toondb';

// Connect to server
const client = new ToonDBClient({ address: 'localhost:50051' });

// Create a vector collection
await client.createCollection('documents', { dimension: 384 });

// Add documents with embeddings
const documents = [
  {
    id: 'doc1',
    content: 'Machine learning tutorial',
    embedding: [0.1, 0.2, /* ... 384 dimensions */],
    metadata: { category: 'AI' }
  }
];
await client.addDocuments('documents', documents);

// Search for similar documents
const queryVector = [0.15, 0.25, /* ... 384 dimensions */];
const results = await client.searchCollection('documents', queryVector, 5);

for (const result of results) {
  console.log(`Score: ${result.score}, Content: ${result.content}`);
}
```

---

## API Reference

### ToonDBClient (gRPC Transport)

**Constructor:**
```typescript
const client = new ToonDBClient({
  address?: string;  // Default: 'localhost:50051'
  secure?: boolean;  // Default: false
});
```

**Vector Operations:**
```typescript
// Create vector index
await client.createIndex(
  name: string,
  dimension: number,
  metric?: 'cosine' | 'euclidean' | 'dot'
): Promise<boolean>

// Insert vectors
await client.insertVectors(
  indexName: string,
  ids: number[],
  vectors: number[][]
): Promise<boolean>

// Search vectors
await client.search(
  indexName: string,
  query: number[],
  k?: number
): Promise<SearchResult[]>
```

**Collection Operations:**
```typescript
// Create collection
await client.createCollection(
  name: string,
  options: {
    dimension: number;
    namespace?: string;  // Default: 'default'
  }
): Promise<boolean>

// Add documents
await client.addDocuments(
  collectionName: string,
  documents: Document[],
  namespace?: string
): Promise<string[]>

// Search collection
await client.searchCollection(
  collectionName: string,
  query: number[],
  k?: number,
  options?: {
    namespace?: string;
    filter?: Record<string, string>;
  }
): Promise<Document[]>
```

**Graph Operations:**
```typescript
// Add graph node
await client.addNode(
  nodeId: string,
  nodeType: string,
  properties?: Record<string, string>,
  namespace?: string
): Promise<boolean>

// Add graph edge
await client.addEdge(
  fromId: string,
  edgeType: string,
  toId: string,
  properties?: Record<string, string>,
  namespace?: string
): Promise<boolean>

// Traverse graph
await client.traverse(
  startNode: string,
  options?: {
    maxDepth?: number;      // Default: 3
    edgeTypes?: string[];
    namespace?: string;
  }
): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
}>
```

**Namespace Operations:**
```typescript
// Create namespace
await client.createNamespace(
  name: string,
  metadata?: Record<string, string>
): Promise<boolean>

// List namespaces
await client.listNamespaces(): Promise<string[]>
```

**Key-Value Operations:**
```typescript
// Put key-value
await client.putKv(
  key: string,
  value: Buffer,
  namespace?: string
): Promise<boolean>

// Get value
await client.getKv(
  key: string,
  namespace?: string
): Promise<Buffer | null>

// Batch operations (atomic)
await client.batchPut(
  entries: Array<[Buffer, Buffer]>
): Promise<boolean>
```

**Temporal Graph Operations:**
```typescript
// Add time-bounded edge
await client.addTemporalEdge({
  namespace: string,
  fromId: string,
  edgeType: string,
  toId: string,
  validFrom: number,  // Unix timestamp (ms)
  validUntil?: number, // 0 = no expiry
  properties?: Record<string, string>
}): Promise<boolean>

// Query at specific point in time
const edges = await client.queryTemporalGraph({
  namespace: string,
  nodeId: string,
  mode: 'POINT_IN_TIME' | 'RANGE' | 'CURRENT',
  timestamp?: number,  // For POINT_IN_TIME
  startTime?: number,  // For RANGE
  endTime?: number,    // For RANGE
  edgeTypes?: string[]
}): Promise<TemporalEdge[]>
```

**Format Utilities:**
```typescript
import { 
  WireFormat, 
  ContextFormat, 
  FormatCapabilities 
} from '@sushanth/toondb';

// Parse format from string
const wire = WireFormat.fromString('json');  // WireFormat.JSON

// Convert between formats
const ctx = FormatCapabilities.wireToContext(WireFormat.JSON);
// Returns: ContextFormat.JSON

// Check round-trip support
const supports = FormatCapabilities.supportsRoundTrip(WireFormat.TOON);
// Returns: true
```

### IpcClient (Unix Socket Transport)

For local inter-process communication:

```typescript
import { IpcClient } from '@sushanth/toondb';

// Connect via Unix socket
const client = new IpcClient('/tmp/toondb.sock');

// Same API as ToonDBClient
await client.put(Buffer.from('key'), Buffer.from('value'));
const value = await client.get(Buffer.from('key'));
```

---

## Data Types

### SearchResult
```typescript
interface SearchResult {
  id: number;       // Vector ID
  distance: number; // Similarity distance
}
```

### Document
```typescript
interface Document {
  id: string;                           // Document ID
  content: string;                      // Text content
  embedding: number[];                  // Vector embedding
  metadata: Record<string, string>;     // Metadata
}
```

### GraphNode
```typescript
interface GraphNode {
  id: string;                           // Node ID
  nodeType: string;                     // Node type
  properties: Record<string, string>;   // Properties
}
```

### GraphEdge
```typescript
interface GraphEdge {
  fromId: string;                       // Source node
  edgeType: string;                     // Edge type
  toId: string;                         // Target node
  properties: Record<string, string>;   // Properties
}
```

### TemporalEdge
```typescript
interface TemporalEdge {
  fromId: string;                       // Source node
  edgeType: string;                     // Edge type
  toId: string;                         // Target node
  validFrom: number;                    // Unix timestamp (ms)
  validUntil: number;                   // Unix timestamp (ms), 0 = no expiry
  properties: Record<string, string>;   // Properties
}
```

### WireFormat
```typescript
enum WireFormat {
  TOON = 'toon',        // 40-66% fewer tokens than JSON
  JSON = 'json',        // Standard compatibility
  COLUMNAR = 'columnar' // Analytics optimized
}
```

### ContextFormat
```typescript
enum ContextFormat {
  TOON = 'toon',        // Token-efficient for LLMs
  JSON = 'json',        // Structured data
  MARKDOWN = 'markdown' // Human-readable
}
```

---

## Advanced Features

### Temporal Graph Queries

Temporal graphs allow you to query "What did the system know at time T?"

**Use Case: Agent Memory with Time Travel**
```typescript
import { ToonDBClient } from '@sushanth/toondb';

const client = new ToonDBClient({ address: 'localhost:50051' });

// Record that door was open from 10:00 to 11:00
const now = Date.now();
const oneHour = 60 * 60 * 1000;

await client.addTemporalEdge({
  namespace: 'agent_memory',
  fromId: 'door_1',
  edgeType: 'is_open',
  toId: 'room_5',
  validFrom: now,
  validUntil: now + oneHour
});

// Query: "Was door_1 open 30 minutes ago?"
const thirtyMinAgo = now - (30 * 60 * 1000);
const edges = await client.queryTemporalGraph({
  namespace: 'agent_memory',
  nodeId: 'door_1',
  mode: 'POINT_IN_TIME',
  timestamp: thirtyMinAgo
});

console.log(`Door was open: ${edges.length > 0}`);

// Query: "What changed in the last hour?"
const changes = await client.queryTemporalGraph({
  namespace: 'agent_memory',
  nodeId: 'door_1',
  mode: 'RANGE',
  startTime: now - oneHour,
  endTime: now
});
```

**Query Modes:**
- `POINT_IN_TIME`: Edges valid at specific timestamp
- `RANGE`: Edges overlapping a time range
- `CURRENT`: Edges valid right now

### Atomic Multi-Operation Writes

Ensure all-or-nothing semantics across multiple operations:

```typescript
import { ToonDBClient } from '@sushanth/toondb';

const client = new ToonDBClient({ address: 'localhost:50051' });

// All operations succeed or all fail atomically
await client.batchPut([
  [Buffer.from('user:alice:email'), Buffer.from('alice@example.com')],
  [Buffer.from('user:alice:age'), Buffer.from('30')],
  [Buffer.from('user:alice:created'), Buffer.from('2026-01-07')],
]);

// If server crashes mid-batch, none of the writes persist
```

### Format Conversion for LLM Context

Optimize token usage when sending data to LLMs:

```typescript
import { 
  WireFormat, 
  ContextFormat, 
  FormatCapabilities 
} from '@sushanth/toondb';

// Query results come in WireFormat
const queryFormat = WireFormat.TOON;  // 40-66% fewer tokens than JSON

// Convert to ContextFormat for LLM prompt
const ctxFormat = FormatCapabilities.wireToContext(queryFormat);
// Returns: ContextFormat.TOON

// TOON format example:
// user:alice|email:alice@example.com,age:30
// vs JSON:
// {"user":"alice","email":"alice@example.com","age":30}

// Check if format supports decode(encode(x)) = x
const isLossless = FormatCapabilities.supportsRoundTrip(WireFormat.TOON);
// Returns: true (TOON and JSON are lossless)
```

**Format Benefits:**
- **TOON format**: 40-66% fewer tokens than JSON → Lower LLM API costs
- **Round-trip guarantee**: `decode(encode(x)) = x` for TOON and JSON
- **Columnar format**: Optimized for analytics queries with projections

---

## Error Handling

```typescript
import { ToonDBClient, ToonDBError, ConnectionError } from '@sushanth/toondb';

try {
  const client = new ToonDBClient({ address: 'localhost:50051' });
  await client.createCollection('test', { dimension: 128 });
} catch (error) {
  if (error instanceof ConnectionError) {
    console.error('Cannot connect to server:', error);
  } else if (error instanceof ToonDBError) {
    console.error('ToonDB error:', error);
  }
}
```

**Error Types:**
- `ToonDBError` - Base exception
- `ConnectionError` - Cannot connect to server
- `TransactionError` - Transaction failed
- `ProtocolError` - Protocol mismatch
- `DatabaseError` - Server-side error

---

## Advanced Usage

### Connection with TLS
```typescript
const client = new ToonDBClient({
  address: 'api.example.com:50051',
  secure: true
});
```

### Batch Operations
```typescript
// Insert multiple vectors at once
const ids = Array.from({ length: 1000 }, (_, i) => i);
const vectors = Array.from({ length: 1000 }, () => 
  Array.from({ length: 384 }, () => Math.random())
);
await client.insertVectors('my_index', ids, vectors);
```

### Filtered Search
```typescript
// Search with metadata filtering
const results = await client.searchCollection(
  'documents',
  queryVector,
  10,
  {
    namespace: 'default',
    filter: { category: 'AI', year: '2024' }
  }
);
```

### Async Iteration
```typescript
// Stream large result sets
for await (const doc of client.streamDocuments('large_collection')) {
  console.log(doc);
}
```

---

## TypeScript Support

Full TypeScript support with type definitions included:

```typescript
import type { 
  SearchResult, 
  Document, 
  GraphNode, 
  GraphEdge 
} from '@sushanth/toondb';

const results: SearchResult[] = await client.search('index', query, 10);
```

---

## Performance

**Network Overhead:**
- gRPC: ~100-200 μs per request (local)
- IPC: ~50-100 μs per request (Unix socket)

**Batch Operations:**
- Vector insert: 50,000 vectors/sec (batch mode)
- Vector search: 20,000 queries/sec (47 μs/query)

**Recommendation:**
- Use **batch operations** for high throughput
- Use **IPC** for same-machine communication
- Use **gRPC** for distributed systems

---

## Examples

const db = await Database.open('./data');
await db.put(Buffer.from('key'), Buffer.from('value'));
```

**New Code:**
```typescript
import { ToonDBClient } from '@sushanth/toondb';

const client = new ToonDBClient({ address: 'localhost:50051' });
await client.putKv('key', Buffer.from('value'));
```

**Key Changes:**
1. Replace `Database.open()` → `new ToonDBClient()`
2. Start the gRPC server first
3. All operations now go through client methods
4. No more FFI/native bindings needed

---

## Examples

### Basic Vector Search
```typescript
import { ToonDBClient } from '@sushanth/toondb';

const client = new ToonDBClient({ address: 'localhost:50051' });

// Create index
await client.createIndex('embeddings', 384, 'cosine');

// Insert vectors
const ids = [1, 2, 3];
const vectors = [
  [0.1, 0.2, /* ... */],
  [0.3, 0.4, /* ... */],
  [0.5, 0.6, /* ... */]
];
await client.insertVectors('embeddings', ids, vectors);

// Search
const query = [0.15, 0.25, /* ... */];
const results = await client.search('embeddings', query, 5);
console.log(results);
```

### Graph Operations
```typescript
// Build a knowledge graph
await client.addNode('alice', 'person', { name: 'Alice' });
await client.addNode('bob', 'person', { name: 'Bob' });
await client.addNode('project', 'repository', { name: 'ToonDB' });

await client.addEdge('alice', 'KNOWS', 'bob');
await client.addEdge('alice', 'CONTRIBUTES_TO', 'project');

// Traverse from Alice
const { nodes, edges } = await client.traverse('alice', { maxDepth: 2 });
console.log('Connected nodes:', nodes);
console.log('Relationships:', edges);
```

---

## FAQ

**Q: Why remove the embedded Database class?**  
A: To eliminate duplicate business logic. Having SQL parsers, vector indexes, and graph algorithms in every language creates 3x maintenance burden and semantic drift.

**Q: What if I need offline/embedded mode?**  
A: Use the IPC client with a local server process. The server can run on the same machine with Unix socket communication (50 μs latency).

**Q: Is this slower than the old FFI-based approach?**  
A: Network overhead is ~100-200 μs. For batch operations (1000+ vectors), the throughput is identical. The server's Rust implementation is 15x faster than alternatives.

**Q: Can I use this in the browser?**  
A: Not directly. Use a backend service that connects to ToonDB and exposes a REST API to the browser.

---

## Getting Help

- **Documentation**: https://toondb.dev
- **GitHub Issues**: https://github.com/sushanthpy/toondb/issues
- **Examples**: See source code for examples

---

## Contributing

Interested in contributing? See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development environment setup
- Building from source
- Running tests
- Code style guidelines
- Pull request process

---

## License

Apache License 2.0
