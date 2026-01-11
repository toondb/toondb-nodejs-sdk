/**
 * Embedded Database - FFI Mode
 * 
 * Direct FFI access to ToonDB native library.
 * No server required - similar to Python SDK's Database class.
 */

import * as ref from 'ref-napi';
import { DatabaseError, TransactionError } from '../errors';
import { getLibrary, C_TxnHandle, bufferToPtr, ptrToBuffer } from './ffi/bindings';
import { EmbeddedTransaction } from './transaction';

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
 * import { EmbeddedDatabase } from '@sushanth/toondb';
 * 
 * const db = await EmbeddedDatabase.open('./mydb');
 * await db.put(Buffer.from('key'), Buffer.from('value'));
 * const value = await db.get(Buffer.from('key'));
 * await db.close();
 * ```
 */
export class EmbeddedDatabase {
    private handle: any;
    private lib: any;
    private closed = false;
    private path: string;

    private constructor(path: string, handle: any) {
        this.path = path;
        this.handle = handle;
        this.lib = getLibrary();
    }

    /**
     * Open a database at the specified path
     * 
     * @param path - Path to database directory
     * @param config - Optional configuration
     * @returns EmbeddedDatabase instance
     */
    static open(path: string, config?: EmbeddedDatabaseConfig): EmbeddedDatabase {
        const lib = getLibrary();

        // For now, use simple open (config support can be added later)
        const handle = lib.toondb_open(path);

        if (handle.isNull()) {
            throw new DatabaseError(`Failed to open database at ${path}`);
        }

        return new EmbeddedDatabase(path, handle);
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

        const txnHandle = this.lib.toondb_begin_txn(this.handle);
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
        const lsn = this.lib.toondb_checkpoint(this.handle);
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

        const stats = this.lib.toondb_stats(this.handle);
        return {
            memtableSizeBytes: BigInt(stats.memtable_size_bytes),
            walSizeBytes: BigInt(stats.wal_size_bytes),
            activeTransactions: stats.active_transactions,
            minActiveSnapshot: BigInt(stats.min_active_snapshot),
            lastCheckpointLsn: BigInt(stats.last_checkpoint_lsn),
        };
    }

    /**
     * Close the database
     */
    close(): void {
        if (!this.closed) {
            this.lib.toondb_close(this.handle);
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
     * Get library instance (for transactions)
     * @internal
     */
    getLib(): any {
        return this.lib;
    }
}
