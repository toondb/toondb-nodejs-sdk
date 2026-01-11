/**
 * Embedded Transaction - FFI Mode
 * 
 * Transaction implementation using direct FFI calls.
 */

import * as ref from 'ref-napi';
import { TransactionError, DatabaseError } from '../errors';
import { getLibrary, C_TxnHandle, bufferToPtr, ptrToBuffer } from './ffi/bindings';

/**
 * Transaction for embedded database
 */
export class EmbeddedTransaction {
    private db: any;  // EmbeddedDatabase instance
    private dbHandle: any;
    private txnHandle: any;
    private lib: any;
    private committed = false;
    private aborted = false;

    constructor(db: any, dbHandle: any, txnHandle: any) {
        this.db = db;
        this.dbHandle = dbHandle;
        this.txnHandle = txnHandle;
        this.lib = getLibrary();
    }

    /**
     * Get transaction ID
     */
    get id(): bigint {
        return BigInt(this.txnHandle.txn_id);
    }

    /**
     * Put a key-value pair
     */
    async put(key: Buffer, value: Buffer): Promise<void> {
        this.ensureActive();

        const keyPtr = bufferToPtr(key);
        const valuePtr = bufferToPtr(value);

        const result = this.lib.toondb_put(
            this.dbHandle,
            this.txnHandle,
            keyPtr,
            key.length,
            valuePtr,
            value.length
        );

        if (result !== 0) {
            throw new DatabaseError('Failed to put value');
        }
    }

    /**
     * Get a value by key
     */
    async get(key: Buffer): Promise<Buffer | null> {
        this.ensureActive();

        const keyPtr = bufferToPtr(key);
        const valueOut = ref.alloc(ref.refType(ref.types.uint8));
        const lenOut = ref.alloc(ref.types.size_t);

        const result = this.lib.toondb_get(
            this.dbHandle,
            this.txnHandle,
            keyPtr,
            key.length,
            valueOut,
            lenOut
        );

        if (result === 1) {
            // Not found
            return null;
        } else if (result !== 0) {
            throw new DatabaseError('Failed to get value');
        }

        const valuePtr = valueOut.deref();
        const valueLen = lenOut.deref();

        if (valuePtr.isNull() || valueLen === 0) {
            return null;
        }

        // Copy data to Buffer
        const data = ptrToBuffer(valuePtr, valueLen);
        const resultBuffer = Buffer.from(data);

        // Free Rust memory
        this.lib.toondb_free_bytes(valuePtr, valueLen);

        return resultBuffer;
    }

    /**
     * Delete a key
     */
    async delete(key: Buffer): Promise<void> {
        this.ensureActive();

        const keyPtr = bufferToPtr(key);

        const result = this.lib.toondb_delete(
            this.dbHandle,
            this.txnHandle,
            keyPtr,
            key.length
        );

        if (result !== 0) {
            throw new DatabaseError('Failed to delete key');
        }
    }

    /**
     * Put value at path
     */
    async putPath(path: string, value: Buffer): Promise<void> {
        this.ensureActive();

        const valuePtr = bufferToPtr(value);

        const result = this.lib.toondb_put_path(
            this.dbHandle,
            this.txnHandle,
            path,
            valuePtr,
            value.length
        );

        if (result !== 0) {
            throw new DatabaseError('Failed to put path');
        }
    }

    /**
     * Get value at path
     */
    async getPath(path: string): Promise<Buffer | null> {
        this.ensureActive();

        const valueOut = ref.alloc(ref.refType(ref.types.uint8));
        const lenOut = ref.alloc(ref.types.size_t);

        const result = this.lib.toondb_get_path(
            this.dbHandle,
            this.txnHandle,
            path,
            valueOut,
            lenOut
        );

        if (result === 1) {
            return null;
        } else if (result !== 0) {
            throw new DatabaseError('Failed to get path');
        }

        const valuePtr = valueOut.deref();
        const valueLen = lenOut.deref();

        if (valuePtr.isNull() || valueLen === 0) {
            return null;
        }

        const data = ptrToBuffer(valuePtr, valueLen);
        const resultBuffer = Buffer.from(data);

        this.lib.toondb_free_bytes(valuePtr, valueLen);

        return resultBuffer;
    }

    /**
     * Scan keys with prefix
     */
    async *scanPrefix(prefix: Buffer): AsyncGenerator<[Buffer, Buffer]> {
        this.ensureActive();

        const prefixPtr = bufferToPtr(prefix);

        const iterPtr = this.lib.toondb_scan_prefix(
            this.dbHandle,
            this.txnHandle,
            prefixPtr,
            prefix.length
        );

        if (iterPtr.isNull()) {
            return;
        }

        try {
            const keyOut = ref.alloc(ref.refType(ref.types.uint8));
            const keyLenOut = ref.alloc(ref.types.size_t);
            const valueOut = ref.alloc(ref.refType(ref.types.uint8));
            const valueLenOut = ref.alloc(ref.types.size_t);

            while (true) {
                const result = this.lib.toondb_scan_next(
                    iterPtr,
                    keyOut,
                    keyLenOut,
                    valueOut,
                    valueLenOut
                );

                if (result === 1) {
                    // End of scan
                    break;
                } else if (result !== 0) {
                    throw new DatabaseError('Scan failed');
                }

                const keyPtr = keyOut.deref();
                const keyLen = keyLenOut.deref();
                const valPtr = valueOut.deref();
                const valLen = valueLenOut.deref();

                // Copy data
                const key = Buffer.from(ptrToBuffer(keyPtr, keyLen));
                const value = Buffer.from(ptrToBuffer(valPtr, valLen));

                // Free Rust memory
                this.lib.toondb_free_bytes(keyPtr, keyLen);
                this.lib.toondb_free_bytes(valPtr, valLen);

                yield [key, value];
            }
        } finally {
            this.lib.toondb_scan_free(iterPtr);
        }
    }

    /**
     * Commit the transaction
     */
    async commit(): Promise<bigint> {
        this.ensureActive();

        const result = this.lib.toondb_commit(this.dbHandle, this.txnHandle);

        if (result.error_code !== 0) {
            if (result.error_code === -2) {
                throw new TransactionError('SSI conflict: transaction aborted due to serialization failure');
            }
            throw new TransactionError('Failed to commit transaction');
        }

        this.committed = true;
        return BigInt(result.commit_ts);
    }

    /**
     * Abort the transaction
     */
    async abort(): Promise<void> {
        if (this.committed || this.aborted) {
            return;
        }

        this.lib.toondb_abort(this.dbHandle, this.txnHandle);
        this.aborted = true;
    }

    private ensureActive(): void {
        if (this.committed) {
            throw new TransactionError('Transaction already committed');
        }
        if (this.aborted) {
            throw new TransactionError('Transaction already aborted');
        }
    }
}
