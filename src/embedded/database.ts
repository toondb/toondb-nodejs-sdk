/**
 * Embedded Database - FFI Mode
 * 
 * Direct FFI access to SochDB native library.
 * No server required - similar to Python SDK's Database class.
 */

import { DatabaseError } from '../errors';
import { NativeBindings } from './ffi/bindings';
import { EmbeddedTransaction } from './transaction';
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
}
