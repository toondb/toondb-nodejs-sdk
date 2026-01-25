/**
 * HNSW Vector Index FFI Bindings
 * 
 * Native vector search using HNSW (Hierarchical Navigable Small World) algorithm.
 * 
 * @see sochdb-index/src/ffi.rs
 */

import * as koffi from 'koffi';
import { findLibrary } from './library-finder';

// Opaque pointer type for HNSW Index
const HnswIndexPtr = koffi.pointer('HnswIndexPtr', koffi.opaque());

// Search result struct
const CSearchResult = koffi.struct('CSearchResult', {
    id_lo: 'uint64',
    id_hi: 'uint64',
    distance: 'float'
});

export interface SearchResult {
    id: string;
    distance: number;
}

export interface HnswConfig {
    dimension: number;
    maxConnections?: number;
    efConstruction?: number;
    efSearch?: number;
}

export class HnswBindings {
    private static instance: HnswBindings;
    private lib: any;

    // FFI functions
    public hnsw_new: any;
    public hnsw_free: any;
    public hnsw_insert: any;
    public hnsw_insert_batch: any;
    public hnsw_insert_flat: any;
    public hnsw_insert_batch_flat: any;
    public hnsw_search: any;
    public hnsw_search_fast: any;
    public hnsw_search_ultra: any;
    public hnsw_len: any;
    public hnsw_dimension: any;
    public hnsw_set_ef_search: any;
    public hnsw_get_ef_search: any;
    public hnsw_build_flat_cache: any;

    private constructor() {
        const libraryPath = findLibrary();
        this.lib = koffi.load(libraryPath);

        // Create a new HNSW index
        this.hnsw_new = this.lib.func('hnsw_new', HnswIndexPtr, ['size_t', 'size_t', 'size_t']);

        // Free an HNSW index
        this.hnsw_free = this.lib.func('hnsw_free', 'void', [HnswIndexPtr]);

        // Insert single vector
        this.hnsw_insert = this.lib.func('hnsw_insert', 'int', [HnswIndexPtr, 'uint64', 'float*', 'size_t']);

        // Insert batch of vectors
        this.hnsw_insert_batch = this.lib.func('hnsw_insert_batch', 'int', [
            HnswIndexPtr,
            'uint64*',
            'float*',
            'size_t',
            'size_t'
        ]);

        // Insert single flat vector (ID as u128)
        this.hnsw_insert_flat = this.lib.func('hnsw_insert_flat', 'int', [
            HnswIndexPtr,
            'uint64',
            'uint64',
            'float*',
            'size_t'
        ]);

        // Insert batch of flat vectors
        this.hnsw_insert_batch_flat = this.lib.func('hnsw_insert_batch_flat', 'int', [
            HnswIndexPtr,
            'uint64*',
            'uint64*',
            'float*',
            'size_t',
            'size_t'
        ]);

        // Search for k nearest neighbors
        this.hnsw_search = this.lib.func('hnsw_search', 'size_t', [
            HnswIndexPtr,
            'float*',
            'size_t',
            'size_t',
            koffi.out(koffi.array(CSearchResult, 1000)),
            'size_t'
        ]);

        // Fast search (lower ef_search)
        this.hnsw_search_fast = this.lib.func('hnsw_search_fast', 'size_t', [
            HnswIndexPtr,
            'float*',
            'size_t',
            'size_t',
            koffi.out(koffi.array(CSearchResult, 1000)),
            'size_t'
        ]);

        // Ultra fast search (minimal ef_search)
        this.hnsw_search_ultra = this.lib.func('hnsw_search_ultra', 'size_t', [
            HnswIndexPtr,
            'float*',
            'size_t',
            'size_t',
            koffi.out(koffi.array(CSearchResult, 1000)),
            'size_t'
        ]);

        // Get number of vectors in index
        this.hnsw_len = this.lib.func('hnsw_len', 'size_t', [HnswIndexPtr]);

        // Get vector dimension
        this.hnsw_dimension = this.lib.func('hnsw_dimension', 'size_t', [HnswIndexPtr]);

        // Set ef_search parameter
        this.hnsw_set_ef_search = this.lib.func('hnsw_set_ef_search', 'void', [HnswIndexPtr, 'size_t']);

        // Get ef_search parameter
        this.hnsw_get_ef_search = this.lib.func('hnsw_get_ef_search', 'size_t', [HnswIndexPtr]);

        // Build flat cache for faster search
        this.hnsw_build_flat_cache = this.lib.func('hnsw_build_flat_cache', 'int', [HnswIndexPtr]);
    }

    public static getInstance(): HnswBindings {
        if (!HnswBindings.instance) {
            HnswBindings.instance = new HnswBindings();
        }
        return HnswBindings.instance;
    }
}

/**
 * High-level HNSW Index wrapper
 */
export class HnswIndex {
    private ptr: any;
    private bindings: HnswBindings;
    private _dimension: number;
    private _efSearch: number;

    constructor(config: HnswConfig) {
        this.bindings = HnswBindings.getInstance();
        this._dimension = config.dimension;
        this._efSearch = config.efSearch || 100;

        const maxConnections = config.maxConnections || 16;
        const efConstruction = config.efConstruction || 200;

        this.ptr = this.bindings.hnsw_new(config.dimension, maxConnections, efConstruction);
        if (!this.ptr) {
            throw new Error('Failed to create HNSW index');
        }

        // Set ef_search if provided
        if (config.efSearch) {
            this.bindings.hnsw_set_ef_search(this.ptr, config.efSearch);
        }
    }

    /**
     * Insert a single vector
     */
    insert(id: string, vector: number[]): void {
        if (vector.length !== this._dimension) {
            throw new Error(`Vector dimension mismatch: expected ${this._dimension}, got ${vector.length}`);
        }

        // Convert string ID to uint64 (hash or parse)
        const numericId = this.stringToId(id);
        
        const vectorArray = new Float32Array(vector);
        const result = this.bindings.hnsw_insert(this.ptr, numericId, vectorArray, vector.length);
        
        if (result !== 0) {
            throw new Error(`Failed to insert vector: error code ${result}`);
        }
    }

    /**
     * Insert multiple vectors in batch (faster)
     */
    insertBatch(ids: string[], vectors: number[][]): void {
        if (ids.length !== vectors.length) {
            throw new Error('IDs and vectors length mismatch');
        }

        if (vectors.length === 0) {
            return;
        }

        // Validate dimensions
        for (const vector of vectors) {
            if (vector.length !== this._dimension) {
                throw new Error(`Vector dimension mismatch: expected ${this._dimension}, got ${vector.length}`);
            }
        }

        // Convert IDs to numeric
        const numericIds = new BigUint64Array(ids.map(id => BigInt(this.stringToId(id))));

        // Flatten vectors
        const flatVectors = new Float32Array(vectors.flat());

        const result = this.bindings.hnsw_insert_batch(
            this.ptr,
            numericIds,
            flatVectors,
            vectors.length,
            this._dimension
        );

        if (result !== 0) {
            throw new Error(`Failed to insert batch: error code ${result}`);
        }
    }

    /**
     * Search for k nearest neighbors
     */
    search(queryVector: number[], k: number, fast: boolean = false): SearchResult[] {
        if (queryVector.length !== this._dimension) {
            throw new Error(`Query vector dimension mismatch: expected ${this._dimension}, got ${queryVector.length}`);
        }

        const query = new Float32Array(queryVector);
        const resultsBuffer = new Array(k);

        const searchFn = fast ? this.bindings.hnsw_search_fast : this.bindings.hnsw_search;
        
        const numResults = searchFn(
            this.ptr,
            query,
            queryVector.length,
            k,
            resultsBuffer,
            k
        );

        // Convert results
        const results: SearchResult[] = [];
        for (let i = 0; i < numResults; i++) {
            const result = resultsBuffer[i];
            results.push({
                id: this.idToString(result.id_lo, result.id_hi),
                distance: result.distance
            });
        }

        return results;
    }

    /**
     * Ultra-fast search with minimal ef_search
     */
    searchUltra(queryVector: number[], k: number): SearchResult[] {
        if (queryVector.length !== this._dimension) {
            throw new Error(`Query vector dimension mismatch: expected ${this._dimension}, got ${queryVector.length}`);
        }

        const query = new Float32Array(queryVector);
        const resultsBuffer = new Array(k);

        const numResults = this.bindings.hnsw_search_ultra(
            this.ptr,
            query,
            queryVector.length,
            k,
            resultsBuffer,
            k
        );

        const results: SearchResult[] = [];
        for (let i = 0; i < numResults; i++) {
            const result = resultsBuffer[i];
            results.push({
                id: this.idToString(result.id_lo, result.id_hi),
                distance: result.distance
            });
        }

        return results;
    }

    /**
     * Get number of vectors in index
     */
    get length(): number {
        return this.bindings.hnsw_len(this.ptr);
    }

    /**
     * Get vector dimension
     */
    get dimension(): number {
        return this._dimension;
    }

    /**
     * Set ef_search parameter (controls search quality vs speed)
     */
    set efSearch(value: number) {
        this._efSearch = value;
        this.bindings.hnsw_set_ef_search(this.ptr, value);
    }

    /**
     * Get ef_search parameter
     */
    get efSearch(): number {
        return this.bindings.hnsw_get_ef_search(this.ptr);
    }

    /**
     * Build flat cache for faster searches
     */
    buildFlatCache(): void {
        const result = this.bindings.hnsw_build_flat_cache(this.ptr);
        if (result !== 0) {
            throw new Error(`Failed to build flat cache: error code ${result}`);
        }
    }

    /**
     * Free native resources
     */
    close(): void {
        if (this.ptr) {
            this.bindings.hnsw_free(this.ptr);
            this.ptr = null;
        }
    }

    // Helper: Convert string ID to numeric (simple hash)
    private stringToId(id: string): number {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = ((hash << 5) - hash) + id.charCodeAt(i);
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }

    // Helper: Convert numeric ID back to string
    private idToString(idLo: bigint, idHi: bigint): string {
        // For now, just use the low part
        return idLo.toString();
    }
}
