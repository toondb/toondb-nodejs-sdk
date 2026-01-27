#!/usr/bin/env node
/**
 * Comprehensive Test Suite for SochDB Node.js SDK v0.4.3
 * Tests all features including new MCP, Policy, and Vector Search fixes
 */

const fs = require('fs');
const path = require('path');
const {
    EmbeddedDatabase,
    McpServer,
    PolicyService,
    Namespace,
} = require('../dist/cjs/index.js');

const TEST_DB_PATH = './test-comprehensive-db';
const NAMESPACE = 'test-ns';

// Cleanup helper
function cleanup() {
    if (fs.existsSync(TEST_DB_PATH)) {
        fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    }
    if (fs.existsSync(TEST_DB_PATH + '-concurrent')) {
        fs.rmSync(TEST_DB_PATH + '-concurrent', { recursive: true, force: true });
    }
}

// Color output helpers
const colors = {
    green: (str) => `\x1b[32m${str}\x1b[0m`,
    red: (str) => `\x1b[31m${str}\x1b[0m`,
    yellow: (str) => `\x1b[33m${str}\x1b[0m`,
    blue: (str) => `\x1b[34m${str}\x1b[0m`,
    cyan: (str) => `\x1b[36m${str}\x1b[0m`,
};

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(colors.green('  ✓'), message);
        testsPassed++;
    } else {
        console.log(colors.red('  ✗'), message);
        testsFailed++;
        throw new Error(`Assertion failed: ${message}`);
    }
}

function testSection(name) {
    console.log('\n' + colors.cyan('━'.repeat(60)));
    console.log(colors.cyan(`  ${name}`));
    console.log(colors.cyan('━'.repeat(60)));
}

async function runTests() {
    console.log(colors.blue('\n' + '═'.repeat(60)));
    console.log(colors.blue('  SochDB Node.js SDK - Comprehensive Test Suite'));
    console.log(colors.blue('  Version 0.4.3 - Full Feature Validation'));
    console.log(colors.blue('═'.repeat(60)));

    cleanup();
    let db = null;

    try {
        // ============================================================
        // TEST 1: Database Initialization & Concurrent Mode
        // ============================================================
        testSection('1. Database Initialization & Concurrent Mode');

        const concurrentAvailable = EmbeddedDatabase.isConcurrentModeAvailable();
        console.log(`  Concurrent mode available: ${concurrentAvailable}`);

        db = EmbeddedDatabase.open(TEST_DB_PATH);
        assert(db !== null, 'Database instance created');

        // Test concurrent mode with fallback
        const db2 = EmbeddedDatabase.openConcurrent(TEST_DB_PATH + '-concurrent', {
            fallbackToStandard: true
        });
        assert(db2 !== null, 'Concurrent database opened (with fallback)');
        assert(typeof db2.isConcurrent === 'boolean', 'isConcurrent property exists');
        assert(typeof db2.isConcurrentFallback === 'boolean', 'isConcurrentFallback property exists');
        console.log(`  Concurrent mode active: ${db2.isConcurrent}`);
        console.log(`  Fell back to standard: ${db2.isConcurrentFallback}`);
        await db2.close();

        // ============================================================
        // TEST 2: Basic CRUD Operations
        // ============================================================
        testSection('2. Basic CRUD Operations');

        await db.put(Buffer.from('user:1'), Buffer.from('Alice'));
        await db.put(Buffer.from('user:2'), Buffer.from('Bob'));
        await db.put(Buffer.from('user:3'), Buffer.from('Charlie'));
        assert(true, 'Inserted 3 key-value pairs');

        const val1 = await db.get(Buffer.from('user:1'));
        assert(val1 !== null && val1.toString() === 'Alice', 'Retrieved user:1 = Alice');

        const val2 = await db.get(Buffer.from('user:2'));
        assert(val2 !== null && val2.toString() === 'Bob', 'Retrieved user:2 = Bob');

        await db.delete(Buffer.from('user:3'));
        const val3 = await db.get(Buffer.from('user:3'));
        assert(val3 === null, 'Deleted user:3 successfully');

        // ============================================================
        // TEST 3: Namespace API
        // ============================================================
        testSection('3. Namespace API');

        const ns = new Namespace(db, NAMESPACE, { defaultIndexPolicy: 'balanced' });
        assert(ns !== null, 'Namespace created');

        // Create collection
        const collection = await ns.createCollection({ name: 'embeddings', dimension: 4 });
        assert(collection !== null, 'Collection created with dimension 4');

        // ============================================================
        // TEST 4: Vector Search - Synchronous Indexing
        // ============================================================
        testSection('4. Vector Search - Synchronous Indexing');

        await collection.insert([1.0, 0.0, 0.0, 0.0], { label: 'x-axis' }, 'vec1');
        await collection.insert([0.0, 1.0, 0.0, 0.0], { label: 'y-axis' }, 'vec2');
        await collection.insert([0.0, 0.0, 1.0, 0.0], { label: 'z-axis' }, 'vec3');
        await collection.insert([0.707, 0.707, 0.0, 0.0], { label: 'diagonal' }, 'vec4');
        assert(true, 'Inserted 4 vectors');

        // CRITICAL: Search immediately after insert (tests synchronous indexing)
        const results = await collection.search({ 
            queryVector: [1.0, 0.0, 0.0, 0.0], 
            k: 3,
            includeMetadata: true
        });
        assert(results.length > 0, `Found ${results.length} results immediately after insert`);
        assert(results.length >= 3, `Expected at least 3 results, got ${results.length}`);

        console.log('  Search results:');
        results.forEach((r, i) => {
            console.log(`    ${i + 1}. ${r.metadata?.label || r.id} (score: ${r.score.toFixed(4)})`);
        });

        const closest = results[0];
        assert(closest.metadata?.label === 'x-axis', 
               `Closest match is x-axis (got ${closest.metadata?.label})`);
        assert(closest.score >= 0.99, 
               `Perfect match score >= 0.99 (got ${closest.score.toFixed(4)})`);

        // Test count
        const count = await collection.count();
        assert(count === 4, `Collection count is 4 (got ${count})`);

        // Test delete from index
        await collection.delete('vec4');
        const countAfterDelete = await collection.count();
        assert(countAfterDelete === 3, `Count after delete is 3 (got ${countAfterDelete})`);

        const resultsAfterDelete = await collection.search({ 
            queryVector: [0.707, 0.707, 0.0, 0.0], 
            k: 5 
        });
        const diagonalFound = resultsAfterDelete.some(r => r.id === 'vec4');
        assert(!diagonalFound, 'Deleted vector not in search results');

        // ============================================================
        // TEST 5: MCP Server - Tool Registration & Execution
        // ============================================================
        testSection('5. MCP Server - Tool Registration & Execution');

        const mcpServer = new McpServer(db, { 
            name: 'test-server',
            version: '1.0.0'
        });
        assert(mcpServer !== null, 'MCP Server created');

        // Test built-in tools
        const builtinTools = await mcpServer.listTools();
        console.log(`  Built-in tools: ${builtinTools.map(t => t.name).join(', ')}`);
        assert(builtinTools.length >= 5, `At least 5 built-in tools (got ${builtinTools.length})`);

        const hasDbGet = builtinTools.some(t => t.name === 'db_get');
        const hasDbPut = builtinTools.some(t => t.name === 'db_put');
        const hasDbScan = builtinTools.some(t => t.name === 'db_scan');
        assert(hasDbGet && hasDbPut && hasDbScan, 'Built-in db tools registered');

        // Test db_put tool
        const putCall = {
            id: 'call-1',
            name: 'db_put',
            arguments: {
                key: 'mcp:test',
                value: 'Hello from MCP'
            }
        };
        const putResult = await mcpServer.callTool(putCall);
        console.log(`  db_put result:`, putResult.content);
        assert(putResult.isError === false, 'db_put executed successfully');

        // Test db_get tool
        const getCall = {
            id: 'call-2',
            name: 'db_get',
            arguments: {
                key: 'mcp:test'
            }
        };
        const getResult = await mcpServer.callTool(getCall);
        console.log(`  db_get result:`, getResult.content);
        assert(getResult.content === 'Hello from MCP', 'db_get retrieved correct value');

        // Test custom tool registration
        mcpServer.registerTool({
            name: 'custom_multiply',
            description: 'Multiplies two numbers',
            inputSchema: {
                type: 'object',
                properties: {
                    a: { type: 'number' },
                    b: { type: 'number' }
                },
                required: ['a', 'b']
            }
        }, async (args) => {
            const result = args.a * args.b;
            return result; // Just return the value, not wrapped
        });
        assert(true, 'Custom tool registered');

        const customCall = {
            id: 'call-3',
            name: 'custom_multiply',
            arguments: { a: 7, b: 6 }
        };
        const customResult = await mcpServer.callTool(customCall);
        assert(customResult.content === 42, `Custom tool returned 42 (got ${customResult.content})`);

        // Test resources
        const resources = await mcpServer.listResources();
        console.log(`  Resources available: ${resources.length}`);
        assert(resources.length > 0, 'At least one resource registered');

        // ============================================================
        // TEST 6: Policy Service - RBAC
        // ============================================================
        testSection('6. Policy Service - RBAC');

        const policyService = new PolicyService(db);
        assert(policyService !== null, 'Policy Service created');

        // Create namespace policy
        await policyService.createNamespacePolicy({
            namespace: 'secure-ns',
            defaultEffect: 'deny',
            rules: []
        });
        assert(true, 'Namespace policy created');

        // Add rules
        await policyService.addRule('secure-ns', {
            id: 'rule-1',
            name: 'AllowReadForUsers',
            effect: 'allow',
            principals: ['user:alice', 'user:bob'],
            actions: ['db:read'],
            resources: ['*'],
            description: 'Allow Alice and Bob to read'
        });
        assert(true, 'Read rule added for Alice and Bob');

        await policyService.addRule('secure-ns', {
            id: 'rule-2',
            name: 'AllowWriteForAdmins',
            effect: 'allow',
            principals: ['role:admin'],
            actions: ['db:write', 'db:delete'],
            resources: ['*'],
            description: 'Allow admins to write and delete'
        });
        assert(true, 'Write/Delete rule added for admins');

        // Test policy evaluation
        const readAllowed = await policyService.evaluate({
            principal: 'user:alice',
            action: 'db:read',
            resource: 'namespace:secure-ns:data',
            context: {}
        });
        console.log(`  user:alice read -> ${readAllowed.allowed} (${readAllowed.reason})`);
        assert(readAllowed.allowed === true, 'Alice can read');

        const writeAllowed = await policyService.evaluate({
            principal: 'user:alice',
            action: 'db:write',
            resource: 'namespace:secure-ns:data',
            context: {}
        });
        console.log(`  user:alice write -> ${writeAllowed.allowed} (${writeAllowed.reason})`);
        assert(writeAllowed.allowed === false, 'Alice cannot write');

        const adminWriteAllowed = await policyService.evaluate({
            principal: 'role:admin',
            action: 'db:write',
            resource: 'namespace:secure-ns:data',
            context: {}
        });
        console.log(`  role:admin write -> ${adminWriteAllowed.allowed} (${adminWriteAllowed.reason})`);
        assert(adminWriteAllowed.allowed === true, 'Admin can write');

        // Test grants
        await policyService.grantAccess({
            namespace: 'secure-ns',
            principal: 'user:charlie',
            permissions: ['read']
        });
        assert(true, 'Granted read access to Charlie');

        const charlieHasRead = await policyService.hasPermission('secure-ns', 'user:charlie', 'read');
        assert(charlieHasRead === true, 'Charlie has read permission');

        const charlieHasWrite = await policyService.hasPermission('secure-ns', 'user:charlie', 'write');
        assert(charlieHasWrite === false, 'Charlie does not have write permission');

        // Test audit log
        const auditLog = await policyService.getAuditLog();
        console.log(`  Audit log entries: ${auditLog.length}`);
        assert(auditLog.length > 0, 'Audit log contains entries');

        // ============================================================
        // TEST 7: End-to-End Integration
        // ============================================================
        testSection('7. End-to-End Integration Scenario');

        // Create a complete workflow combining all features
        const integrationNs = new Namespace(db, 'integration-test', { defaultIndexPolicy: 'balanced' });
        const docsCollection = await integrationNs.createCollection({ name: 'documents', dimension: 3 });

        // Add documents with vectors
        await docsCollection.insert([1.0, 0.0, 0.0], { 
            title: 'Machine Learning Basics',
            author: 'Alice'
        }, 'doc1');
        await docsCollection.insert([0.9, 0.1, 0.0], { 
            title: 'Deep Learning Introduction',
            author: 'Bob'
        }, 'doc2');
        await docsCollection.insert([0.0, 1.0, 0.0], { 
            title: 'Database Systems',
            author: 'Charlie'
        }, 'doc3');

        // Setup policy for this namespace
        await policyService.createNamespacePolicy({
            namespace: 'integration-test',
            defaultEffect: 'deny',
            rules: [{
                id: 'allow-all-read',
                name: 'AllowSearchForAll',
                effect: 'allow',
                principals: ['*'],
                actions: ['collection:search'],
                resources: ['*'],
                description: 'Allow everyone to search'
            }]
        });

        // Perform semantic search
        const query = [0.95, 0.05, 0.0]; // Similar to ML/DL docs
        const semanticResults = await docsCollection.search({ 
            queryVector: query, 
            k: 2,
            includeMetadata: true
        });
        console.log(`  Semantic search for ML query found ${semanticResults.length} results:`);
        semanticResults.forEach((r, i) => {
            console.log(`    ${i + 1}. ${r.metadata?.title} by ${r.metadata?.author} (score: ${r.score.toFixed(3)})`);
        });
        assert(semanticResults.length === 2, 'Found 2 semantic matches');
        assert(semanticResults[0].metadata?.title.includes('Machine Learning') || 
               semanticResults[0].metadata?.title.includes('Deep Learning'),
               'Top result is ML-related');

        // Verify policy enforcement
        const searchAllowed = await policyService.evaluate({
            principal: 'user:guest',
            action: 'collection:search',
            resource: 'namespace:integration-test:documents',
            context: {}
        });
        assert(searchAllowed.allowed === true, 'Guest can search (policy allows)');

        console.log(colors.green('\n  ✓ End-to-end integration working perfectly!'));

        // ============================================================
        // TEST 8: Batch Operations & Performance
        // ============================================================
        testSection('8. Batch Operations & Performance');

        const batchSize = 100;
        console.log(`  Inserting ${batchSize} key-value pairs...`);
        const startTime = Date.now();
        
        for (let i = 0; i < batchSize; i++) {
            await db.put(Buffer.from(`batch:${i.toString().padStart(5, '0')}`), Buffer.from(`Value ${i}`));
        }
        
        const insertTime = Date.now() - startTime;
        console.log(`  Inserted ${batchSize} records in ${insertTime}ms`);
        assert(insertTime < 10000, `Batch insert completed in reasonable time (${insertTime}ms < 10000ms)`);

        // Count inserted items (simple approach - read some of them)
        console.log(`  Verifying batch records exist...`);
        const sampleKey = Buffer.from('batch:00050');
        const sampleValue = await db.get(sampleKey);
        assert(sampleValue !== null, `Sample batch record exists (batch:00050)`);
        
        console.log(`  Successfully verified batch operations`);

        // ============================================================
        // Final Cleanup
        // ============================================================
        testSection('Cleanup');

        await db.close();
        console.log('  Database closed');
        
        cleanup();
        console.log('  Test directories cleaned up');

    } catch (error) {
        console.error(colors.red('\n✗ Test failed with error:'), error);
        testsFailed++;
    } finally {
        if (db) {
            try {
                await db.close();
            } catch (e) {
                // Already closed
            }
        }
    }

    // ============================================================
    // Test Summary
    // ============================================================
    console.log('\n' + colors.blue('═'.repeat(60)));
    console.log(colors.blue('  Test Summary'));
    console.log(colors.blue('═'.repeat(60)));
    console.log(`  Total assertions: ${testsPassed + testsFailed}`);
    console.log(colors.green(`  Passed: ${testsPassed}`));
    console.log(testsFailed > 0 ? colors.red(`  Failed: ${testsFailed}`) : colors.green(`  Failed: 0`));
    console.log(colors.blue('═'.repeat(60)));

    if (testsFailed === 0) {
        console.log(colors.green('\n🎉 All tests passed! SDK is production-ready.\n'));
        process.exit(0);
    } else {
        console.log(colors.red('\n❌ Some tests failed. Review output above.\n'));
        process.exit(1);
    }
}

// Run the tests
runTests().catch(error => {
    console.error(colors.red('Fatal error:'), error);
    process.exit(1);
});
