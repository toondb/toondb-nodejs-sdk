/**
 * SochDB Embedded Database
 *
 * Direct database access via IPC to the SochDB server.
 * This provides the same API as the Python SDK's Database class.
 *
 * @packageDocumentation
 */

// Copyright 2025 Sushanth (https://github.com/sushanthpy)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import * as fs from 'fs';
import * as path from 'path';
import { DatabaseError, TransactionError } from './errors';
import { IpcClient } from './ipc-client';
import { Query } from './query';
import { startEmbeddedServer, stopEmbeddedServer } from './server-manager';

/**
 * Configuration options for the Database.
 */
export interface DatabaseConfig {
  /** Path to the database directory */
  path: string;
  /** Whether to create the database if it doesn't exist (default: true) */
  createIfMissing?: boolean;
  /** Enable WAL (Write-Ahead Logging) for durability (default: true) */
  walEnabled?: boolean;
  /** Sync mode: 'full' | 'normal' | 'off' (default: 'normal') */
  syncMode?: 'full' | 'normal' | 'off';
  /** Maximum size of the memtable before flushing (default: 64MB) */
  memtableSizeBytes?: number;
  /** 
   * Whether to automatically start an embedded server (default: true)
   * Set to false if connecting to an existing external server
   */
  embedded?: boolean;
}

/**
 * Result of a SQL query execution.
 */
export interface SQLQueryResult {
  /** Result rows */
  rows: Array<Record<string, any>>;
  /** Column names */
  columns: string[];
  /** Number of rows affected (for INSERT/UPDATE/DELETE) */
  rowsAffected: number;
}

/**
 * Transaction handle for atomic operations.
 */
export class Transaction {
  private _db: Database;
  private _txnId: bigint | null = null;
  private _committed = false;
  private _aborted = false;

  constructor(db: Database) {
    this._db = db;
  }

  /**
   * Begin the transaction.
   * @internal
   */
  async begin(): Promise<void> {
    this._txnId = await this._db['_beginTransaction']();
  }

  /**
   * Get a value by key within this transaction.
   */
  async get(key: Buffer | string): Promise<Buffer | null> {
    this._ensureActive();
    return this._db.get(key);
  }

  /**
   * Put a key-value pair within this transaction.
   */
  async put(key: Buffer | string, value: Buffer | string): Promise<void> {
    this._ensureActive();
    return this._db.put(key, value);
  }

  /**
   * Delete a key within this transaction.
   */
  async delete(key: Buffer | string): Promise<void> {
    this._ensureActive();
    return this._db.delete(key);
  }

  /**
   * Scan keys with a prefix within this transaction.
   * @param prefix - The prefix to scan for
   * @param end - Optional end boundary (exclusive)
   */
  async *scan(prefix: string | Buffer, end?: string | Buffer): AsyncGenerator<[Buffer, Buffer]> {
    this._ensureActive();
    // Delegate to database's scan method
    // Transactional isolation is maintained by the underlying storage
    for await (const entry of this._db.scanGenerator(prefix, end)) {
      yield entry;
    }
  }

  /**
   * Get a value by path within this transaction.
   */
  async getPath(pathStr: string): Promise<Buffer | null> {
    this._ensureActive();
    return this._db.getPath(pathStr);
  }

  /**
   * Put a value at a path within this transaction.
   */
  async putPath(pathStr: string, value: Buffer | string): Promise<void> {
    this._ensureActive();
    return this._db.putPath(pathStr, value);
  }

  /**
   * Commit the transaction.
   * 
   * After committing, an optional checkpoint is triggered to ensure writes
   * are durable. This prevents race conditions where subsequent reads might
   * not see committed data due to async flush timing.
   */
  async commit(): Promise<void> {
    this._ensureActive();
    if (this._txnId !== null) {
      await this._db['_commitTransaction'](this._txnId);
      // Trigger checkpoint to ensure durability (addresses race condition)
      // Note: This is a trade-off between consistency and performance.
      // For high-throughput scenarios, consider batching checkpoints.
      await this._db.checkpoint();
    }
    this._committed = true;
  }

  /**
   * Abort/rollback the transaction.
   */
  async abort(): Promise<void> {
    if (this._committed || this._aborted) return;
    if (this._txnId !== null) {
      await this._db['_abortTransaction'](this._txnId);
    }
    this._aborted = true;
  }

  private _ensureActive(): void {
    if (this._committed) {
      throw new TransactionError('Transaction already committed');
    }
    if (this._aborted) {
      throw new TransactionError('Transaction already aborted');
    }
  }
}

/**
 * SochDB Database client.
 *
 * Provides access to SochDB with full transaction support.
 *
 * @example
 * ```typescript
 * import { Database } from '@sushanth/sochdb';
 *
 * // Open a database
 * const db = await Database.open('./my_database');
 *
 * // Simple key-value operations
 * await db.put(Buffer.from('user:123'), Buffer.from('{"name": "Alice"}'));
 * const value = await db.get(Buffer.from('user:123'));
 *
 * // Path-native API
 * await db.putPath('users/alice/email', Buffer.from('alice@example.com'));
 * const email = await db.getPath('users/alice/email');
 *
 * // Transactions
 * await db.withTransaction(async (txn) => {
 *   await txn.put(Buffer.from('key1'), Buffer.from('value1'));
 *   await txn.put(Buffer.from('key2'), Buffer.from('value2'));
 * });
 *
 * // Clean up
 * await db.close();
 * ```
 */
export class Database {
  private _client: IpcClient | null = null;
  private _config: DatabaseConfig;
  private _closed = false;
  private _embeddedServerStarted = false;

  private constructor(config: DatabaseConfig) {
    this._config = {
      createIfMissing: true,
      walEnabled: true,
      syncMode: 'normal',
      memtableSizeBytes: 64 * 1024 * 1024,
      embedded: true,  // Default to embedded mode
      ...config,
    };
  }

  /**
   * Open a database at the specified path.
   *
   * @param pathOrConfig - Path to the database directory or configuration object
   * @returns A new Database instance
   *
   * @example
   * ```typescript
   * // Simple usage (embedded mode - starts server automatically)
   * const db = await Database.open('./my_database');
   *
   * // With configuration
   * const db = await Database.open({
   *   path: './my_database',
   *   walEnabled: true,
   *   syncMode: 'full',
   * });
   * 
   * // Connect to existing external server
   * const db = await Database.open({
   *   path: './my_database',
   *   embedded: false,  // Don't start embedded server
   * });
   * ```
   */
  static async open(pathOrConfig: string | DatabaseConfig): Promise<Database> {
    const config: DatabaseConfig =
      typeof pathOrConfig === 'string' ? { path: pathOrConfig } : pathOrConfig;

    // Ensure database directory exists
    if (config.createIfMissing !== false) {
      if (!fs.existsSync(config.path)) {
        fs.mkdirSync(config.path, { recursive: true });
      }
    }

    const db = new Database(config);

    // Start embedded server if configured (default: true)
    let socketPath: string;
    if (db._config.embedded !== false) {
      // Start embedded server and get socket path
      socketPath = await startEmbeddedServer(config.path);
      db._embeddedServerStarted = true;
    } else {
      // Connect to existing server socket
      socketPath = path.join(config.path, 'sochdb.sock');
    }

    db._client = await IpcClient.connect(socketPath);

    // Track database open event (only analytics event we send)
    try {
      const { trackDatabaseOpen } = await import('./analytics.js');
      await trackDatabaseOpen(config.path, 'embedded');
    } catch {
      // Never let analytics break database operations
    }

    return db;
  }

  /**
   * Get a value by key.
   *
   * @param key - The key to look up (Buffer or string)
   * @returns The value as a Buffer, or null if not found
   */
  async get(key: Buffer | string): Promise<Buffer | null> {
    this._ensureOpen();
    const keyBuf = typeof key === 'string' ? Buffer.from(key) : key;
    return this._client!.get(keyBuf);
  }

  /**
   * Put a key-value pair.
   *
   * @param key - The key (Buffer or string)
   * @param value - The value (Buffer or string)
   */
  async put(key: Buffer | string, value: Buffer | string): Promise<void> {
    this._ensureOpen();
    const keyBuf = typeof key === 'string' ? Buffer.from(key) : key;
    const valueBuf = typeof value === 'string' ? Buffer.from(value) : value;
    return this._client!.put(keyBuf, valueBuf);
  }

  /**
   * Delete a key.
   *
   * @param key - The key to delete (Buffer or string)
   */
  async delete(key: Buffer | string): Promise<void> {
    this._ensureOpen();
    const keyBuf = typeof key === 'string' ? Buffer.from(key) : key;
    return this._client!.delete(keyBuf);
  }

  /**
   * Get a value by path.
   *
   * @param pathStr - The path (e.g., "users/alice/email")
   * @returns The value as a Buffer, or null if not found
   */
  async getPath(pathStr: string): Promise<Buffer | null> {
    this._ensureOpen();
    return this._client!.getPath(pathStr);
  }

  /**
   * Put a value at a path.
   *
   * @param pathStr - The path (e.g., "users/alice/email")
   * @param value - The value (Buffer or string)
   */
  async putPath(pathStr: string, value: Buffer | string): Promise<void> {
    this._ensureOpen();
    const valueBuf = typeof value === 'string' ? Buffer.from(value) : value;
    return this._client!.putPath(pathStr, valueBuf);
  }

  /**
   * Create a query builder for the given path prefix.
   *
   * @param pathPrefix - The path prefix to query (e.g., "users/")
   * @returns A Query builder instance
   *
   * @example
   * ```typescript
   * const results = await db.query('users/')
   *   .limit(10)
   *   .select(['name', 'email'])
   *   .execute();
   * ```
   */
  query(pathPrefix: string): Query {
    this._ensureOpen();
    return new Query(this._client!, pathPrefix);
  }

  /**
   * Scan for keys with a prefix, returning key-value pairs.
   * This is the preferred method for simple prefix-based iteration.
   *
   * @param prefix - The prefix to scan for (e.g., "users/", "tenants/tenant1/")
   * @returns Array of key-value pairs
   *
   * @example
   * ```typescript
   * const results = await db.scan('tenants/tenant1/');
   * for (const { key, value } of results) {
   *   console.log(`${key.toString()}: ${value.toString()}`);
   * }
   * ```
   */
  async scan(prefix: string): Promise<Array<{ key: Buffer; value: Buffer }>> {
    this._ensureOpen();
    return this._client!.scan(prefix);
  }

  /**
   * Scan for keys with a prefix using an async generator.
   * This allows for memory-efficient iteration over large result sets.
   *
   * @param prefix - The prefix to scan for
   * @param end - Optional end boundary (exclusive)
   * @returns Async generator yielding [key, value] tuples
   *
   * @example
   * ```typescript
   * for await (const [key, value] of db.scanGenerator('users/')) {
   *   console.log(`${key.toString()}: ${value.toString()}`);
   * }
   * ```
   */
  async *scanGenerator(prefix: string | Buffer, end?: string | Buffer): AsyncGenerator<[Buffer, Buffer]> {
    this._ensureOpen();
    const prefixBuf = typeof prefix === 'string' ? Buffer.from(prefix) : prefix;
    const endBuf = end ? (typeof end === 'string' ? Buffer.from(end) : end) : undefined;

    const results = await this._client!.scan(prefixBuf.toString());
    for (const { key, value } of results) {
      // Filter by end boundary if provided
      if (endBuf && Buffer.compare(key, endBuf) >= 0) {
        break;
      }
      yield [key, value];
    }
  }

  /**
   * Execute operations within a transaction.
   *
   * The transaction automatically commits on success or aborts on error.
   *
   * @param fn - Async function that receives a Transaction object
   *
   * @example
   * ```typescript
   * await db.withTransaction(async (txn) => {
   *   await txn.put(Buffer.from('key1'), Buffer.from('value1'));
   *   await txn.put(Buffer.from('key2'), Buffer.from('value2'));
   *   // Automatically commits
   * });
   * ```
   */
  async withTransaction<T>(fn: (txn: Transaction) => Promise<T>): Promise<T> {
    this._ensureOpen();
    const txn = new Transaction(this);
    await txn.begin();
    try {
      const result = await fn(txn);
      await txn.commit();
      return result;
    } catch (error) {
      await txn.abort();
      throw error;
    }
  }

  /**
   * Create a new transaction.
   *
   * @returns A new Transaction instance
   * @deprecated Use withTransaction() for automatic commit/abort handling
   */
  async transaction(): Promise<Transaction> {
    this._ensureOpen();
    const txn = new Transaction(this);
    await txn.begin();
    return txn;
  }

  /**
   * Force a checkpoint to persist memtable to disk.
   */
  async checkpoint(): Promise<void> {
    this._ensureOpen();
    return this._client!.checkpoint();
  }

  /**
   * Get storage statistics.
   */
  async stats(): Promise<{
    memtableSizeBytes: number;
    walSizeBytes: number;
    activeTransactions: number;
  }> {
    this._ensureOpen();
    return this._client!.stats();
  }

  /**
   * Execute a SQL query.
   * 
   * SochDB supports a subset of SQL for relational data stored on top of 
   * the key-value engine. Tables and rows are stored as:
   * - Schema: _sql/tables/{table_name}/schema
   * - Rows: _sql/tables/{table_name}/rows/{row_id}
   * 
   * Supported SQL:
   * - CREATE TABLE table_name (col1 TYPE, col2 TYPE, ...)
   * - DROP TABLE table_name
   * - INSERT INTO table_name (cols) VALUES (vals)
   * - SELECT cols FROM table_name [WHERE ...] [ORDER BY ...] [LIMIT ...]
   * - UPDATE table_name SET col=val [WHERE ...]
   * - DELETE FROM table_name [WHERE ...]
   * 
   * Supported types: INT, TEXT, FLOAT, BOOL, BLOB
   * 
   * @param sql - SQL query string
   * @returns SQLQueryResult with rows and metadata
   * 
   * @example
   * ```typescript
   * // Create a table
   * await db.execute("CREATE TABLE users (id INT PRIMARY KEY, name TEXT, age INT)");
   * 
   * // Insert data
   * await db.execute("INSERT INTO users (id, name, age) VALUES (1, 'Alice', 30)");
   * 
   * // Query data
   * const result = await db.execute("SELECT * FROM users WHERE age > 26");
   * result.rows.forEach(row => console.log(row));
   * ```
   */
  async execute(sql: string): Promise<SQLQueryResult> {
    this._ensureOpen();

    // Import the SQL executor
    const { SQLExecutor } = await import('./sql-engine.js');

    // Create a database adapter for the SQL executor
    const dbAdapter = {
      get: (key: Buffer | string) => this.get(key),
      put: (key: Buffer | string, value: Buffer | string) => this.put(key, value),
      delete: (key: Buffer | string) => this.delete(key),
      scan: (prefix: string) => this.scan(prefix),
    };

    const executor = new SQLExecutor(dbAdapter);
    return executor.execute(sql);
  }

  // =========================================================================
  // Static Serialization Methods
  // =========================================================================

  /**
   * Convert records to TOON format for token-efficient LLM context.
   * 
   * TOON format achieves 40-66% token reduction compared to JSON by using
   * a columnar text format with minimal syntax.
   * 
   * @param tableName - Name of the table/collection
   * @param records - Array of objects with the data
   * @param fields - Optional array of field names to include
   * @returns TOON-formatted string
   * 
   * @example
   * ```typescript
   * const records = [
   *   { id: 1, name: 'Alice', email: 'alice@ex.com' },
   *   { id: 2, name: 'Bob', email: 'bob@ex.com' }
   * ];
   * console.log(Database.toToon('users', records, ['name', 'email']));
   * // users[2]{name,email}:Alice,alice@ex.com;Bob,bob@ex.com
   * ```
   */
  static toToon(
    tableName: string,
    records: Array<Record<string, any>>,
    fields?: string[]
  ): string {
    if (!records || records.length === 0) {
      return `${tableName}[0]{}:`;
    }

    // Determine fields from first record if not specified
    const useFields = fields ?? Object.keys(records[0]);

    // Build header: table[count]{field1,field2,...}:
    const header = `${tableName}[${records.length}]{${useFields.join(',')}}:`;

    // Escape values containing delimiters
    const escapeValue = (v: any): string => {
      const s = v != null ? String(v) : '';
      if (s.includes(',') || s.includes(';') || s.includes('\n')) {
        return `"${s}"`;
      }
      return s;
    };

    // Build rows: value1,value2;value1,value2;...
    const rows = records
      .map(r => useFields.map(f => escapeValue(r[f])).join(','))
      .join(';');

    return header + rows;
  }

  /**
   * Convert records to JSON format for easy application decoding.
   * 
   * While TOON format is optimized for LLM context (40-66% token reduction),
   * JSON is often easier for applications to parse. Use this method when
   * the output will be consumed by application code rather than LLMs.
   * 
   * @param tableName - Name of the table/collection
   * @param records - Array of objects with the data
   * @param fields - Optional array of field names to include
   * @param compact - If true (default), outputs minified JSON
   * @returns JSON-formatted string
   * 
   * @example
   * ```typescript
   * const records = [
   *   { id: 1, name: 'Alice' },
   *   { id: 2, name: 'Bob' }
   * ];
   * console.log(Database.toJson('users', records));
   * // {"table":"users","count":2,"records":[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]}
   * ```
   */
  static toJson(
    tableName: string,
    records: Array<Record<string, any>>,
    fields?: string[],
    compact: boolean = true
  ): string {
    if (!records || records.length === 0) {
      return JSON.stringify({ table: tableName, count: 0, records: [] });
    }

    // Filter fields if specified
    const filteredRecords = fields
      ? records.map(r => {
        const filtered: Record<string, any> = {};
        for (const f of fields) {
          filtered[f] = r[f];
        }
        return filtered;
      })
      : records;

    const output = {
      table: tableName,
      count: filteredRecords.length,
      records: filteredRecords,
    };

    return compact ? JSON.stringify(output) : JSON.stringify(output, null, 2);
  }

  /**
   * Parse a JSON format string back to structured data.
   * 
   * @param jsonStr - JSON-formatted string (from toJson)
   * @returns Object with table, fields, and records
   */
  static fromJson(jsonStr: string): {
    table: string;
    fields: string[];
    records: Array<Record<string, any>>;
  } {
    const data = JSON.parse(jsonStr);
    const table = data.table ?? 'unknown';
    const records = data.records ?? [];
    const fields = records.length > 0 ? Object.keys(records[0]) : [];

    return { table, fields, records };
  }

  // =========================================================================
  // Graph Overlay Operations
  // =========================================================================

  /**
   * Add a node to the graph overlay.
   *
   * @param namespace - Namespace for the graph
   * @param nodeId - Unique node identifier
   * @param nodeType - Type of node (e.g., "person", "document", "concept")
   * @param properties - Optional node properties
   *
   * @example
   * ```typescript
   * await db.addNode('default', 'alice', 'person', { role: 'engineer' });
   * await db.addNode('default', 'project_x', 'project', { status: 'active' });
   * ```
   */
  async addNode(
    namespace: string,
    nodeId: string,
    nodeType: string,
    properties?: Record<string, string>
  ): Promise<void> {
    this._ensureOpen();

    const key = `_graph/${namespace}/nodes/${nodeId}`;
    const value = JSON.stringify({
      id: nodeId,
      node_type: nodeType,
      properties: properties || {},
    });

    await this.put(Buffer.from(key), Buffer.from(value));
  }

  /**
   * Add an edge between nodes in the graph overlay.
   *
   * @param namespace - Namespace for the graph
   * @param fromId - Source node ID
   * @param edgeType - Type of relationship
   * @param toId - Target node ID
   * @param properties - Optional edge properties
   *
   * @example
   * ```typescript
   * await db.addEdge('default', 'alice', 'works_on', 'project_x');
   * await db.addEdge('default', 'alice', 'knows', 'bob', { since: '2020' });
   * ```
   */
  async addEdge(
    namespace: string,
    fromId: string,
    edgeType: string,
    toId: string,
    properties?: Record<string, string>
  ): Promise<void> {
    this._ensureOpen();

    const key = `_graph/${namespace}/edges/${fromId}/${edgeType}/${toId}`;
    const value = JSON.stringify({
      from_id: fromId,
      edge_type: edgeType,
      to_id: toId,
      properties: properties || {},
    });

    await this.put(Buffer.from(key), Buffer.from(value));
  }

  /**
   * Traverse the graph from a starting node.
   *
   * @param namespace - Namespace for the graph
   * @param startNode - Node ID to start traversal from
   * @param maxDepth - Maximum traversal depth (default: 10)
   * @param order - "bfs" for breadth-first, "dfs" for depth-first
   * @returns Object with nodes and edges arrays
   *
   * @example
   * ```typescript
   * const { nodes, edges } = await db.traverse('default', 'alice', 2);
   * for (const node of nodes) {
   *   console.log(`Node: ${node.id} (${node.node_type})`);
   * }
   * ```
   */
  async traverse(
    namespace: string,
    startNode: string,
    maxDepth: number = 10,
    order: 'bfs' | 'dfs' = 'bfs'
  ): Promise<{ nodes: any[]; edges: any[] }> {
    this._ensureOpen();

    const visited = new Set<string>();
    const nodes: any[] = [];
    const edges: any[] = [];
    const frontier: Array<[string, number]> = [[startNode, 0]];

    while (frontier.length > 0) {
      const [currentNode, depth] = order === 'bfs'
        ? frontier.shift()!
        : frontier.pop()!;

      if (depth > maxDepth || visited.has(currentNode)) {
        continue;
      }
      visited.add(currentNode);

      // Get node data
      const nodeKey = `_graph/${namespace}/nodes/${currentNode}`;
      const nodeData = await this.get(Buffer.from(nodeKey));
      if (nodeData) {
        nodes.push(JSON.parse(nodeData.toString()));
      }

      // Get outgoing edges
      const edgePrefix = `_graph/${namespace}/edges/${currentNode}/`;
      const edgeResults = await this.scan(edgePrefix);
      for (const { value } of edgeResults) {
        const edge = JSON.parse(value.toString());
        edges.push(edge);

        if (!visited.has(edge.to_id)) {
          frontier.push([edge.to_id, depth + 1]);
        }
      }
    }

    return { nodes, edges };
  }

  // =========================================================================
  // Semantic Cache Operations
  // =========================================================================

  /**
   * Store a value in the semantic cache with its embedding.
   *
   * @param cacheName - Name of the cache
   * @param key - Cache key (for display/debugging)
   * @param value - Value to cache
   * @param embedding - Embedding vector for similarity matching
   * @param ttlSeconds - Time-to-live in seconds (0 = no expiry)
   *
   * @example
   * ```typescript
   * await db.cachePut(
   *   'llm_responses',
   *   'What is Python?',
   *   'Python is a programming language...',
   *   [0.1, 0.2, 0.3, ...],  // 384-dim
   *   3600
   * );
   * ```
   */
  async cachePut(
    cacheName: string,
    key: string,
    value: string,
    embedding: number[],
    ttlSeconds: number = 0
  ): Promise<void> {
    this._ensureOpen();

    // Hash the key for storage
    const keyHash = Buffer.from(key).toString('hex').slice(0, 16);
    const cacheKey = `_cache/${cacheName}/${keyHash}`;

    const expiresAt = ttlSeconds > 0
      ? Math.floor(Date.now() / 1000) + ttlSeconds
      : 0;

    const cacheValue = JSON.stringify({
      key,
      value,
      embedding,
      expires_at: expiresAt,
    });

    await this.put(Buffer.from(cacheKey), Buffer.from(cacheValue));
  }

  /**
   * Look up a value in the semantic cache by embedding similarity.
   *
   * @param cacheName - Name of the cache
   * @param queryEmbedding - Query embedding to match against
   * @param threshold - Minimum cosine similarity threshold (0.0 to 1.0)
   * @returns Cached value if similarity >= threshold, null otherwise
   *
   * @example
   * ```typescript
   * const result = await db.cacheGet(
   *   'llm_responses',
   *   [0.12, 0.18, ...],  // Similar to "What is Python?"
   *   0.85
   * );
   * if (result) {
   *   console.log(`Cache hit: ${result}`);
   * }
   * ```
   */
  async cacheGet(
    cacheName: string,
    queryEmbedding: number[],
    threshold: number = 0.85
  ): Promise<string | null> {
    this._ensureOpen();

    const prefix = `_cache/${cacheName}/`;
    const entries = await this.scan(prefix);

    const now = Math.floor(Date.now() / 1000);
    let bestMatch: { similarity: number; value: string } | null = null;

    for (const { value } of entries) {
      const entry = JSON.parse(value.toString());

      // Check expiry
      if (entry.expires_at > 0 && now > entry.expires_at) {
        continue;
      }

      // Compute cosine similarity
      if (entry.embedding && entry.embedding.length === queryEmbedding.length) {
        const similarity = this._cosineSimilarity(queryEmbedding, entry.embedding);
        if (similarity >= threshold) {
          if (!bestMatch || similarity > bestMatch.similarity) {
            bestMatch = { similarity, value: entry.value };
          }
        }
      }
    }

    return bestMatch?.value ?? null;
  }

  private _cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    return normA === 0 || normB === 0 ? 0 : dot / (normA * normB);
  }

  // =========================================================================
  // Trace Operations (Observability)
  // =========================================================================

  /**
   * Start a new trace.
   *
   * @param name - Name of the trace (e.g., "user_request", "batch_job")
   * @returns Object with traceId and rootSpanId
   *
   * @example
   * ```typescript
   * const { traceId, rootSpanId } = await db.startTrace('user_query');
   * // ... do work ...
   * await db.endSpan(traceId, rootSpanId, 'ok');
   * ```
   */
  async startTrace(name: string): Promise<{ traceId: string; rootSpanId: string }> {
    this._ensureOpen();

    const traceId = `trace_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
    const spanId = `span_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
    const now = Date.now() * 1000; // microseconds

    // Store trace
    const traceKey = `_traces/${traceId}`;
    const traceValue = JSON.stringify({
      trace_id: traceId,
      name,
      start_us: now,
      root_span_id: spanId,
    });
    await this.put(Buffer.from(traceKey), Buffer.from(traceValue));

    // Store root span
    const spanKey = `_traces/${traceId}/spans/${spanId}`;
    const spanValue = JSON.stringify({
      span_id: spanId,
      name,
      start_us: now,
      parent_span_id: null,
      status: 'active',
    });
    await this.put(Buffer.from(spanKey), Buffer.from(spanValue));

    return { traceId, rootSpanId: spanId };
  }

  /**
   * Start a child span within a trace.
   *
   * @param traceId - ID of the parent trace
   * @param parentSpanId - ID of the parent span
   * @param name - Name of this span
   * @returns The new span ID
   *
   * @example
   * ```typescript
   * const { traceId, rootSpanId } = await db.startTrace('user_query');
   * const dbSpan = await db.startSpan(traceId, rootSpanId, 'database_lookup');
   * // ... do database work ...
   * const duration = await db.endSpan(traceId, dbSpan, 'ok');
   * ```
   */
  async startSpan(
    traceId: string,
    parentSpanId: string,
    name: string
  ): Promise<string> {
    this._ensureOpen();

    const spanId = `span_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
    const now = Date.now() * 1000;

    const spanKey = `_traces/${traceId}/spans/${spanId}`;
    const spanValue = JSON.stringify({
      span_id: spanId,
      name,
      start_us: now,
      parent_span_id: parentSpanId,
      status: 'active',
    });
    await this.put(Buffer.from(spanKey), Buffer.from(spanValue));

    return spanId;
  }

  /**
   * End a span and record its duration.
   *
   * @param traceId - ID of the trace
   * @param spanId - ID of the span to end
   * @param status - "ok", "error", or "unset"
   * @returns Duration in microseconds
   *
   * @example
   * ```typescript
   * const duration = await db.endSpan(traceId, spanId, 'ok');
   * console.log(`Operation took ${duration}µs`);
   * ```
   */
  async endSpan(
    traceId: string,
    spanId: string,
    status: 'ok' | 'error' | 'unset' = 'ok'
  ): Promise<number> {
    this._ensureOpen();

    const spanKey = `_traces/${traceId}/spans/${spanId}`;
    const spanData = await this.get(Buffer.from(spanKey));

    if (!spanData) {
      throw new DatabaseError(`Span not found: ${spanId}`);
    }

    const span = JSON.parse(spanData.toString());
    const now = Date.now() * 1000;
    const duration = now - span.start_us;

    const updatedSpan = {
      ...span,
      status,
      end_us: now,
      duration_us: duration,
    };
    await this.put(Buffer.from(spanKey), Buffer.from(JSON.stringify(updatedSpan)));

    return duration;
  }

  /**
   * Close the database connection.
   * If running in embedded mode, also stops the embedded server.
   */
  async close(): Promise<void> {
    if (this._closed) return;
    if (this._client) {
      await this._client.close();
      this._client = null;
    }
    // Stop embedded server if we started it
    if (this._embeddedServerStarted) {
      await stopEmbeddedServer(this._config.path);
      this._embeddedServerStarted = false;
    }
    this._closed = true;
  }

  // Internal methods for transaction management
  private async _beginTransaction(): Promise<bigint> {
    return this._client!.beginTransaction();
  }

  private async _commitTransaction(txnId: bigint): Promise<void> {
    return this._client!.commitTransaction(txnId);
  }

  private async _abortTransaction(txnId: bigint): Promise<void> {
    return this._client!.abortTransaction(txnId);
  }

  private _ensureOpen(): void {
    if (this._closed) {
      throw new DatabaseError('Database is closed');
    }
    if (!this._client) {
      throw new DatabaseError('Database not connected');
    }
  }
}
