/**
 * FFI Bindings to ToonDB Native Library
 * 
 * Low-level FFI bindings using node-ffi-napi.
 * Matches Python SDK's ctypes bindings for consistency.
 */

import ffi from 'ffi-napi';
import ref from 'ref-napi';
import StructType from 'ref-struct-napi';
import { findLibrary } from './library-finder';

// Type definitions
const voidPtr = ref.refType(ref.types.void);
const uint8Ptr = ref.refType(ref.types.uint8);
const uint8PtrPtr = ref.refType(uint8Ptr);
const size_tPtr = ref.refType(ref.types.size_t);

// C Structures
export const C_TxnHandle = StructType({
    txn_id: ref.types.uint64,
    snapshot_ts: ref.types.uint64,
});

export const C_CommitResult = StructType({
    commit_ts: ref.types.uint64,  // HLC timestamp, 0 on error
    error_code: ref.types.int32,  // 0=success, -1=error, -2=SSI conflict
});

export const C_StorageStats = StructType({
    memtable_size_bytes: ref.types.uint64,
    wal_size_bytes: ref.types.uint64,
    active_transactions: ref.types.size_t,
    min_active_snapshot: ref.types.uint64,
    last_checkpoint_lsn: ref.types.uint64,
});

export const C_SearchResult = StructType({
    id_ptr: ref.types.CString,
    score: ref.types.float,
    metadata_ptr: ref.types.CString,
});

/**
 * Load and bind the native library
 */
let _lib: any = null;

export function getLibrary() {
    if (_lib) {
        return _lib;
    }

    const libPath = findLibrary();
    console.log(`Loading ToonDB native library from: ${libPath}`);

    _lib = ffi.Library(libPath, {
        // Database lifecycle
        'toondb_open': [voidPtr, ['string']],
        'toondb_open_with_config': [voidPtr, ['string', C_CommitResult]], // Using struct as placeholder
        'toondb_close': ['void', [voidPtr]],

        // Transaction API
        'toondb_begin_txn': [C_TxnHandle, [voidPtr]],
        'toondb_commit': [C_CommitResult, [voidPtr, C_TxnHandle]],
        'toondb_abort': ['int', [voidPtr, C_TxnHandle]],

        // Key-Value API
        'toondb_put': ['int', [voidPtr, C_TxnHandle, uint8Ptr, 'size_t', uint8Ptr, 'size_t']],
        'toondb_get': ['int', [voidPtr, C_TxnHandle, uint8Ptr, 'size_t', uint8PtrPtr, size_tPtr]],
        'toondb_delete': ['int', [voidPtr, C_TxnHandle, uint8Ptr, 'size_t']],
        'toondb_free_bytes': ['void', [uint8Ptr, 'size_t']],

        // Path API
        'toondb_put_path': ['int', [voidPtr, C_TxnHandle, 'string', uint8Ptr, 'size_t']],
        'toondb_get_path': ['int', [voidPtr, C_TxnHandle, 'string', uint8PtrPtr, size_tPtr]],

        // Scan API
        'toondb_scan': [voidPtr, [voidPtr, C_TxnHandle, uint8Ptr, 'size_t', uint8Ptr, 'size_t']],
        'toondb_scan_next': ['int', [voidPtr, uint8PtrPtr, size_tPtr, uint8PtrPtr, size_tPtr]],
        'toondb_scan_free': ['void', [voidPtr]],
        'toondb_scan_prefix': [voidPtr, [voidPtr, C_TxnHandle, uint8Ptr, 'size_t']],

        // Checkpoint & Stats
        'toondb_checkpoint': ['uint64', [voidPtr]],
        'toondb_stats': [C_StorageStats, [voidPtr]],

        // Index Policy
        'toondb_set_table_index_policy': ['int', [voidPtr, 'string', 'uint8']],
        'toondb_get_table_index_policy': ['uint8', [voidPtr, 'string']],
    });

    // Try to load optional functions (may not be in all library versions)
    try {
        const dynLib = new ffi.DynamicLibrary(libPath);

        // Graph Overlay API
        _lib.toondb_graph_add_node = ffi.ForeignFunction(
            dynLib.get('toondb_graph_add_node'),
            'int', [voidPtr, 'string', 'string', 'string', 'string']
        );
        _lib.toondb_graph_add_edge = ffi.ForeignFunction(
            dynLib.get('toondb_graph_add_edge'),
            'int', [voidPtr, 'string', 'string', 'string', 'string', 'string']
        );
        _lib.toondb_graph_traverse = ffi.ForeignFunction(
            dynLib.get('toondb_graph_traverse'),
            voidPtr, [voidPtr, 'string', 'string', 'size_t', 'int', size_tPtr]
        );
    } catch (e) {
        // Graph functions not available in this library version
    }

    return _lib;
}

/**
 * Helper to convert Buffer to uint8_t pointer
 */
export function bufferToPtr(buf: Buffer): any {
    if (buf.length === 0) {
        return ref.NULL;
    }
    return buf;
}

/**
 * Helper to convert uint8_t pointer + length to Buffer
 */
export function ptrToBuffer(ptr: any, len: number): Buffer {
    if (ptr.isNull() || len === 0) {
        return Buffer.alloc(0);
    }
    return ref.reinterpret(ptr, len);
}
