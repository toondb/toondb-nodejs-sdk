# Contributing to ToonDB Node.js SDK

Thank you for your interest in contributing to the ToonDB Node.js SDK! This guide provides all the information you need to build, test, and contribute to the project.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Building from Source](#building-from-source)
- [Running Tests](#running-tests)
- [Server Setup for Development](#server-setup-for-development)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Architecture Overview](#architecture-overview)
- [Migration Guide](#migration-guide)

---

## Development Setup

### Prerequisites

- Node.js 18+ or Bun 1.0+
- TypeScript 5.0+
- Rust toolchain (for building server)
- Protocol Buffers compiler (protoc)
- Git

### Clone and Install

```bash
# Clone the repository
git clone https://github.com/toondb/toondb-nodejs-sdk.git
cd toondb-nodejs-sdk

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test
```

### With Bun

```bash
# Install with Bun
bun install

# Build
bun run build

# Test
bun test
```

---

## Building from Source

### TypeScript Compilation

```bash
# Compile TypeScript to JavaScript
npm run build

# Watch mode for development
npm run build:watch
```

### With Protocol Buffers

If you need to regenerate gRPC stubs:

```bash
# Install protoc-gen-ts
npm install -g protoc-gen-ts

# Generate from proto files
cd toondb/proto
protoc --ts_out=. --grpc_out=. *.proto
```

---

## Running Tests

### Unit Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- grpc-client.test.ts
```

### Integration Tests

```bash
# Start ToonDB server first
cd toondb
cargo run -p toondb-grpc

# In another terminal, run integration tests
cd toondb-nodejs-sdk
npm run test:integration
```

### Type Checking

```bash
# Run TypeScript type checker
npm run typecheck

# Watch mode
npm run typecheck:watch
```

---

## Server Setup for Development

### Starting the Server

```bash
# Development mode
cd toondb
cargo run -p toondb-grpc

# Production mode (optimized)
cargo build --release -p toondb-grpc
./target/release/toondb-grpc --host 0.0.0.0 --port 50051
```

### Server Configuration

The server runs all business logic including:
- ✅ HNSW vector indexing (15x faster than ChromaDB)
- ✅ SQL query parsing and execution
- ✅ Graph traversal algorithms
- ✅ Policy evaluation
- ✅ Multi-tenant namespace isolation
- ✅ Collection management

### Configuration File

Create `toondb-server-config.toml`:

```toml
[server]
host = "0.0.0.0"
port = 50051

[storage]
data_dir = "./data"

[logging]
level = "info"
```

---

## Code Style

### TypeScript

We follow TypeScript best practices:

```bash
# Format code
npm run format

# Lint
npm run lint

# Fix lint issues
npm run lint:fix
```

### ESLint Configuration

```json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "no-console": "warn",
    "@typescript-eslint/explicit-function-return-type": "error"
  }
}
```

### Commit Messages

Follow conventional commits:

```
feat: Add temporal graph support
fix: Handle connection timeout
docs: Update API reference
test: Add integration tests for graphs
```

### Code Review Checklist

- [ ] All tests pass
- [ ] Code follows TypeScript style guidelines
- [ ] Documentation updated (TSDoc)
- [ ] Examples added/updated if needed
- [ ] No breaking changes (or documented in CHANGELOG)
- [ ] Type definitions exported correctly

---

## Pull Request Process

1. **Fork and Clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/toondb-nodejs-sdk.git
   cd toondb-nodejs-sdk
   ```

2. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make Changes**
   - Write code
   - Add tests
   - Update documentation

4. **Test Locally**
   ```bash
   npm test
   npm run lint
   npm run typecheck
   ```

5. **Commit and Push**
   ```bash
   git add .
   git commit -m "feat: Your feature description"
   git push origin feature/your-feature-name
   ```

6. **Create Pull Request**
   - Go to GitHub
   - Create PR from your branch
   - Fill out PR template
   - Wait for review

---

## Architecture Overview

### Thin Client Architecture

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
            │   (~1,282 LOC)      │
            ├─────────────────────┤
            │ • Transport layer   │
            │ • Type definitions  │
            │ • Zero logic        │
            └─────────────────────┘
```

### Key Components

**grpc-client.ts**
- ToonDBClient class for gRPC
- All server operations
- Connection management
- Error handling

**format.ts** (188 lines)
- WireFormat enum (TOON, JSON, Columnar)
- ContextFormat enum (TOON, JSON, Markdown)
- FormatCapabilities utilities

**types.ts**
- TypeScript type definitions
- SearchResult, Document, GraphNode, GraphEdge
- Request/response interfaces

### Comparison with Old Architecture

| Feature | Old (Fat Client) | New (Thin Client) |
|---------|------------------|-------------------|
| SDK Size | 5,038 LOC | 1,282 LOC (-75%) |
| Business Logic | In SDK (TypeScript) | In Server (Rust) |
| Bug Fixes | Per language | Once in server |
| Semantic Drift | High risk | Zero risk |
| Performance | FFI overhead | Network call |
| Maintenance | 3x effort | 1x effort |

---

## Migration Guide

### From v0.3.3 to v0.3.4

**Key Changes:**
- Removed embedded `Database` class
- All operations now go through `ToonDBClient`
- Server must be running for all operations
- FFI bindings removed

**Old Code:**
```typescript
import { Database } from '@sushanth/toondb';

const db = await Database.open('./data');
await db.put(Buffer.from('key'), Buffer.from('value'));
await db.close();
```

**New Code:**
```typescript
import { ToonDBClient } from '@sushanth/toondb';

// Start server first: cargo run -p toondb-grpc
const client = new ToonDBClient({ address: 'localhost:50051' });
await client.putKv('key', Buffer.from('value'));
await client.close();
```

**Migration Checklist:**
- [ ] Start ToonDB server (cargo run -p toondb-grpc)
- [ ] Replace `Database.open()` with `new ToonDBClient()`
- [ ] Update connection strings to point to server
- [ ] Add error handling for all operations
- [ ] Remove any FFI-related code

---

## Release Process

### Version Bumping

```bash
# Update version in package.json
npm version patch  # or minor, major

# Update CHANGELOG.md
vim CHANGELOG.md
```

### Building Distribution

```bash
# Clean build
npm run clean
npm run build

# Check bundle size
npm run build:analyze
```

### Publishing to npm

```bash
# Test locally
npm pack

# Dry run
npm publish --dry-run

# Publish (requires npm login)
npm publish --access public
```

---

## Testing Checklist

Before submitting a PR, ensure:

- [ ] All unit tests pass: `npm test`
- [ ] Integration tests pass (with server): `npm run test:integration`
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Code formatted: `npm run format`
- [ ] Documentation updated (TSDoc comments)
- [ ] CHANGELOG.md updated
- [ ] No console.log statements in production code

---

## Performance Testing

### Benchmarks

```bash
# Run benchmarks
npm run benchmark

# Run specific benchmark
npm run benchmark -- vector-search
```

### Load Testing

```bash
# Start server
cd toondb
cargo run -p toondb-grpc --release

# Run load test
cd toondb-nodejs-sdk
npm run test:load
```

---

## Documentation

### TSDoc Comments

Use TSDoc for all public APIs:

```typescript
/**
 * Search for vectors in an index
 * 
 * @param indexName - Name of the vector index
 * @param query - Query vector
 * @param k - Number of results to return
 * @returns Array of search results with IDs and distances
 * 
 * @example
 * ```typescript
 * const results = await client.search('embeddings', queryVector, 10);
 * console.log(results);
 * ```
 */
async search(indexName: string, query: number[], k: number): Promise<SearchResult[]>
```

### Generate Documentation

```bash
# Generate TypeDoc documentation
npm run docs

# View locally
open docs/index.html
```

---

## Getting Help

- **Main Repo**: https://github.com/toondb/toondb
- **Node.js SDK Issues**: https://github.com/toondb/toondb-nodejs-sdk/issues
- **Discussions**: https://github.com/toondb/toondb/discussions
- **Contributing Guide**: See main repo [CONTRIBUTING.md](https://github.com/toondb/toondb/blob/main/CONTRIBUTING.md)

---

## License

By contributing to ToonDB Node.js SDK, you agree that your contributions will be licensed under the Apache License 2.0.
