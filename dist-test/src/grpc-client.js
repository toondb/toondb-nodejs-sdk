"use strict";
/**
 * ToonDB gRPC Client - Thin SDK Wrapper
 *
 * This module provides a thin gRPC client wrapper for the ToonDB server.
 * All business logic runs on the server (Thick Server / Thin Client architecture).
 *
 * The client is approximately ~250 lines of code, delegating all operations to the server.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrpcClient = exports.ToonDBClient = void 0;
exports.connect = connect;
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");
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
class ToonDBClient {
    constructor(options = {}) {
        this.stubs = new Map();
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
        const loadedPackage = grpc.loadPackageDefinition(this.packageDefinition);
        this.proto = loadedPackage?.toondb?.v1;
    }
    getStub(serviceName) {
        if (!this.stubs.has(serviceName)) {
            const ServiceClass = this.proto?.[serviceName];
            if (!ServiceClass) {
                throw new Error(`Service ${serviceName} not found in proto definition`);
            }
            this.stubs.set(serviceName, new ServiceClass(this.address, this.credentials));
        }
        return this.stubs.get(serviceName);
    }
    promisify(stub, method, request) {
        return new Promise((resolve, reject) => {
            stub[method](request, (error, response) => {
                if (error)
                    reject(error);
                else
                    resolve(response);
            });
        });
    }
    /**
     * Close all gRPC connections.
     */
    close() {
        for (const stub of this.stubs.values()) {
            grpc.closeClient(stub);
        }
        this.stubs.clear();
    }
    // ===========================================================================
    // Vector Index Operations (VectorIndexService)
    // ===========================================================================
    async createIndex(name, dimension, options = {}) {
        const stub = this.getStub('VectorIndexService');
        const response = await this.promisify(stub, 'createIndex', {
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
    async insertVectors(indexName, ids, vectors) {
        const stub = this.getStub('VectorIndexService');
        const flatVectors = vectors.flat();
        const response = await this.promisify(stub, 'insertBatch', {
            indexName,
            ids,
            vectors: flatVectors,
        });
        return response.insertedCount;
    }
    async search(indexName, query, k = 10, ef = 50) {
        const stub = this.getStub('VectorIndexService');
        const response = await this.promisify(stub, 'search', {
            indexName,
            query,
            k,
            ef,
        });
        return (response.results || []).map((r) => ({
            id: Number(r.id),
            distance: r.distance,
        }));
    }
    // ===========================================================================
    // Collection Operations (CollectionService)
    // ===========================================================================
    async createCollection(name, options) {
        const stub = this.getStub('CollectionService');
        const response = await this.promisify(stub, 'createCollection', {
            name,
            namespace: options.namespace || 'default',
            dimension: options.dimension,
            metric: options.metric === 'l2' ? 1 : options.metric === 'dot' ? 3 : 2,
        });
        return response.success;
    }
    async addDocuments(collectionName, documents, namespace = 'default') {
        const stub = this.getStub('CollectionService');
        const response = await this.promisify(stub, 'addDocuments', {
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
    async searchCollection(collectionName, query, k = 10, options = {}) {
        const stub = this.getStub('CollectionService');
        const response = await this.promisify(stub, 'searchCollection', {
            collectionName,
            namespace: options.namespace || 'default',
            query,
            k,
            filter: options.filter || {},
        });
        return (response.results || []).map((r) => ({
            id: r.document.id,
            content: r.document.content,
            embedding: r.document.embedding || [],
            metadata: r.document.metadata || {},
        }));
    }
    // ===========================================================================
    // Graph Operations (GraphService)
    // ===========================================================================
    async addNode(nodeId, nodeType, properties = {}, namespace = 'default') {
        const stub = this.getStub('GraphService');
        const response = await this.promisify(stub, 'addNode', {
            namespace,
            node: { id: nodeId, nodeType, properties },
        });
        return response.success;
    }
    async addEdge(fromId, edgeType, toId, properties = {}, namespace = 'default') {
        const stub = this.getStub('GraphService');
        const response = await this.promisify(stub, 'addEdge', {
            namespace,
            edge: { fromId, edgeType, toId, properties },
        });
        return response.success;
    }
    async traverse(startNode, options = {}) {
        const stub = this.getStub('GraphService');
        const response = await this.promisify(stub, 'traverse', {
            namespace: options.namespace || 'default',
            startNodeId: startNode,
            order: options.order === 'dfs' ? 1 : 0,
            maxDepth: options.maxDepth || 10,
        });
        return {
            nodes: (response.nodes || []).map((n) => ({
                id: n.id,
                nodeType: n.nodeType,
                properties: n.properties || {},
            })),
            edges: (response.edges || []).map((e) => ({
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
    async cacheGet(cacheName, queryEmbedding, threshold = 0.85) {
        const stub = this.getStub('SemanticCacheService');
        const response = await this.promisify(stub, 'get', {
            cacheName,
            queryEmbedding,
            similarityThreshold: threshold,
        });
        return response.hit ? response.cachedValue : null;
    }
    async cachePut(cacheName, key, value, keyEmbedding, ttlSeconds = 0) {
        const stub = this.getStub('SemanticCacheService');
        const response = await this.promisify(stub, 'put', {
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
    async startTrace(name) {
        const stub = this.getStub('TraceService');
        const response = await this.promisify(stub, 'startTrace', { name });
        return { traceId: response.traceId, rootSpanId: response.rootSpanId };
    }
    async startSpan(traceId, parentSpanId, name) {
        const stub = this.getStub('TraceService');
        const response = await this.promisify(stub, 'startSpan', {
            traceId,
            parentSpanId,
            name,
        });
        return response.spanId;
    }
    async endSpan(traceId, spanId, status = 'ok') {
        const stub = this.getStub('TraceService');
        const statusMap = { unset: 0, ok: 1, error: 2 };
        const response = await this.promisify(stub, 'endSpan', {
            traceId,
            spanId,
            status: statusMap[status],
        });
        return Number(response.durationUs);
    }
    // ===========================================================================
    // KV Operations (KvService)
    // ===========================================================================
    async get(key, namespace = 'default') {
        const stub = this.getStub('KvService');
        const response = await this.promisify(stub, 'get', { namespace, key });
        return response.found ? Buffer.from(response.value) : null;
    }
    async put(key, value, namespace = 'default', ttlSeconds = 0) {
        const stub = this.getStub('KvService');
        const response = await this.promisify(stub, 'put', {
            namespace,
            key,
            value,
            ttlSeconds,
        });
        return response.success;
    }
    async delete(key, namespace = 'default') {
        const stub = this.getStub('KvService');
        const response = await this.promisify(stub, 'delete', { namespace, key });
        return response.success;
    }
}
exports.ToonDBClient = ToonDBClient;
/**
 * Connect to ToonDB gRPC server.
 */
function connect(address = 'localhost:50051', options = {}) {
    if (address.startsWith('grpc://')) {
        address = address.slice(7);
    }
    return new ToonDBClient({ address, ...options });
}
// Alias for backwards compatibility
exports.GrpcClient = ToonDBClient;
