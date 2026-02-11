/**
 * Embedded Database - FFI Mode
 * 
 * Direct FFI access to SochDB native library.
 * No server required - similar to Python SDK's Database class.
 */

import { DatabaseError } from '../errors';
import { NativeBindings } from './ffi/bindings';
import { EmbeddedTransaction } from './transaction';
import { Namespace, NamespaceConfig, NamespaceNotFoundError, NamespaceExistsError } from '../namespace';
import * as koffi from 'koffi';

export interface EmbeddedDatabaseConfig {
    walEnabled?: boolean;
    syncMode?: 'full' | 'normal' | 'off';
    memtableSizeBytes?: number;
    groupCommit?: boolean;
    indexPolicy?: 'write_optimized' | 'balanced' | 'scan_optimized' | 'append_only';
}

/**
 * Embedded Database using direct FFI
 * 
 * @example
 * ```typescript
 * import { EmbeddedDatabase } from '@sochdb/sochdb';
 * 
 * const db = await EmbeddedDatabase.open('./mydb');
 * await db.put(Buffer.from('key'), Buffer.from('value'));
 * const value = await db.get(Buffer.from('key'));
 * await db.close();
 * ```
 */
export class EmbeddedDatabase {
    private handle: any;
    private bindings: NativeBindings;
    private closed = false;
    private path: string;
    private concurrent = false;
    private _concurrentModeFallback = false;

    private constructor(path: string, handle: any, concurrent = false, fallback = false) {
        this.path = path;
        this.handle = handle;
        this.concurrent = concurrent;
        this._concurrentModeFallback = fallback;
        this.bindings = NativeBindings.getInstance();
    }

    /**
     * Open a database at the specified path in standard mode
     * 
     * For web applications with multiple processes, use `openConcurrent()` instead.
     * 
     * @param path - Path to database directory
     * @param config - Optional configuration
     * @returns EmbeddedDatabase instance
     */
    static open(path: string, config?: EmbeddedDatabaseConfig): EmbeddedDatabase {
        if (path.includes('\x00')) {
            throw new DatabaseError('Database path must not contain null bytes');
        }
        const bindings = NativeBindings.getInstance();
        let handle;

        if (config) {
            const cConfig = {
                wal_enabled: config.walEnabled ?? false,
                wal_enabled_set: config.walEnabled !== undefined,
                sync_mode: config.syncMode === 'full' ? 2 : (config.syncMode === 'normal' ? 1 : 0),
                sync_mode_set: config.syncMode !== undefined,
                memtable_size_bytes: BigInt(config.memtableSizeBytes ?? 0),
                group_commit: config.groupCommit ?? false,
                group_commit_set: config.groupCommit !== undefined,
                default_index_policy: 1, // Default to Balanced
                default_index_policy_set: false
            };
            handle = bindings.sochdb_open_with_config(path, cConfig);
        } else {
            handle = bindings.sochdb_open(path);
        }

        if (!handle) {
            throw new DatabaseError(`Failed to open database at ${path}`);
        }

        return new EmbeddedDatabase(path, handle, false);
    }

    /**
     * Open a database in concurrent mode for multi-process web applications
     * 
     * This mode allows multiple Node.js processes (e.g., PM2 cluster workers,
     * multiple Express instances) to access the database simultaneously.
     * 
     * Features:
     * - Lock-free reads with ~100ns latency
     * - Multi-reader, single-writer coordination
     * - Automatic write serialization
     * 
     * @example
     * ```typescript
     * import { EmbeddedDatabase } from '@sochdb/sochdb';
     * import express from 'express';
     * 
     * // Open in concurrent mode - multiple workers can access
     * const db = EmbeddedDatabase.openConcurrent('./web_db');
     * 
     * const app = express();
     * 
     * app.get('/user/:id', async (req, res) => {
     *   // Multiple concurrent requests can read simultaneously
     *   const data = await db.get(Buffer.from(`user:${req.params.id}`));
     *   if (!data) {
     *     res.status(404).json({ error: 'not found' });
     *     return;
     *   }
     *   res.send(data);
     * });
     * 
     * app.post('/user/:id', async (req, res) => {
     *   // Writes are serialized automatically
     *   await db.put(Buffer.from(`user:${req.params.id}`), req.body);
     *   res.json({ status: 'ok' });
     * });
     * 
     * // Start with PM2 cluster mode:
     * // pm2 start app.js -i max
     * app.listen(3000);
     * ```
     * 
     * @param path - Path to database directory
     * @param options - Optional configuration for concurrent mode
     * @returns EmbeddedDatabase instance in concurrent mode
     */
    static openConcurrent(path: string, options?: { fallbackToStandard?: boolean }): EmbeddedDatabase {
        if (path.includes('\x00')) {
            throw new DatabaseError('Database path must not contain null bytes');
        }
        const bindings = NativeBindings.getInstance();
        const fallbackToStandard = options?.fallbackToStandard ?? false;
        
        if (!bindings.isConcurrentModeAvailable()) {
            if (fallbackToStandard) {
                console.warn(
                    '[SochDB] Concurrent mode not available in native library (requires v0.4.8+). ' +
                    'Falling back to standard mode. For production multi-process deployments, ' +
                    'please upgrade the SochDB native library.'
                );
                const handle = bindings.sochdb_open(path);
                if (!handle) {
                    throw new DatabaseError(`Failed to open database at ${path}`);
                }
                return new EmbeddedDatabase(path, handle, false, true);
            }
            throw new DatabaseError(
                'Concurrent mode not supported. Please upgrade the SochDB native library to v0.4.8+ ' +
                'or use openConcurrent(path, { fallbackToStandard: true }) to fall back to standard mode.'
            );
        }

        const handle = bindings.sochdb_open_concurrent(path);
        if (!handle) {
            throw new DatabaseError(`Failed to open database in concurrent mode at ${path}`);
        }

        const isConcurrent = bindings.sochdb_is_concurrent?.(handle) === 1;
        return new EmbeddedDatabase(path, handle, isConcurrent, false);
    }

    /**
     * Check if database is opened in concurrent mode
     */
    get isConcurrent(): boolean {
        return this.concurrent;
    }

    /**
     * Check if concurrent mode fell back to standard mode
     */
    get isConcurrentFallback(): boolean {
        return this._concurrentModeFallback;
    }

    /**
     * Check if concurrent mode is available in the native library
     */
    static isConcurrentModeAvailable(): boolean {
        return NativeBindings.getInstance().isConcurrentModeAvailable();
    }

    /**
     * Put a key-value pair (auto-transaction)
     */
    async put(key: Buffer, value: Buffer): Promise<void> {
        this.ensureOpen();

        const txn = this.transaction();
        try {
            await txn.put(key, value);
            await txn.commit();
        } catch (error) {
            await txn.abort();
            throw error;
        }
    }

    /**
     * Get a value by key (auto-transaction)
     */
    async get(key: Buffer): Promise<Buffer | null> {
        this.ensureOpen();

        const txn = this.transaction();
        try {
            const value = await txn.get(key);
            await txn.commit();
            return value;
        } catch (error) {
            await txn.abort();
            throw error;
        }
    }

    /**
     * Delete a key (auto-transaction)
     */
    async delete(key: Buffer): Promise<void> {
        this.ensureOpen();

        const txn = this.transaction();
        try {
            await txn.delete(key);
            await txn.commit();
        } catch (error) {
            await txn.abort();
            throw error;
        }
    }

    /**
     * Put value at path (auto-transaction)
     */
    async putPath(path: string, value: Buffer): Promise<void> {
        this.ensureOpen();

        const txn = this.transaction();
        try {
            await txn.putPath(path, value);
            await txn.commit();
        } catch (error) {
            await txn.abort();
            throw error;
        }
    }

    /**
     * Get value at path (auto-transaction)
     */
    async getPath(path: string): Promise<Buffer | null> {
        this.ensureOpen();

        const txn = this.transaction();
        try {
            const value = await txn.getPath(path);
            await txn.commit();
            return value;
        } catch (error) {
            await txn.abort();
            throw error;
        }
    }

    /**
     * Scan keys with prefix
     */
    async *scanPrefix(prefix: Buffer): AsyncGenerator<[Buffer, Buffer]> {
        this.ensureOpen();

        const txn = this.transaction();
        try {
            for await (const entry of txn.scanPrefix(prefix)) {
                yield entry;
            }
            await txn.commit();
        } catch (error) {
            await txn.abort();
            throw error;
        }
    }

    /**
     * Begin a transaction
     */
    transaction(): EmbeddedTransaction {
        this.ensureOpen();

        const txnHandle = this.bindings.sochdb_begin_txn(this.handle);
        return new EmbeddedTransaction(this, this.handle, txnHandle);
    }

    /**
     * Execute operations within a transaction (with auto-commit/abort)
     */
    async withTransaction<T>(fn: (txn: EmbeddedTransaction) => Promise<T>): Promise<T> {
        const txn = this.transaction();
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
     * Force a checkpoint
     */
    async checkpoint(): Promise<bigint> {
        this.ensureOpen();
        const lsn = this.bindings.sochdb_checkpoint(this.handle);
        return BigInt(lsn);
    }

    /**
     * Get storage statistics
     */
    async stats(): Promise<{
        memtableSizeBytes: bigint;
        walSizeBytes: bigint;
        activeTransactions: number;
        minActiveSnapshot: bigint;
        lastCheckpointLsn: bigint;
    }> {
        this.ensureOpen();

        // Returns struct by value (automatically decoded)
        const stats = this.bindings.sochdb_stats(this.handle);

        const result = {
            memtableSizeBytes: BigInt(stats.memtable_size_bytes),
            walSizeBytes: BigInt(stats.wal_size_bytes),
            activeTransactions: stats.active_transactions,
            minActiveSnapshot: BigInt(stats.min_active_snapshot),
            lastCheckpointLsn: BigInt(stats.last_checkpoint_lsn),
        };

        return result;
    }

    /**
     * Close the database
     */
    close(): void {
        if (!this.closed) {
            this.bindings.sochdb_close(this.handle);
            this.closed = true;
        }
    }

    private ensureOpen(): void {
        if (this.closed) {
            throw new DatabaseError('Database is closed');
        }
    }

    /**
     * Get internal handle (for transactions)
     * @internal
     */
    getHandle(): any {
        return this.handle;
    }

    /**
     * Get bindings instance (for transactions)
     * @internal
     */
    getBindings(): NativeBindings {
        return this.bindings;
    }

    // ========================================================================
    // Namespace Operations
    // ========================================================================

    /**
     * Create a new namespace
     */
    async createNamespace(name: string, config?: Partial<NamespaceConfig>): Promise<Namespace> {
        this.ensureOpen();
        const metaKey = `_namespace/${name}/metadata`;
        const existing = await this.get(Buffer.from(metaKey));
        if (existing) {
            throw new NamespaceExistsError(name);
        }

        const nsConfig: NamespaceConfig = {
            name,
            displayName: config?.displayName,
            labels: config?.labels,
            readOnly: config?.readOnly ?? false,
        };
        await this.put(Buffer.from(metaKey), Buffer.from(JSON.stringify(nsConfig)));
        return new Namespace(this, name, nsConfig);
    }

    /**
     * Get an existing namespace
     */
    async namespace(name: string): Promise<Namespace> {
        this.ensureOpen();
        const metaKey = `_namespace/${name}/metadata`;
        const data = await this.get(Buffer.from(metaKey));
        if (!data) {
            throw new NamespaceNotFoundError(name);
        }
        const nsConfig = JSON.parse(data.toString());
        return new Namespace(this, name, nsConfig);
    }

    /**
     * Get or create a namespace
     */
    async getOrCreateNamespace(name: string, config?: Partial<NamespaceConfig>): Promise<Namespace> {
        try {
            return await this.namespace(name);
        } catch (error) {
            if (error instanceof NamespaceNotFoundError) {
                return await this.createNamespace(name, config);
            }
            throw error;
        }
    }

    /**
     * Delete a namespace and all its data
     */
    async deleteNamespace(name: string): Promise<boolean> {
        this.ensureOpen();
        const prefix = Buffer.from(`_namespace/${name}/`);
        const collPrefix = Buffer.from(`_collection/${name}/`);

        const toDelete: Buffer[] = [];
        try {
            for await (const [keyBuf] of this.scanPrefix(prefix)) {
                toDelete.push(keyBuf);
            }
            for await (const [keyBuf] of this.scanPrefix(collPrefix)) {
                toDelete.push(keyBuf);
            }
        } catch { /* scan not available */ }

        for (const key of toDelete) {
            await this.delete(key);
        }
        return toDelete.length > 0;
    }

    /**
     * List all namespace names
     */
    async listNamespaces(): Promise<string[]> {
        this.ensureOpen();
        const prefix = Buffer.from('_namespace/');
        const names = new Set<string>();
        try {
            for await (const [keyBuf] of this.scanPrefix(prefix)) {
                const key = keyBuf.toString();
                const afterPrefix = key.substring('_namespace/'.length);
                const nsName = afterPrefix.split('/')[0];
                if (nsName) names.add(nsName);
            }
        } catch { /* scan not available */ }
        return Array.from(names);
    }

    // ========================================================================
    // Graph Overlay Operations (thin wrappers using KV)
    // ========================================================================

    /**
     * Add a node to the graph overlay
     */
    async addNode(
        namespace: string, nodeId: string, nodeType: string,
        properties?: Record<string, string>
    ): Promise<void> {
        this.ensureOpen();
        const key = `_graph/${namespace}/nodes/${nodeId}`;
        const value = JSON.stringify({ id: nodeId, node_type: nodeType, properties: properties || {} });
        await this.put(Buffer.from(key), Buffer.from(value));
    }

    /**
     * Add an edge between nodes
     */
    async addEdge(
        namespace: string, fromId: string, edgeType: string, toId: string,
        properties?: Record<string, string>
    ): Promise<void> {
        this.ensureOpen();
        const key = `_graph/${namespace}/edges/${fromId}/${edgeType}/${toId}`;
        const value = JSON.stringify({ from_id: fromId, edge_type: edgeType, to_id: toId, properties: properties || {} });
        await this.put(Buffer.from(key), Buffer.from(value));
    }

    /**
     * Traverse the graph from a starting node
     */
    async traverse(
        namespace: string, startNode: string, maxDepth = 10,
        order: 'bfs' | 'dfs' = 'bfs'
    ): Promise<{ nodes: any[]; edges: any[] }> {
        this.ensureOpen();
        const visited = new Set<string>();
        const nodes: any[] = [];
        const edges: any[] = [];
        const frontier: Array<[string, number]> = [[startNode, 0]];

        while (frontier.length > 0) {
            const [currentNode, depth] = order === 'bfs' ? frontier.shift()! : frontier.pop()!;
            if (depth > maxDepth || visited.has(currentNode)) continue;
            visited.add(currentNode);

            const nodeData = await this.get(Buffer.from(`_graph/${namespace}/nodes/${currentNode}`));
            if (nodeData) nodes.push(JSON.parse(nodeData.toString()));

            const edgePrefix = Buffer.from(`_graph/${namespace}/edges/${currentNode}/`);
            try {
                for await (const [, valueBuf] of this.scanPrefix(edgePrefix)) {
                    const edge = JSON.parse(valueBuf.toString());
                    edges.push(edge);
                    if (!visited.has(edge.to_id)) frontier.push([edge.to_id, depth + 1]);
                }
            } catch { /* scan not available */ }
        }
        return { nodes, edges };
    }

    // ========================================================================
    // Semantic Cache Operations (thin wrappers using KV)
    // ========================================================================

    /**
     * Put a value in the semantic cache
     */
    async cachePut(
        cacheName: string, key: string, value: string,
        embedding: number[], ttlSeconds = 0
    ): Promise<void> {
        this.ensureOpen();
        const keyHash = Buffer.from(key).toString('hex').slice(0, 16);
        const cacheKey = `_cache/${cacheName}/${keyHash}`;
        const expiresAt = ttlSeconds > 0 ? Math.floor(Date.now() / 1000) + ttlSeconds : 0;
        const cacheValue = JSON.stringify({ key, value, embedding, expires_at: expiresAt });
        await this.put(Buffer.from(cacheKey), Buffer.from(cacheValue));
    }

    /**
     * Get a value from the semantic cache by embedding similarity
     */
    async cacheGet(
        cacheName: string, queryEmbedding: number[], threshold = 0.85
    ): Promise<string | null> {
        this.ensureOpen();
        const prefix = Buffer.from(`_cache/${cacheName}/`);
        const now = Math.floor(Date.now() / 1000);
        let bestMatch: { similarity: number; value: string } | null = null;

        try {
            for await (const [, valueBuf] of this.scanPrefix(prefix)) {
                const entry = JSON.parse(valueBuf.toString());
                if (entry.expires_at > 0 && now > entry.expires_at) continue;
                if (entry.embedding && entry.embedding.length === queryEmbedding.length) {
                    const similarity = EmbeddedDatabase.cosineSimilarity(queryEmbedding, entry.embedding);
                    if (similarity >= threshold) {
                        if (!bestMatch || similarity > bestMatch.similarity) {
                            bestMatch = { similarity, value: entry.value };
                        }
                    }
                }
            }
        } catch { /* scan not available */ }

        return bestMatch?.value ?? null;
    }

    /**
     * Delete a cache entry
     */
    async cacheDelete(cacheName: string, key: string): Promise<void> {
        this.ensureOpen();
        const keyHash = Buffer.from(key).toString('hex').slice(0, 16);
        await this.delete(Buffer.from(`_cache/${cacheName}/${keyHash}`));
    }

    /**
     * Clear all entries in a semantic cache
     */
    async cacheClear(cacheName: string): Promise<number> {
        this.ensureOpen();
        const prefix = Buffer.from(`_cache/${cacheName}/`);
        let deleted = 0;
        try {
            const toDelete: Buffer[] = [];
            for await (const [keyBuf] of this.scanPrefix(prefix)) {
                toDelete.push(keyBuf);
            }
            for (const k of toDelete) {
                await this.delete(k);
                deleted++;
            }
        } catch { /* scan not available */ }
        return deleted;
    }

    // ========================================================================
    // Static Format Utilities
    // ========================================================================

    /**
     * Convert records to TOON format
     */
    static toToon(
        tableName: string,
        records: Array<Record<string, any>>,
        fields?: string[]
    ): string {
        if (!records || records.length === 0) return `${tableName}[0]{}:`;
        const useFields = fields ?? Object.keys(records[0]);
        const header = `${tableName}[${records.length}]{${useFields.join(',')}}:`;
        const escapeValue = (v: any): string => {
            const s = v != null ? String(v) : '';
            if (s.includes(',') || s.includes(';') || s.includes('\n')) return `"${s}"`;
            return s;
        };
        const rows = records.map(r => useFields.map(f => escapeValue(r[f])).join(',')).join(';');
        return header + rows;
    }

    /**
     * Convert records to JSON format
     */
    static toJson(
        tableName: string,
        records: Array<Record<string, any>>,
        fields?: string[],
        compact = true
    ): string {
        if (!records || records.length === 0) {
            return JSON.stringify({ table: tableName, count: 0, records: [] });
        }
        const filteredRecords = fields
            ? records.map(r => {
                const filtered: Record<string, any> = {};
                for (const f of fields) filtered[f] = r[f];
                return filtered;
            })
            : records;
        const output = { table: tableName, count: filteredRecords.length, records: filteredRecords };
        return compact ? JSON.stringify(output) : JSON.stringify(output, null, 2);
    }

    /**
     * Parse JSON format
     */
    static fromJson(jsonStr: string): {
        table: string; fields: string[]; records: Array<Record<string, any>>;
    } {
        const data = JSON.parse(jsonStr);
        const table = data.table ?? 'unknown';
        const records = data.records ?? [];
        const fields = records.length > 0 ? Object.keys(records[0]) : [];
        return { table, fields, records };
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    private static cosineSimilarity(a: number[], b: number[]): number {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
        }
        normA = Math.sqrt(normA); normB = Math.sqrt(normB);
        return normA === 0 || normB === 0 ? 0 : dot / (normA * normB);
    }
}
