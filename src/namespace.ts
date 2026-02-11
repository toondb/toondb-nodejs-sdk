/**
 * SochDB Namespace API
 * 
 * Provides type-safe namespace isolation with first-class namespace handles.
 * 
 * @example
 * ```typescript
 * import { Database } from '@sochdb/sochdb';
 * 
 * const db = await Database.open('./mydb');
 * const ns = await db.createNamespace('tenant_123');
 * const collection = await ns.createCollection('documents', { dimension: 384 });
 * await collection.insert([1.0, 2.0, ...], { source: 'web' });
 * const results = await collection.search(queryVector, 10);
 * ```
 */

import { SochDBError, DatabaseError } from './errors';

// ============================================================================
// Native HNSW FFI Bindings (for high-performance batch insert and search)
// ============================================================================

interface NativeHnswBindings {
  lib: any;
  koffi: any;
  HnswIndexPtr: any;
  CSearchResultStruct: any;
  hnsw_new: (dimension: number, maxConnections: number, efConstruction: number) => any;
  hnsw_free: (ptr: any) => void;
  hnsw_insert_batch: (ptr: any, ids: BigUint64Array, vectors: Float32Array, numVectors: number, dimension: number) => number;
  hnsw_len: (ptr: any) => number;
  hnsw_set_ef_search: (ptr: any, efSearch: number) => void;
  hnsw_search: (ptr: any, query: Float32Array, queryLen: number, k: number, resultsOut: Buffer, numResultsOut: Buffer) => number;
}

let NativeHnsw: NativeHnswBindings | null = null;
try {
  const koffi = require('koffi');
  const { findLibrary } = require('./embedded/ffi/library-finder');
  const libraryPath = findLibrary();
  const lib = koffi.load(libraryPath);
  
  // Define opaque pointer
  const HnswIndexPtr = koffi.pointer('HnswIndexPtr3', koffi.opaque());
  
  // Define CSearchResult struct for native search
  const CSearchResultStruct = koffi.struct('CSearchResult3', {
    id_lo: 'uint64',
    id_hi: 'uint64', 
    distance: 'float'
  });
  
  NativeHnsw = {
    lib,
    koffi,
    HnswIndexPtr,
    CSearchResultStruct,
    hnsw_new: lib.func('hnsw_new', HnswIndexPtr, ['size_t', 'size_t', 'size_t']),
    hnsw_free: lib.func('hnsw_free', 'void', [HnswIndexPtr]),
    hnsw_insert_batch: lib.func('hnsw_insert_batch', 'int', [
      HnswIndexPtr,
      'uint64*',  // ids
      'float*',   // vectors (flat)
      'size_t',   // num_vectors
      'size_t'    // dimension
    ]),
    hnsw_len: lib.func('hnsw_len', 'size_t', [HnswIndexPtr]),
    hnsw_set_ef_search: lib.func('hnsw_set_ef_search', 'void', [HnswIndexPtr, 'size_t']),
    hnsw_search: lib.func('hnsw_search', 'int', [
      HnswIndexPtr,
      'float*',   // query vector
      'size_t',   // query_len
      'size_t',   // k
      koffi.pointer(CSearchResultStruct),  // results_out pointer
      koffi.pointer('size_t')  // num_results_out pointer
    ]),
  };
  console.log('[SochDB] Native HNSW bindings loaded (batch insert + search)');
} catch (e: any) {
  // Native bindings not available - will use JS fallback
  NativeHnsw = null;
}

// ============================================================================
// Namespace Configuration
// ============================================================================

export interface NamespaceConfig {
  name: string;
  displayName?: string;
  labels?: Record<string, string>;
  readOnly?: boolean;
}

export class NamespaceNotFoundError extends SochDBError {
  constructor(namespace: string) {
    super(`Namespace not found: ${namespace}`);
    this.name = 'NamespaceNotFoundError';
  }
}

export class NamespaceExistsError extends SochDBError {
  constructor(namespace: string) {
    super(`Namespace already exists: ${namespace}`);
    this.name = 'NamespaceExistsError';
  }
}

export class CollectionNotFoundError extends SochDBError {
  constructor(collection: string) {
    super(`Collection not found: ${collection}`);
    this.name = 'CollectionNotFoundError';
  }
}

export class CollectionExistsError extends SochDBError {
  constructor(collection: string) {
    super(`Collection already exists: ${collection}`);
    this.name = 'CollectionExistsError';
  }
}

// ============================================================================
// Collection Configuration
// ============================================================================

export enum DistanceMetric {
  Cosine = 'cosine',
  Euclidean = 'euclidean',
  DotProduct = 'dot',
}

export interface CollectionConfig {
  name: string;
  dimension?: number;
  metric?: DistanceMetric;
  indexed?: boolean;
  hnswM?: number;
  hnswEfConstruction?: number;
  metadata?: Record<string, any>;
}

export interface SearchRequest {
  queryVector: number[];
  k: number;
  filter?: Record<string, any>;
  includeMetadata?: boolean;
}

export interface SearchResult {
  id: string;
  score: number;
  vector?: number[];
  metadata?: Record<string, any>;
}

// ============================================================================
// Collection Handle
// ============================================================================

/**
 * In-memory vector index for synchronous search
 * Uses a simple but efficient approach for small-medium datasets
 */
class VectorIndex {
  private vectors: Map<string, { vector: number[]; metadata?: Record<string, any> }> = new Map();
  private dimension: number;
  private metric: DistanceMetric;

  constructor(dimension: number, metric: DistanceMetric = DistanceMetric.Cosine) {
    this.dimension = dimension;
    this.metric = metric;
  }

  add(id: string, vector: number[], metadata?: Record<string, any>): void {
    if (vector.length !== this.dimension) {
      throw new Error(`Vector dimension mismatch: expected ${this.dimension}, got ${vector.length}`);
    }
    this.vectors.set(id, { vector, metadata });
  }

  remove(id: string): void {
    this.vectors.delete(id);
  }

  search(queryVector: number[], k: number, filter?: Record<string, any>): SearchResult[] {
    const results: SearchResult[] = [];

    for (const [id, data] of this.vectors) {
      // Apply metadata filter if provided
      if (filter && !this.matchesFilter(data.metadata, filter)) {
        continue;
      }

      const score = this.calculateSimilarity(queryVector, data.vector);
      results.push({
        id,
        score,
        vector: data.vector,
        metadata: data.metadata,
      });
    }

    // Sort by score (higher is better for similarity)
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, k);
  }

  size(): number {
    return this.vectors.size;
  }

  private calculateSimilarity(a: number[], b: number[]): number {
    switch (this.metric) {
      case DistanceMetric.Cosine:
        return this.cosineSimilarity(a, b);
      case DistanceMetric.Euclidean:
        return 1 / (1 + this.euclideanDistance(a, b));
      case DistanceMetric.DotProduct:
        return this.dotProduct(a, b);
      default:
        return this.cosineSimilarity(a, b);
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  private dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  private matchesFilter(metadata: Record<string, any> | undefined, filter: Record<string, any>): boolean {
    if (!metadata) return false;
    
    for (const [key, value] of Object.entries(filter)) {
      if (metadata[key] !== value) {
        return false;
      }
    }
    return true;
  }
}

export class Collection {
  private vectorIndex: VectorIndex;
  private nativeIndexPtr: any = null;
  private _indexReady = false;
  private nativeIdCounter = 0;  // Counter for native HNSW numeric IDs
  private nativeIdToStringId = new Map<number, string>();  // Map numeric ID -> string ID

  constructor(
    private db: any,
    private namespace: string,
    private name: string,
    private config: CollectionConfig
  ) {
    this.vectorIndex = new VectorIndex(
      config.dimension || 384,
      config.metric || DistanceMetric.Cosine
    );
    
    // Try to create native HNSW index for high-performance operations
    if (NativeHnsw) {
      try {
        const dimension = config.dimension || 384;
        const maxConnections = config.hnswM || 16;
        const efConstruction = config.hnswEfConstruction || 100;
        this.nativeIndexPtr = NativeHnsw.hnsw_new(dimension, maxConnections, efConstruction);
        if (this.nativeIndexPtr) {
          // Set high ef_search for good recall (can be tuned via setEfSearch)
          NativeHnsw.hnsw_set_ef_search(this.nativeIndexPtr, 500);
          console.log(`[SochDB] Native HNSW index created: dim=${dimension}, M=${maxConnections}, efC=${efConstruction}, efS=500`);
        }
      } catch (e: any) {
        console.warn('[SochDB] Native HNSW creation failed:', e.message);
        this.nativeIndexPtr = null;
      }
    }
  }

  /**
   * Set ef_search parameter for HNSW search (controls recall vs speed tradeoff)
   * Higher values = better recall but slower search
   * @param efSearch - Typically 100-1000, default is 500
   */
  setEfSearch(efSearch: number): void {
    if (NativeHnsw && this.nativeIndexPtr) {
      NativeHnsw.hnsw_set_ef_search(this.nativeIndexPtr, efSearch);
    }
  }

  /**
   * Insert a vector with optional metadata
   * Vector is immediately indexed (synchronous)
   */
  async insert(
    vector: number[],
    metadata?: Record<string, any>,
    id?: string
  ): Promise<string> {
    if (this.config.dimension && vector.length !== this.config.dimension) {
      throw new DatabaseError(
        `Vector dimension mismatch: expected ${this.config.dimension}, got ${vector.length}`
      );
    }

    const vectorId = id || this.generateId();
    const key = this.vectorKey(vectorId);
    
    const data = {
      vector,
      metadata: metadata || {},
      timestamp: Date.now(),
    };

    // Store to database
    await this.db.put(Buffer.from(key), Buffer.from(JSON.stringify(data)));
    
    // SYNCHRONOUSLY add to in-memory index
    this.vectorIndex.add(vectorId, vector, metadata);
    
    // Also add to native HNSW index if available (for single inserts)
    if (NativeHnsw && this.nativeIndexPtr) {
      try {
        const dimension = this.config.dimension || vector.length;
        // Use auto-incrementing counter for native HNSW (it needs numeric IDs)
        const numericId = this.nativeIdCounter++;
        this.nativeIdToStringId.set(numericId, vectorId);  // Store mapping
        const idArray = new BigUint64Array([BigInt(numericId)]);
        const vectorArray = new Float32Array(vector);
        // Args: ptr, ids, vectors, num_vectors, dimension
        NativeHnsw.hnsw_insert_batch(this.nativeIndexPtr, idArray, vectorArray, 1, dimension);
      } catch (e) {
        // Fallback to JS index only (already added above)
      }
    }

    return vectorId;
  }

  /**
   * Insert multiple vectors using NATIVE HNSW batch insert when available
   * This is the OPTIMIZED path - uses FFI batch insert for ~100x speedup
   */
  async insertMany(
    vectors: number[][],
    metadatas?: Record<string, any>[],
    ids?: string[]
  ): Promise<string[]> {
    if (vectors.length === 0) {
      return [];
    }
    
    const resultIds = ids || vectors.map((_, i) => i.toString());
    const dimension = this.config.dimension || vectors[0].length;
    
    // If native index is available, use batch insert
    if (NativeHnsw && this.nativeIndexPtr) {
      try {
        console.log(`[SochDB] Using NATIVE batch insert for ${vectors.length} vectors...`);
        const startTime = performance.now();
        
        // Convert IDs to numeric (u64) using counter and store mapping
        const numericIds = new BigUint64Array(resultIds.length);
        for (let i = 0; i < resultIds.length; i++) {
          const numericId = this.nativeIdCounter++;
          numericIds[i] = BigInt(numericId);
          this.nativeIdToStringId.set(numericId, resultIds[i]);
        }
        
        // Flatten vectors into contiguous Float32Array
        const flatVectors = new Float32Array(vectors.length * dimension);
        for (let i = 0; i < vectors.length; i++) {
          flatVectors.set(vectors[i], i * dimension);
        }
        
        // Single FFI call to native batch insert
        const result = NativeHnsw.hnsw_insert_batch(
          this.nativeIndexPtr,
          numericIds,
          flatVectors,
          vectors.length,
          dimension
        );
        
        const elapsed = (performance.now() - startTime) / 1000;
        const indexSize = NativeHnsw.hnsw_len(this.nativeIndexPtr);
        console.log(`[SochDB] Native batch insert: result=${result}, index_size=${indexSize}, time=${elapsed.toFixed(3)}s (${(vectors.length/elapsed).toFixed(0)} vec/sec)`);
        
        if (result < 0) {
          throw new Error(`Native batch insert failed with error code ${result}`);
        }
        
        // Also add to JS index for metadata lookups
        for (let i = 0; i < resultIds.length; i++) {
          this.vectorIndex.add(resultIds[i], vectors[i], metadatas ? metadatas[i] : undefined);
        }
        
        return resultIds;
      } catch (e: any) {
        console.warn('[SochDB] Native batch insert failed, falling back to sequential:', e.message);
      }
    }
    
    // Fallback: sequential insert (slow path)
    console.log(`[SochDB] Using SEQUENTIAL insert for ${vectors.length} vectors (slow path)...`);
    for (let i = 0; i < vectors.length; i++) {
      const id = resultIds[i];
      const metadata = metadatas ? metadatas[i] : undefined;
      await this.insert(vectors[i], metadata, id);
    }
    return resultIds;
  }

  /**
   * Rebuild index from database (for recovery/startup)
   */
  async rebuildIndex(): Promise<number> {
    const prefix = this.vectorKeyPrefix();
    let count = 0;

    try {
      for await (const [keyBuffer, valueBuffer] of this.db.scanPrefix(Buffer.from(prefix))) {
        const key = keyBuffer.toString();
        const id = key.replace(prefix, '');
        const data = JSON.parse(valueBuffer.toString());
        
        this.vectorIndex.add(id, data.vector, data.metadata);
        count++;
      }
    } catch (error) {
      console.warn('[SochDB] Error rebuilding vector index:', error);
    }

    this._indexReady = true;
    return count;
  }

  /**
   * Check if index is ready (loaded from disk)
   */
  get isIndexReady(): boolean {
    return this._indexReady || this.vectorIndex.size() > 0;
  }

  /**
   * Search for similar vectors
   * Uses NATIVE HNSW search (O(log N)) when available, falls back to JS brute-force
   */
  async search(request: SearchRequest): Promise<SearchResult[]> {
    const k = request.k;
    const queryVector = request.queryVector;
    
    // Try native HNSW search first (much faster for large datasets)
    if (NativeHnsw && this.nativeIndexPtr && NativeHnsw.hnsw_search) {
      try {
        const dimension = queryVector.length;
        
        // Prepare query as Float32Array
        const queryArray = new Float32Array(queryVector);
        
        // Allocate output buffers
        // CSearchResult: { id_lo: uint64, id_hi: uint64, distance: float }
        // Size: 8 + 8 + 4 = 20 bytes per result, aligned to 24 bytes
        const resultSize = 24;
        const resultsBuffer = Buffer.alloc(resultSize * k);
        const numResultsBuffer = Buffer.alloc(8);  // size_t
        
        // Call native search
        const result = NativeHnsw.hnsw_search(
          this.nativeIndexPtr,
          queryArray,
          dimension,
          k,
          resultsBuffer,
          numResultsBuffer
        );
        
        if (result === 0) {
          const numResults = numResultsBuffer.readBigUInt64LE(0);
          const nativeResults: SearchResult[] = [];
          
          // Read results from buffer
          for (let i = 0; i < Math.min(Number(numResults), k); i++) {
            const offset = i * resultSize;
            const id_lo = resultsBuffer.readBigUInt64LE(offset);
            const distance = resultsBuffer.readFloatLE(offset + 16);
            
            // Map numeric ID back to string ID
            const numericId = Number(id_lo);
            const stringId = this.nativeIdToStringId.get(numericId) || id_lo.toString();
            const data = (this.vectorIndex as any).vectors?.get(stringId);
            nativeResults.push({
              id: stringId,
              score: 1 - distance,  // Convert distance to similarity
              vector: request.includeMetadata && data ? data.vector : undefined,
              metadata: request.includeMetadata && data ? data.metadata : undefined,
            });
          }
          
          return nativeResults;
        }
      } catch (e: any) {
        // Fall back to JS search on error
        console.warn('[SochDB] Native search failed:', e.message);
      }
    }
    
    // Fallback: JS brute-force search
    // Auto-rebuild index if empty but there might be data
    if (!this.isIndexReady && this.vectorIndex.size() === 0) {
      await this.rebuildIndex();
    }

    const results = this.vectorIndex.search(
      request.queryVector,
      request.k,
      request.filter
    );

    // Map results based on includeMetadata flag
    return results.map(r => ({
      id: r.id,
      score: r.score,
      vector: request.includeMetadata ? r.vector : undefined,
      metadata: request.includeMetadata ? r.metadata : undefined,
    }));
  }

  /**
   * Get a vector by ID
   */
  async get(id: string): Promise<{ vector: number[]; metadata?: Record<string, any> } | null> {
    const key = this.vectorKey(id);
    const value = await this.db.get(Buffer.from(key));
    
    if (!value) {
      return null;
    }
    
    const data = JSON.parse(value.toString());
    return {
      vector: data.vector,
      metadata: data.metadata,
    };
  }

  /**
   * Delete a vector by ID
   */
  async delete(id: string): Promise<boolean> {
    const key = this.vectorKey(id);
    await this.db.delete(Buffer.from(key));
    // Remove from in-memory index
    this.vectorIndex.remove(id);
    return true;
  }

  /**
   * Count vectors in collection
   */
  async count(): Promise<number> {
    // If index is loaded, return from index
    if (this.isIndexReady) {
      return this.vectorIndex.size();
    }
    // Otherwise rebuild and count
    return await this.rebuildIndex();
  }

  // Helper methods
  private vectorKey(id: string): string {
    return `_collection/${this.namespace}/${this.name}/vectors/${id}`;
  }

  private vectorKeyPrefix(): string {
    return `_collection/${this.namespace}/${this.name}/vectors/`;
  }

  private metadataKey(): string {
    return `_collection/${this.namespace}/${this.name}/metadata`;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Calculate cosine similarity
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

// ============================================================================
// Namespace Handle
// ============================================================================

export class Namespace {
  constructor(
    private db: any,
    private name: string,
    private config: NamespaceConfig
  ) {}

  /**
   * Create a new collection in this namespace
   */
  async createCollection(config: CollectionConfig): Promise<Collection> {
    const metadataKey = `_collection/${this.name}/${config.name}/metadata`;
    
    // Check if collection already exists
    const existing = await this.db.get(Buffer.from(metadataKey));
    if (existing) {
      throw new CollectionExistsError(config.name);
    }

    // Store collection metadata
    const metadata = {
      ...config,
      createdAt: Date.now(),
    };
    
    await this.db.put(
      Buffer.from(metadataKey),
      Buffer.from(JSON.stringify(metadata))
    );

    return new Collection(this.db, this.name, config.name, config);
  }

  /**
   * Get an existing collection
   */
  async collection(name: string): Promise<Collection> {
    const metadataKey = `_collection/${this.name}/${name}/metadata`;
    const metadata = await this.db.get(Buffer.from(metadataKey));
    
    if (!metadata) {
      throw new CollectionNotFoundError(name);
    }

    const config = JSON.parse(metadata.toString());
    return new Collection(this.db, this.name, name, config);
  }

  /**
   * Get or create a collection
   */
  async getOrCreateCollection(config: CollectionConfig): Promise<Collection> {
    try {
      return await this.collection(config.name);
    } catch (error) {
      if (error instanceof CollectionNotFoundError) {
        return await this.createCollection(config);
      }
      throw error;
    }
  }

  /**
   * Delete a collection
   */
  async deleteCollection(name: string): Promise<boolean> {
    const metadataKey = `_collection/${this.name}/${name}/metadata`;
    const prefix = Buffer.from(`_collection/${this.name}/${name}/`);

    // Delete all keys with this collection prefix (vectors, metadata, etc.)
    try {
      const toDelete: Buffer[] = [];
      for await (const [keyBuf] of this.db.scanPrefix(prefix)) {
        toDelete.push(keyBuf);
      }
      for (const key of toDelete) {
        await this.db.delete(key);
      }
    } catch {
      // If scanPrefix fails, fall back to just deleting the metadata key
      await this.db.delete(Buffer.from(metadataKey));
    }

    return true;
  }

  /**
   * List all collections in this namespace
   */
  async listCollections(): Promise<string[]> {
    const prefix = Buffer.from(`_collection/${this.name}/`);
    const collections = new Set<string>();

    try {
      for await (const [keyBuf] of this.db.scanPrefix(prefix)) {
        const key = keyBuf.toString();
        // Key format: _collection/{namespace}/{collectionName}/...
        const afterPrefix = key.substring(`_collection/${this.name}/`.length);
        const collectionName = afterPrefix.split('/')[0];
        if (collectionName) {
          collections.add(collectionName);
        }
      }
    } catch {
      // Scan not available
    }

    return Array.from(collections);
  }

  getName(): string {
    return this.name;
  }

  getConfig(): NamespaceConfig {
    return { ...this.config };
  }
}
