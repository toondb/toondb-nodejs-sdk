"use strict";
/**
 * Embedded Database - FFI Mode
 *
 * Direct FFI access to ToonDB native library.
 * No server required - similar to Python SDK's Database class.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddedDatabase = void 0;
const errors_1 = require("../errors");
const bindings_1 = require("./ffi/bindings");
const transaction_1 = require("./transaction");
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
class EmbeddedDatabase {
    constructor(path, handle) {
        this.closed = false;
        this.path = path;
        this.handle = handle;
        this.bindings = bindings_1.NativeBindings.getInstance();
    }
    /**
     * Open a database at the specified path
     *
     * @param path - Path to database directory
     * @param config - Optional configuration
     * @returns EmbeddedDatabase instance
     */
    static open(path, config) {
        const bindings = bindings_1.NativeBindings.getInstance();
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
            handle = bindings.toondb_open_with_config(path, cConfig);
        }
        else {
            handle = bindings.toondb_open(path);
        }
        if (!handle) {
            throw new errors_1.DatabaseError(`Failed to open database at ${path}`);
        }
        return new EmbeddedDatabase(path, handle);
    }
    /**
     * Put a key-value pair (auto-transaction)
     */
    async put(key, value) {
        this.ensureOpen();
        const txn = this.transaction();
        try {
            await txn.put(key, value);
            await txn.commit();
        }
        catch (error) {
            await txn.abort();
            throw error;
        }
    }
    /**
     * Get a value by key (auto-transaction)
     */
    async get(key) {
        this.ensureOpen();
        const txn = this.transaction();
        try {
            const value = await txn.get(key);
            await txn.commit();
            return value;
        }
        catch (error) {
            await txn.abort();
            throw error;
        }
    }
    /**
     * Delete a key (auto-transaction)
     */
    async delete(key) {
        this.ensureOpen();
        const txn = this.transaction();
        try {
            await txn.delete(key);
            await txn.commit();
        }
        catch (error) {
            await txn.abort();
            throw error;
        }
    }
    /**
     * Put value at path (auto-transaction)
     */
    async putPath(path, value) {
        this.ensureOpen();
        const txn = this.transaction();
        try {
            await txn.putPath(path, value);
            await txn.commit();
        }
        catch (error) {
            await txn.abort();
            throw error;
        }
    }
    /**
     * Get value at path (auto-transaction)
     */
    async getPath(path) {
        this.ensureOpen();
        const txn = this.transaction();
        try {
            const value = await txn.getPath(path);
            await txn.commit();
            return value;
        }
        catch (error) {
            await txn.abort();
            throw error;
        }
    }
    /**
     * Scan keys with prefix
     */
    async *scanPrefix(prefix) {
        this.ensureOpen();
        const txn = this.transaction();
        try {
            for await (const entry of txn.scanPrefix(prefix)) {
                yield entry;
            }
            await txn.commit();
        }
        catch (error) {
            await txn.abort();
            throw error;
        }
    }
    /**
     * Begin a transaction
     */
    transaction() {
        this.ensureOpen();
        const txnHandle = this.bindings.toondb_begin_txn(this.handle);
        return new transaction_1.EmbeddedTransaction(this, this.handle, txnHandle);
    }
    /**
     * Execute operations within a transaction (with auto-commit/abort)
     */
    async withTransaction(fn) {
        const txn = this.transaction();
        try {
            const result = await fn(txn);
            await txn.commit();
            return result;
        }
        catch (error) {
            await txn.abort();
            throw error;
        }
    }
    /**
     * Force a checkpoint
     */
    async checkpoint() {
        this.ensureOpen();
        const lsn = this.bindings.toondb_checkpoint(this.handle);
        return BigInt(lsn);
    }
    /**
     * Get storage statistics
     */
    async stats() {
        this.ensureOpen();
        // Returns struct by value (automatically decoded)
        const stats = this.bindings.toondb_stats(this.handle);
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
    close() {
        if (!this.closed) {
            this.bindings.toondb_close(this.handle);
            this.closed = true;
        }
    }
    ensureOpen() {
        if (this.closed) {
            throw new errors_1.DatabaseError('Database is closed');
        }
    }
    /**
     * Get internal handle (for transactions)
     * @internal
     */
    getHandle() {
        return this.handle;
    }
    /**
     * Get bindings instance (for transactions)
     * @internal
     */
    getBindings() {
        return this.bindings;
    }
}
exports.EmbeddedDatabase = EmbeddedDatabase;
