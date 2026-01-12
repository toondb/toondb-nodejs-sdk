"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NativeBindings = void 0;
const koffi = require("koffi");
const library_finder_1 = require("./library-finder");
// Opaque pointer types
const DatabaseHandle = koffi.pointer('DatabaseHandle', koffi.opaque());
const IteratorHandle = koffi.pointer('IteratorHandle', koffi.opaque());
// Structs
const Stats = koffi.struct('Stats', {
    memtable_size_bytes: 'size_t',
    wal_size_bytes: 'size_t',
    active_transactions: 'uint32',
    min_active_snapshot: 'uint64',
    last_checkpoint_lsn: 'uint64'
});
const DatabaseConfig = koffi.struct('DatabaseConfig', {
    wal_enabled: 'bool',
    wal_enabled_set: 'bool',
    sync_mode: 'uint8',
    sync_mode_set: 'bool',
    memtable_size_bytes: 'uint64',
    group_commit: 'bool',
    group_commit_set: 'bool',
    default_index_policy: 'uint8',
    default_index_policy_set: 'bool'
});
const TxnHandle = koffi.struct('TxnHandle', {
    txn_id: 'uint64',
    snapshot_ts: 'uint64'
});
const CommitResult = koffi.struct('CommitResult', {
    commit_ts: 'uint64',
    error_code: 'int32'
});
class NativeBindings {
    constructor() {
        const libPath = (0, library_finder_1.findLibrary)();
        try {
            this.lib = koffi.load(libPath);
        }
        catch (error) {
            console.error(`Failed to load ToonDB library from ${libPath}:`, error);
            throw error;
        }
        // Initialize bindings
        // DB Management
        this.toondb_open = this.lib.func('toondb_open', DatabaseHandle, ['string']);
        this.toondb_open_with_config = this.lib.func('toondb_open_with_config', DatabaseHandle, ['string', DatabaseConfig]);
        this.toondb_close = this.lib.func('toondb_close', 'void', [DatabaseHandle]);
        // Transactions
        this.toondb_begin_txn = this.lib.func('toondb_begin_txn', TxnHandle, [DatabaseHandle]);
        this.toondb_commit = this.lib.func('toondb_commit', CommitResult, [DatabaseHandle, TxnHandle]);
        this.toondb_abort = this.lib.func('toondb_abort', 'int', [DatabaseHandle, TxnHandle]);
        // KV Operations
        this.toondb_put = this.lib.func('toondb_put', 'int', [DatabaseHandle, TxnHandle, 'uint8*', 'size_t', 'uint8*', 'size_t']);
        this.toondb_get = this.lib.func('toondb_get', 'int', [DatabaseHandle, TxnHandle, 'uint8*', 'size_t', koffi.out(koffi.pointer('uint8*')), koffi.out(koffi.pointer('size_t'))]);
        this.toondb_delete = this.lib.func('toondb_delete', 'int', [DatabaseHandle, TxnHandle, 'uint8*', 'size_t']);
        // Path Operations
        this.toondb_put_path = this.lib.func('toondb_put_path', 'int', [DatabaseHandle, TxnHandle, 'string', 'uint8*', 'size_t']);
        this.toondb_get_path = this.lib.func('toondb_get_path', 'int', [DatabaseHandle, TxnHandle, 'string', koffi.out(koffi.pointer('uint8*')), koffi.out(koffi.pointer('size_t'))]);
        // Scanning
        this.toondb_scan_prefix = this.lib.func('toondb_scan_prefix', IteratorHandle, [DatabaseHandle, TxnHandle, 'uint8*', 'size_t']);
        this.toondb_iterator_next = this.lib.func('toondb_scan_next', 'int', [IteratorHandle, koffi.out(koffi.pointer('uint8*')), koffi.out(koffi.pointer('size_t')), koffi.out(koffi.pointer('uint8*')), koffi.out(koffi.pointer('size_t'))]);
        this.toondb_iterator_close = this.lib.func('toondb_scan_free', 'void', [IteratorHandle]);
        // Stats & Checkpoint
        this.toondb_stats = this.lib.func('toondb_stats', Stats, [DatabaseHandle]);
        this.toondb_checkpoint = this.lib.func('toondb_checkpoint', 'int', [DatabaseHandle]);
        // Memory Management
        this.toondb_free_bytes = this.lib.func('toondb_free_bytes', 'void', ['uint8*', 'size_t']);
    }
    static getInstance() {
        if (!NativeBindings.instance) {
            NativeBindings.instance = new NativeBindings();
        }
        return NativeBindings.instance;
    }
}
exports.NativeBindings = NativeBindings;
