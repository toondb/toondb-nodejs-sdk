/**
 * ToonDB gRPC Client - Thin SDK Wrapper
 *
 * This module provides a thin gRPC client wrapper for the ToonDB server.
 * All business logic runs on the server (Thick Server / Thin Client architecture).
 *
 * The client is approximately ~250 lines of code, delegating all operations to the server.
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';

// Types
export interface SearchResult {
  id: number;
  distance: number;
}

export interface Document {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, string>;
}

export interface GraphNode {
  id: string;
  nodeType: string;
  properties: Record<string, string>;
}

export interface GraphEdge {
  fromId: string;
  edgeType: string;
  toId: string;
  properties: Record<string, string>;
}

export interface ToonDBClientOptions {
  address?: string;
  secure?: boolean;
  protoPath?: string;
}

/**
 * Thin gRPC client for ToonDB.
 *
 * All operations are delegated to the ToonDB gRPC server.
 * This client provides a TypeScript interface over the gRPC protocol.
 *
 * Usage:
 * ```typescript
 * const client = new ToonDBClient({ address: 'localhost:50051' });
 *
 * // Create collection
 * await client.createCollection('docs', { dimension: 384 });
 *
 * // Add documents
 * await client.addDocuments('docs', [
 *   { id: '1', content: 'Hello', embedding: [...] }
 * ]);
 *
 * // Search
 * const results = await client.search('docs', queryVector, 5);
 * ```
 */
export class ToonDBClient {
  private address: string;
  private credentials: grpc.ChannelCredentials;
  private stubs: Map<string, any> = new Map();
  private protoPath: string;
  private packageDefinition: any;
  private proto: any;

  constructor(options: ToonDBClientOptions = {}) {
    this.address = options.address || 'localhost:50051';
    this.credentials = options.secure
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure();
    this.protoPath = options.protoPath || path.join(__dirname, '../../proto/toondb.proto');

    // Load proto definition
    this.packageDefinition = protoLoader.loadSync(this.protoPath, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const loadedPackage = grpc.loadPackageDefinition(this.packageDefinition) as any;
    this.proto = loadedPackage?.toondb?.v1;
  }

  private getStub(serviceName: string): any {
    if (!this.stubs.has(serviceName)) {
      const ServiceClass = this.proto?.[serviceName];
      if (!ServiceClass) {
        throw new Error(`Service ${serviceName} not found in proto definition`);
      }
      this.stubs.set(serviceName, new ServiceClass(this.address, this.credentials));
    }
    return this.stubs.get(serviceName)!;
  }

  private promisify<T>(stub: any, method: string, request: any): Promise<T> {
    return new Promise((resolve, reject) => {
      stub[method](request, (error: any, response: T) => {
        if (error) reject(error);
        else resolve(response);
      });
    });
  }

  /**
   * Close all gRPC connections.
   */
  close(): void {
    for (const stub of this.stubs.values()) {
      grpc.closeClient(stub);
    }
    this.stubs.clear();
  }

  // ===========================================================================
  // Vector Index Operations (VectorIndexService)
  // ===========================================================================

  async createIndex(
    name: string,
    dimension: number,
    options: { metric?: string; m?: number; efConstruction?: number } = {}
  ): Promise<boolean> {
    const stub = this.getStub('VectorIndexService');
    const response = await this.promisify<any>(stub, 'createIndex', {
      name,
      dimension,
      metric: options.metric === 'l2' ? 1 : options.metric === 'dot' ? 3 : 2,
      config: {
        maxConnections: options.m || 16,
        efConstruction: options.efConstruction || 200,
      },
    });
    return response.success;
  }

  async insertVectors(
    indexName: string,
    ids: number[],
    vectors: number[][]
  ): Promise<number> {
    const stub = this.getStub('VectorIndexService');
    const flatVectors = vectors.flat();
    const response = await this.promisify<any>(stub, 'insertBatch', {
      indexName,
      ids,
      vectors: flatVectors,
    });
    return response.insertedCount;
  }

  async search(
    indexName: string,
    query: number[],
    k: number = 10,
    ef: number = 50
  ): Promise<SearchResult[]> {
    const stub = this.getStub('VectorIndexService');
    const response = await this.promisify<any>(stub, 'search', {
      indexName,
      query,
      k,
      ef,
    });
    return (response.results || []).map((r: any) => ({
      id: Number(r.id),
      distance: r.distance,
    }));
  }

  // ===========================================================================
  // Collection Operations (CollectionService)
  // ===========================================================================

  async createCollection(
    name: string,
    options: { dimension: number; namespace?: string; metric?: string }
  ): Promise<boolean> {
    const stub = this.getStub('CollectionService');
    const response = await this.promisify<any>(stub, 'createCollection', {
      name,
      namespace: options.namespace || 'default',
      dimension: options.dimension,
      metric: options.metric === 'l2' ? 1 : options.metric === 'dot' ? 3 : 2,
    });
    return response.success;
  }

  async addDocuments(
    collectionName: string,
    documents: Array<{
      id?: string;
      content?: string;
      embedding?: number[];
      metadata?: Record<string, string>;
    }>,
    namespace: string = 'default'
  ): Promise<string[]> {
    const stub = this.getStub('CollectionService');
    const response = await this.promisify<any>(stub, 'addDocuments', {
      collectionName,
      namespace,
      documents: documents.map((d) => ({
        id: d.id || '',
        content: d.content || '',
        embedding: d.embedding || [],
        metadata: d.metadata || {},
      })),
    });
    return response.ids || [];
  }

  async searchCollection(
    collectionName: string,
    query: number[],
    k: number = 10,
    options: { namespace?: string; filter?: Record<string, string> } = {}
  ): Promise<Document[]> {
    const stub = this.getStub('CollectionService');
    const response = await this.promisify<any>(stub, 'searchCollection', {
      collectionName,
      namespace: options.namespace || 'default',
      query,
      k,
      filter: options.filter || {},
    });
    return (response.results || []).map((r: any) => ({
      id: r.document.id,
      content: r.document.content,
      embedding: r.document.embedding || [],
      metadata: r.document.metadata || {},
    }));
  }

  // ===========================================================================
  // Graph Operations (GraphService)
  // ===========================================================================

  async addNode(
    nodeId: string,
    nodeType: string,
    properties: Record<string, string> = {},
    namespace: string = 'default'
  ): Promise<boolean> {
    const stub = this.getStub('GraphService');
    const response = await this.promisify<any>(stub, 'addNode', {
      namespace,
      node: { id: nodeId, nodeType, properties },
    });
    return response.success;
  }

  async addEdge(
    fromId: string,
    edgeType: string,
    toId: string,
    properties: Record<string, string> = {},
    namespace: string = 'default'
  ): Promise<boolean> {
    const stub = this.getStub('GraphService');
    const response = await this.promisify<any>(stub, 'addEdge', {
      namespace,
      edge: { fromId, edgeType, toId, properties },
    });
    return response.success;
  }

  async traverse(
    startNode: string,
    options: { maxDepth?: number; order?: 'bfs' | 'dfs'; namespace?: string } = {}
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const stub = this.getStub('GraphService');
    const response = await this.promisify<any>(stub, 'traverse', {
      namespace: options.namespace || 'default',
      startNodeId: startNode,
      order: options.order === 'dfs' ? 1 : 0,
      maxDepth: options.maxDepth || 10,
    });
    return {
      nodes: (response.nodes || []).map((n: any) => ({
        id: n.id,
        nodeType: n.nodeType,
        properties: n.properties || {},
      })),
      edges: (response.edges || []).map((e: any) => ({
        fromId: e.fromId,
        edgeType: e.edgeType,
        toId: e.toId,
        properties: e.properties || {},
      })),
    };
  }

  // ===========================================================================
  // Semantic Cache Operations (SemanticCacheService)
  // ===========================================================================

  async cacheGet(
    cacheName: string,
    queryEmbedding: number[],
    threshold: number = 0.85
  ): Promise<string | null> {
    const stub = this.getStub('SemanticCacheService');
    const response = await this.promisify<any>(stub, 'get', {
      cacheName,
      queryEmbedding,
      similarityThreshold: threshold,
    });
    return response.hit ? response.cachedValue : null;
  }

  async cachePut(
    cacheName: string,
    key: string,
    value: string,
    keyEmbedding: number[],
    ttlSeconds: number = 0
  ): Promise<boolean> {
    const stub = this.getStub('SemanticCacheService');
    const response = await this.promisify<any>(stub, 'put', {
      cacheName,
      key,
      value,
      keyEmbedding,
      ttlSeconds,
    });
    return response.success;
  }

  // ===========================================================================
  // Trace Operations (TraceService)
  // ===========================================================================

  async startTrace(name: string): Promise<{ traceId: string; rootSpanId: string }> {
    const stub = this.getStub('TraceService');
    const response = await this.promisify<any>(stub, 'startTrace', { name });
    return { traceId: response.traceId, rootSpanId: response.rootSpanId };
  }

  async startSpan(traceId: string, parentSpanId: string, name: string): Promise<string> {
    const stub = this.getStub('TraceService');
    const response = await this.promisify<any>(stub, 'startSpan', {
      traceId,
      parentSpanId,
      name,
    });
    return response.spanId;
  }

  async endSpan(
    traceId: string,
    spanId: string,
    status: 'ok' | 'error' | 'unset' = 'ok'
  ): Promise<number> {
    const stub = this.getStub('TraceService');
    const statusMap = { unset: 0, ok: 1, error: 2 };
    const response = await this.promisify<any>(stub, 'endSpan', {
      traceId,
      spanId,
      status: statusMap[status],
    });
    return Number(response.durationUs);
  }

  // ===========================================================================
  // KV Operations (KvService)
  // ===========================================================================

  async get(key: Buffer, namespace: string = 'default'): Promise<Buffer | null> {
    const stub = this.getStub('KvService');
    const response = await this.promisify<any>(stub, 'get', { namespace, key });
    return response.found ? Buffer.from(response.value) : null;
  }

  async put(
    key: Buffer,
    value: Buffer,
    namespace: string = 'default',
    ttlSeconds: number = 0
  ): Promise<boolean> {
    const stub = this.getStub('KvService');
    const response = await this.promisify<any>(stub, 'put', {
      namespace,
      key,
      value,
      ttlSeconds,
    });
    return response.success;
  }

  async delete(key: Buffer, namespace: string = 'default'): Promise<boolean> {
    const stub = this.getStub('KvService');
    const response = await this.promisify<any>(stub, 'delete', { namespace, key });
    return response.success;
  }
}

/**
 * Connect to ToonDB gRPC server.
 */
export function connect(address: string = 'localhost:50051', options: Omit<ToonDBClientOptions, 'address'> = {}): ToonDBClient {
  if (address.startsWith('grpc://')) {
    address = address.slice(7);
  }
  return new ToonDBClient({ address, ...options });
}

// Alias for backwards compatibility
export const GrpcClient = ToonDBClient;
