/**
 * Tests for v0.4.3 Features: Concurrent Mode, Vector Search, MCP, Policy Service
 * 
 * Run with: npx ts-node test/v043-features.test.ts
 */

import { 
  EmbeddedDatabase,
  Namespace,
  DistanceMetric,
  McpServer,
  PolicyService,
} from '../src';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = path.join(__dirname, '../test-data/v043-features-test');

// Clean up test directory
function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

// Test results
const results: Array<{ name: string; passed: boolean; error?: string }> = [];

function test(name: string, fn: () => Promise<void>) {
  return async () => {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`✅ ${name}`);
    } catch (error: any) {
      results.push({ name, passed: false, error: error.message });
      console.log(`❌ ${name}: ${error.message}`);
    }
  };
}

// ============================================================================
// Test 1: Concurrent Mode Detection
// ============================================================================
const testConcurrentModeDetection = test('Concurrent Mode Detection', async () => {
  const dbPath = path.join(TEST_DIR, 'concurrent-test');
  
  // Check if concurrent mode is available
  const isAvailable = EmbeddedDatabase.isConcurrentModeAvailable();
  console.log(`  Concurrent mode available: ${isAvailable}`);

  // Try to open with fallback
  const db = EmbeddedDatabase.openConcurrent(dbPath, { fallbackToStandard: true });
  
  console.log(`  isConcurrent: ${db.isConcurrent}`);
  console.log(`  isConcurrentFallback: ${db.isConcurrentFallback}`);

  // Basic operations should still work
  await db.put(Buffer.from('test-key'), Buffer.from('test-value'));
  const value = await db.get(Buffer.from('test-key'));
  
  if (!value || value.toString() !== 'test-value') {
    throw new Error('Basic operations failed in concurrent/fallback mode');
  }

  db.close();
});

// ============================================================================
// Test 2: Vector Search - Synchronous Indexing
// ============================================================================
const testVectorSearchSync = test('Vector Search - Synchronous Indexing', async () => {
  const dbPath = path.join(TEST_DIR, 'vector-test');
  const db = EmbeddedDatabase.open(dbPath);

  try {
    // Create namespace and collection
    const namespace = new Namespace(db, 'test_ns', {
      name: 'test_ns',
      displayName: 'Test Namespace',
    });

    const collection = await namespace.createCollection({
      name: 'vectors',
      dimension: 4,
      metric: DistanceMetric.Cosine,
      indexed: true,
    });

    // Insert vectors
    const vectors = [
      { vector: [1.0, 0.0, 0.0, 0.0], metadata: { label: 'x-axis' } },
      { vector: [0.0, 1.0, 0.0, 0.0], metadata: { label: 'y-axis' } },
      { vector: [0.0, 0.0, 1.0, 0.0], metadata: { label: 'z-axis' } },
      { vector: [0.707, 0.707, 0.0, 0.0], metadata: { label: 'xy-diagonal' } },
    ];

    for (const v of vectors) {
      await collection.insert(v.vector, v.metadata);
    }

    // IMMEDIATELY search - no delay should be needed
    const queryVector = [1.0, 0.0, 0.0, 0.0];
    const searchResults = await collection.search({
      queryVector,
      k: 3,
      includeMetadata: true,
    });

    console.log(`  Found ${searchResults.length} results immediately after insert`);

    if (searchResults.length === 0) {
      throw new Error('Vector search returned 0 results immediately after insert - indexing issue!');
    }

    // Verify the closest result is the x-axis vector
    const closest = searchResults[0];
    console.log(`  Closest: ${closest.metadata?.label} (score: ${closest.score.toFixed(4)})`);

    if (closest.metadata?.label !== 'x-axis') {
      throw new Error(`Expected x-axis, got ${closest.metadata?.label}`);
    }

    // Verify count
    const count = await collection.count();
    if (count !== 4) {
      throw new Error(`Expected count 4, got ${count}`);
    }

    console.log(`  Collection count: ${count}`);

  } finally {
    db.close();
  }
});

// ============================================================================
// Test 3: MCP Server
// ============================================================================
const testMcpServer = test('MCP Server - Tool Registration & Execution', async () => {
  const dbPath = path.join(TEST_DIR, 'mcp-test');
  const db = EmbeddedDatabase.open(dbPath);

  try {
    const server = new McpServer(db, {
      name: 'test-mcp',
      version: '1.0.0',
      capabilities: { tools: true, resources: true },
    });

    // List built-in tools
    const tools = server.listTools();
    console.log(`  Built-in tools: ${tools.map(t => t.name).join(', ')}`);

    if (!tools.find(t => t.name === 'db_get')) {
      throw new Error('Missing db_get tool');
    }
    if (!tools.find(t => t.name === 'db_put')) {
      throw new Error('Missing db_put tool');
    }

    // Execute db_put
    const putResult = await server.callTool({
      id: 'call_1',
      name: 'db_put',
      arguments: { key: 'mcp:test', value: 'hello-mcp' },
    });

    if (putResult.isError) {
      throw new Error(`db_put failed: ${putResult.errorMessage}`);
    }
    console.log(`  db_put result: ${JSON.stringify(putResult.content)}`);

    // Execute db_get
    const getResult = await server.callTool({
      id: 'call_2',
      name: 'db_get',
      arguments: { key: 'mcp:test' },
    });

    if (getResult.isError) {
      throw new Error(`db_get failed: ${getResult.errorMessage}`);
    }
    if (getResult.content !== 'hello-mcp') {
      throw new Error(`Expected 'hello-mcp', got '${getResult.content}'`);
    }
    console.log(`  db_get result: ${getResult.content}`);

    // Register custom tool
    server.registerTool({
      name: 'custom_echo',
      description: 'Echo back the input',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
    }, async (args) => {
      return `Echo: ${args.message}`;
    });

    const echoResult = await server.callTool({
      id: 'call_3',
      name: 'custom_echo',
      arguments: { message: 'test message' },
    });

    if (echoResult.content !== 'Echo: test message') {
      throw new Error(`Custom tool failed: ${echoResult.content}`);
    }
    console.log(`  custom_echo result: ${echoResult.content}`);

    // List resources
    const resources = await server.listResources();
    console.log(`  Resources: ${resources.map(r => r.uri).join(', ')}`);

  } finally {
    db.close();
  }
});

// ============================================================================
// Test 4: Policy Service
// ============================================================================
const testPolicyService = test('Policy Service - Access Control', async () => {
  const dbPath = path.join(TEST_DIR, 'policy-test');
  const db = EmbeddedDatabase.open(dbPath);

  try {
    const policy = new PolicyService(db, { enableAudit: true });

    // Create a namespace policy
    await policy.createNamespacePolicy({
      namespace: 'tenant_123',
      rules: [
        {
          id: 'allow_read',
          name: 'Allow Read for All Users',
          effect: 'allow',
          principals: ['user:*'],
          resources: ['collection:*'],
          actions: ['read', 'search'],
          priority: 1,
        },
        {
          id: 'allow_admin_write',
          name: 'Allow Write for Admins',
          effect: 'allow',
          principals: ['user:admin:*'],
          resources: ['collection:*'],
          actions: ['write', 'delete'],
          priority: 0,
        },
      ],
      defaultEffect: 'deny',
    });

    // Test evaluation - user can read
    const readResult = await policy.evaluate({
      principal: 'user:alice',
      action: 'read',
      resource: 'collection:tenant_123:documents',
    });

    console.log(`  user:alice read -> ${readResult.allowed} (${readResult.reason})`);
    if (!readResult.allowed) {
      throw new Error('Expected read to be allowed for user');
    }

    // Test evaluation - user cannot write
    const writeResult = await policy.evaluate({
      principal: 'user:alice',
      action: 'write',
      resource: 'collection:tenant_123:documents',
    });

    console.log(`  user:alice write -> ${writeResult.allowed} (${writeResult.reason})`);
    if (writeResult.allowed) {
      throw new Error('Expected write to be denied for regular user');
    }

    // Test evaluation - admin can write
    const adminWriteResult = await policy.evaluate({
      principal: 'user:admin:bob',
      action: 'write',
      resource: 'collection:tenant_123:documents',
    });

    console.log(`  user:admin:bob write -> ${adminWriteResult.allowed} (${adminWriteResult.reason})`);
    if (!adminWriteResult.allowed) {
      throw new Error('Expected write to be allowed for admin');
    }

    // Test grants
    await policy.grantAccess({
      namespace: 'tenant_123',
      principal: 'user:alice',
      permissions: ['read', 'search', 'write'],
      grantedBy: 'admin',
    });

    const hasRead = await policy.hasPermission('tenant_123', 'user:alice', 'read');
    const hasAdmin = await policy.hasPermission('tenant_123', 'user:alice', 'admin');

    console.log(`  alice hasPermission(read): ${hasRead}`);
    console.log(`  alice hasPermission(admin): ${hasAdmin}`);

    if (!hasRead) throw new Error('Expected alice to have read permission');
    if (hasAdmin) throw new Error('Expected alice to NOT have admin permission');

    // Test audit log
    const auditEntries = await policy.getAuditLog({ limit: 10 });
    console.log(`  Audit log entries: ${auditEntries.length}`);

    if (auditEntries.length < 3) {
      throw new Error('Expected at least 3 audit entries');
    }

  } finally {
    db.close();
  }
});

// ============================================================================
// Test 5: End-to-End Integration
// ============================================================================
const testEndToEndIntegration = test('End-to-End Integration', async () => {
  const dbPath = path.join(TEST_DIR, 'e2e-test');
  const db = EmbeddedDatabase.open(dbPath);

  try {
    // 1. Set up policy
    const policy = new PolicyService(db);
    await policy.createNamespacePolicy({
      namespace: 'documents',
      rules: [{
        id: 'allow_all',
        name: 'Allow All',
        effect: 'allow',
        principals: ['*'],
        resources: ['*'],
        actions: ['*'],
      }],
      defaultEffect: 'deny',
    });

    // 2. Create collection with vectors
    const namespace = new Namespace(db, 'documents', {
      name: 'documents',
      displayName: 'Document Store',
    });

    const collection = await namespace.createCollection({
      name: 'embeddings',
      dimension: 4,
      metric: DistanceMetric.Cosine,
    });

    // 3. Insert via MCP
    const mcp = new McpServer(db, {
      name: 'doc-mcp',
      version: '1.0.0',
      capabilities: { tools: true },
    });

    // Register a semantic search tool
    mcp.registerTool({
      name: 'semantic_search',
      description: 'Search documents by semantic similarity',
      inputSchema: {
        type: 'object',
        properties: {
          query_vector: { type: 'array', items: { type: 'number' } },
          k: { type: 'number', default: 5 },
        },
        required: ['query_vector'],
      },
    }, async (args) => {
      const searchResults = await collection.search({
        queryVector: args.query_vector,
        k: args.k || 5,
        includeMetadata: true,
      });
      return searchResults;
    });

    // 4. Insert some documents
    await collection.insert([1.0, 0.0, 0.0, 0.0], { title: 'Doc A', topic: 'science' });
    await collection.insert([0.0, 1.0, 0.0, 0.0], { title: 'Doc B', topic: 'art' });
    await collection.insert([0.707, 0.707, 0.0, 0.0], { title: 'Doc C', topic: 'interdisciplinary' });

    // 5. Search via MCP tool
    const searchResult = await mcp.callTool({
      id: 'search_1',
      name: 'semantic_search',
      arguments: {
        query_vector: [0.9, 0.1, 0.0, 0.0],
        k: 2,
      },
    });

    if (searchResult.isError) {
      throw new Error(`Semantic search failed: ${searchResult.errorMessage}`);
    }

    const searchResults = searchResult.content as Array<{ id: string; metadata?: { title: string } }>;
    console.log(`  Semantic search found ${searchResults.length} results`);
    console.log(`  Top result: ${searchResults[0]?.metadata?.title}`);

    // 6. Verify policy still works
    const evalResult = await policy.evaluate({
      principal: 'user:test',
      action: 'read',
      resource: 'collection:documents:embeddings',
    });

    if (!evalResult.allowed) {
      throw new Error('Policy should allow read');
    }

    console.log('  ✓ Policy, Vector Search, and MCP all working together');

  } finally {
    db.close();
  }
});

// ============================================================================
// Run All Tests
// ============================================================================
async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('SochDB Node.js SDK v0.4.9 - Feature Tests');
  console.log('='.repeat(60) + '\n');

  cleanup();

  await testConcurrentModeDetection();
  await testVectorSearchSync();
  await testMcpServer();
  await testPolicyService();
  await testEndToEndIntegration();

  console.log('\n' + '='.repeat(60));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Results: ${passed}/${results.length} passed, ${failed} failed`);
  
  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
  }
  console.log('='.repeat(60) + '\n');

  // Cleanup
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }

  // Let Jest handle test completion
  if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
  }
}

// Wrap in Jest test
describe('SochDB v0.4.3 Features', () => {
  it('should pass all feature tests', async () => {
    await runTests();
  }, 60000); // 60 second timeout
});
