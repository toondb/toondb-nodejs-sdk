"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddedTransaction = void 0;
const errors_1 = require("../errors");
const bindings_1 = require("./ffi/bindings");
const koffi = require("koffi");
class EmbeddedTransaction {
    constructor(db, dbHandle, txnHandle) {
        this.committed = false;
        this.aborted = false;
        this.db = db;
        this.dbHandle = dbHandle;
        this.txnHandle = txnHandle;
        this.bindings = bindings_1.NativeBindings.getInstance();
    }
    async put(key, value) {
        this.ensureActive();
        const res = this.bindings.toondb_put(this.dbHandle, this.txnHandle, key, key.length, value, value.length);
        if (res !== 0) {
            throw new errors_1.DatabaseError('Failed to put value');
        }
    }
    async get(key) {
        this.ensureActive();
        const outPtr = [null];
        const outLen = [0];
        // returns 0 on success, 1 on not found, -1 on error
        const res = this.bindings.toondb_get(this.dbHandle, this.txnHandle, key, key.length, outPtr, outLen);
        if (res === 1) { // Not found
            return null;
        }
        if (res !== 0) {
            throw new errors_1.DatabaseError('Failed to get value');
        }
        // Copy buffer
        const ptr = outPtr[0];
        const len = outLen[0];
        const buffer = Buffer.from(koffi.decode(ptr, 'uint8', len));
        // Free native memory
        this.bindings.toondb_free_bytes(ptr, len);
        return buffer;
    }
    async delete(key) {
        this.ensureActive();
        const res = this.bindings.toondb_delete(this.dbHandle, this.txnHandle, key, key.length);
        if (res !== 0) {
            throw new errors_1.DatabaseError('Failed to delete value');
        }
    }
    async putPath(path, value) {
        this.ensureActive();
        const res = this.bindings.toondb_put_path(this.dbHandle, this.txnHandle, path, value, value.length);
        if (res !== 0) {
            throw new errors_1.DatabaseError('Failed to put path');
        }
    }
    async getPath(path) {
        this.ensureActive();
        const outPtr = [null];
        const outLen = [0];
        const res = this.bindings.toondb_get_path(this.dbHandle, this.txnHandle, path, outPtr, outLen);
        if (res === 1) {
            return null;
        }
        if (res !== 0) {
            throw new errors_1.DatabaseError('Failed to get path');
        }
        const ptr = outPtr[0];
        const len = outLen[0];
        const buffer = Buffer.from(koffi.decode(ptr, 'uint8', len));
        this.bindings.toondb_free_bytes(ptr, len);
        return buffer;
    }
    async *scanPrefix(prefix) {
        this.ensureActive();
        const iter = this.bindings.toondb_scan_prefix(this.dbHandle, this.txnHandle, prefix, prefix.length);
        if (!iter)
            return;
        try {
            const keyPtr = [null];
            const keyLen = [0];
            const valPtr = [null];
            const valLen = [0];
            while (true) {
                // Returns 0 on success, 1 on done, -1 on error
                const res = this.bindings.toondb_iterator_next(iter, keyPtr, keyLen, valPtr, valLen);
                if (res === 1)
                    break; // Done
                if (res !== 0)
                    throw new errors_1.DatabaseError('Scan failed');
                // Decode key
                const k = Buffer.from(koffi.decode(keyPtr[0], 'uint8', keyLen[0]));
                // koffi automatically handles pointers, but here we received a pointer value into keyPtr[0]
                // Wait, keyPtr is passed as out(pointer(uint8*)).
                // So keyPtr[0] IS the pointer.
                // Rust scan_next allocates new boxed slices for key and value?
                // Yes: `let mut key_buf = key.into_boxed_slice();`
                // So we own it and must free it?
                // `let _ = Box::into_raw(key_buf);` -> leaks.
                // But `toondb_scan_next` doesn't seem to export a free function for these individual items?
                // Wait, `toondb_scan_next` returns them. Does the caller free them?
                // Usually yes. `NativeBindings` has `toondb_free_bytes`.
                this.bindings.toondb_free_bytes(keyPtr[0], keyLen[0]);
                // Decode value 
                const v = Buffer.from(koffi.decode(valPtr[0], 'uint8', valLen[0]));
                this.bindings.toondb_free_bytes(valPtr[0], valLen[0]);
                yield [k, v];
            }
        }
        finally {
            this.bindings.toondb_iterator_close(iter);
        }
    }
    async commit() {
        this.ensureActive();
        const result = this.bindings.toondb_commit(this.dbHandle, this.txnHandle);
        this.committed = true;
        if (result.error_code !== 0) {
            // -1 indicates error, -2 indicates SSI conflict
            throw new errors_1.TransactionError(`Transaction failed to commit (Code ${result.error_code})`);
        }
    }
    async abort() {
        if (!this.isActive())
            return;
        this.bindings.toondb_abort(this.dbHandle, this.txnHandle);
        this.aborted = true;
    }
    isActive() {
        return !this.committed && !this.aborted;
    }
    ensureActive() {
        if (!this.isActive()) {
            throw new errors_1.TransactionError('Transaction is no longer active');
        }
    }
}
exports.EmbeddedTransaction = EmbeddedTransaction;
