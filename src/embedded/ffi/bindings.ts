import * as koffi from 'koffi';
import { findLibrary } from './library-finder';

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

export class NativeBindings {
    private static instance: NativeBindings;
    private lib: any;

    // FFIs
    public sochdb_open: any;
    public sochdb_open_with_config: any;
    public sochdb_close: any;

    // Transactional Operations (mapped to base functions)
    public sochdb_begin_txn: any;
    public sochdb_commit: any;
    public sochdb_abort: any;

    // KV Operations (All take DatabaseHandle AND TxnHandle)
    // put: (db, txn, key, klen, val, vlen) -> int
    public sochdb_put: any;
    // get: (db, txn, key, klen, val_out*, len_out*) -> int
    public sochdb_get: any;
    // delete: (db, txn, key, klen) -> int
    public sochdb_delete: any;

    // Path Operations
    public sochdb_put_path: any;
    public sochdb_get_path: any;

    // Scanning
    public sochdb_scan_prefix: any;
    public sochdb_iterator_next: any;
    public sochdb_iterator_close: any;

    // Stats
    public sochdb_stats: any;
    public sochdb_checkpoint: any;

    // Memory
    public sochdb_free_bytes: any;

    private constructor() {
        const libPath = findLibrary();
        try {
            this.lib = koffi.load(libPath);
        } catch (error: any) {
            console.error(`Failed to load SochDB library from ${libPath}:`, error);
            throw error;
        }

        // Initialize bindings

        // DB Management
        this.sochdb_open = this.lib.func('sochdb_open', DatabaseHandle, ['string']);
        this.sochdb_open_with_config = this.lib.func('sochdb_open_with_config', DatabaseHandle, ['string', DatabaseConfig]);
        this.sochdb_close = this.lib.func('sochdb_close', 'void', [DatabaseHandle]);

        // Transactions
        this.sochdb_begin_txn = this.lib.func('sochdb_begin_txn', TxnHandle, [DatabaseHandle]);
        this.sochdb_commit = this.lib.func('sochdb_commit', CommitResult, [DatabaseHandle, TxnHandle]);
        this.sochdb_abort = this.lib.func('sochdb_abort', 'int', [DatabaseHandle, TxnHandle]);

        // KV Operations
        this.sochdb_put = this.lib.func('sochdb_put', 'int', [DatabaseHandle, TxnHandle, 'uint8*', 'size_t', 'uint8*', 'size_t']);
        this.sochdb_get = this.lib.func('sochdb_get', 'int', [DatabaseHandle, TxnHandle, 'uint8*', 'size_t', koffi.out(koffi.pointer('uint8*')), koffi.out(koffi.pointer('size_t'))]);
        this.sochdb_delete = this.lib.func('sochdb_delete', 'int', [DatabaseHandle, TxnHandle, 'uint8*', 'size_t']);

        // Path Operations
        this.sochdb_put_path = this.lib.func('sochdb_put_path', 'int', [DatabaseHandle, TxnHandle, 'string', 'uint8*', 'size_t']);
        this.sochdb_get_path = this.lib.func('sochdb_get_path', 'int', [DatabaseHandle, TxnHandle, 'string', koffi.out(koffi.pointer('uint8*')), koffi.out(koffi.pointer('size_t'))]);

        // Scanning
        this.sochdb_scan_prefix = this.lib.func('sochdb_scan_prefix', IteratorHandle, [DatabaseHandle, TxnHandle, 'uint8*', 'size_t']);
        this.sochdb_iterator_next = this.lib.func('sochdb_scan_next', 'int', [IteratorHandle, koffi.out(koffi.pointer('uint8*')), koffi.out(koffi.pointer('size_t')), koffi.out(koffi.pointer('uint8*')), koffi.out(koffi.pointer('size_t'))]);
        this.sochdb_iterator_close = this.lib.func('sochdb_scan_free', 'void', [IteratorHandle]);

        // Stats & Checkpoint
        this.sochdb_stats = this.lib.func('sochdb_stats', Stats, [DatabaseHandle]);
        this.sochdb_checkpoint = this.lib.func('sochdb_checkpoint', 'int', [DatabaseHandle]);

        // Memory Management
        this.sochdb_free_bytes = this.lib.func('sochdb_free_bytes', 'void', ['uint8*', 'size_t']);
    }

    public static getInstance(): NativeBindings {
        if (!NativeBindings.instance) {
            NativeBindings.instance = new NativeBindings();
        }
        return NativeBindings.instance;
    }
}
