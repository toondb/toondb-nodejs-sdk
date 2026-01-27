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
  private _indexReady = false;

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

    return vectorId;
  }

  /**
   * Insert multiple vectors
   * All vectors are indexed synchronously after insertion
   */
  async insertMany(
    vectors: number[][],
    metadatas?: Record<string, any>[],
    ids?: string[]
  ): Promise<string[]> {
    const resultIds: string[] = [];
    
    for (let i = 0; i < vectors.length; i++) {
      const id = ids ? ids[i] : undefined;
      const metadata = metadatas ? metadatas[i] : undefined;
      const resultId = await this.insert(vectors[i], metadata, id);
      resultIds.push(resultId);
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
   * Uses synchronous in-memory index - no delay
   */
  async search(request: SearchRequest): Promise<SearchResult[]> {
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
    const prefix = `_collection/${this.name}/${name}/`;
    
    // TODO: Delete all keys with prefix
    await this.db.delete(Buffer.from(metadataKey));
    
    return true;
  }

  /**
   * List all collections in this namespace
   */
  async listCollections(): Promise<string[]> {
    // TODO: Implement efficient listing with range queries
    return [];
  }

  getName(): string {
    return this.name;
  }

  getConfig(): NamespaceConfig {
    return { ...this.config };
  }
}
