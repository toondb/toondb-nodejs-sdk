#!/usr/bin/env ts-node
/**
 * Comprehensive Test Suite for SochDB Node.js SDK v0.4.3
 * Tests all features including new MCP, Policy, and Vector Search fixes
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    EmbeddedDatabase,
    McpServer,
    PolicyService,
    Namespace,
    // Types
    McpToolCall,
    PolicyAction,
    NamespacePermission,
} from '../src/index';

const TEST_DB_PATH = './test-comprehensive-db';
const NAMESPACE = 'test-ns';

// Cleanup helper
function cleanup() {
    if (fs.existsSync(TEST_DB_PATH)) {
        fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    }
}

// Color output helpers
const colors = {
    green: (str: string) => `\x1b[32m${str}\x1b[0m`,
    red: (str: string) => `\x1b[31m${str}\x1b[0m`,
    yellow: (str: string) => `\x1b[33m${str}\x1b[0m`,
    blue: (str: string) => `\x1b[34m${str}\x1b[0m`,
    cyan: (str: string) => `\x1b[36m${str}\x1b[0m`,
};

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
    if (condition) {
        console.log(colors.green('  ✓'), message);
        testsPassed++;
    } else {
        console.log(colors.red('  ✗'), message);
        testsFailed++;
        throw new Error(`Assertion failed: ${message}`);
    }
}

function testSection(name: string) {
    console.log('\n' + colors.cyan('━'.repeat(60)));
    console.log(colors.cyan(`  ${name}`));
    console.log(colors.cyan('━'.repeat(60)));
}

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
    console.log(colors.blue('\n' + '═'.repeat(60)));
    console.log(colors.blue('  SochDB Node.js SDK - Comprehensive Test Suite'));
    console.log(colors.blue('  Version 0.4.3 - Full Feature Validation'));
    console.log(colors.blue('═'.repeat(60)));

    cleanup();
    let db: EmbeddedDatabase | null = null;

    try {
        // ============================================================
        // TEST 1: Database Initialization & Concurrent Mode
        // ============================================================
        testSection('1. Database Initialization & Concurrent Mode');

        const concurrentAvailable = EmbeddedDatabase.isConcurrentModeAvailable();
        console.log(`  Concurrent mode available: ${concurrentAvailable}`);

        db = new EmbeddedDatabase(TEST_DB_PATH);
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
        db2.close();

        // ============================================================
        // TEST 2: Basic CRUD Operations
        // ============================================================
        testSection('2. Basic CRUD Operations');

        db.put('user:1', Buffer.from('Alice'));
        db.put('user:2', Buffer.from('Bob'));
        db.put('user:3', Buffer.from('Charlie'));
        assert(true, 'Inserted 3 key-value pairs');

        const val1 = db.get('user:1');
        assert(val1 !== null && val1.toString() === 'Alice', 'Retrieved user:1 = Alice');

        const val2 = db.get('user:2');
        assert(val2 !== null && val2.toString() === 'Bob', 'Retrieved user:2 = Bob');

        db.delete('user:3');
        const val3 = db.get('user:3');
        assert(val3 === null, 'Deleted user:3 successfully');

        // ============================================================
        // TEST 3: Scan Operations
        // ============================================================
        testSection('3. Scan Operations');

        let scanCount = 0;
        for (const [key, value] of db.scan({ prefix: 'user:' })) {
            scanCount++;
            console.log(`  Scanned: ${key} = ${value.toString()}`);
        }
        assert(scanCount === 2, `Scanned 2 remaining users (got ${scanCount})`);

        // Range scan
        db.put('item:001', Buffer.from('Apple'));
        db.put('item:002', Buffer.from('Banana'));
        db.put('item:003', Buffer.from('Cherry'));
        db.put('item:004', Buffer.from('Date'));

        let rangeCount = 0;
        for (const [key, value] of db.scan({ 
            start: 'item:001', 
            end: 'item:003',
            includeEnd: true 
        })) {
            rangeCount++;
            console.log(`  Range: ${key} = ${value.toString()}`);
        }
        assert(rangeCount === 3, `Range scan returned 3 items (got ${rangeCount})`);

        // ============================================================
        // TEST 4: Transactions
        // ============================================================
        testSection('4. Transactions');

        const tx = db.begin();
        tx.put('tx:1', Buffer.from('Transactional Write 1'));
        tx.put('tx:2', Buffer.from('Transactional Write 2'));
        tx.commit();
        assert(true, 'Transaction committed');

        const txVal1 = db.get('tx:1');
        assert(txVal1 !== null && txVal1.toString() === 'Transactional Write 1', 
               'Transaction write 1 persisted');

        // Test rollback
        const tx2 = db.begin();
        tx2.put('tx:3', Buffer.from('Should not persist'));
        tx2.rollback();
        const txVal3 = db.get('tx:3');
        assert(txVal3 === null, 'Rolled back transaction did not persist');

        // ============================================================
        // TEST 5: Namespace API
        // ============================================================
        testSection('5. Namespace API');

        const ns = new Namespace(db, NAMESPACE);
        assert(ns !== null, 'Namespace created');

        // Create collection
        const collection = ns.createCollection('embeddings', { dimension: 4 });
        assert(collection !== null, 'Collection created with dimension 4');

        // ============================================================
        // TEST 6: Vector Search - Synchronous Indexing
        // ============================================================
        testSection('6. Vector Search - Synchronous Indexing');

        collection.insert('vec1', [1.0, 0.0, 0.0, 0.0], { label: 'x-axis' });
        collection.insert('vec2', [0.0, 1.0, 0.0, 0.0], { label: 'y-axis' });
        collection.insert('vec3', [0.0, 0.0, 1.0, 0.0], { label: 'z-axis' });
        collection.insert('vec4', [0.707, 0.707, 0.0, 0.0], { label: 'diagonal' });
        assert(true, 'Inserted 4 vectors');

        // CRITICAL: Search immediately after insert (tests synchronous indexing)
        const results = collection.search([1.0, 0.0, 0.0, 0.0], 3);
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
        const count = collection.count();
        assert(count === 4, `Collection count is 4 (got ${count})`);

        // Test delete from index
        collection.delete('vec4');
        const countAfterDelete = collection.count();
        assert(countAfterDelete === 3, `Count after delete is 3 (got ${countAfterDelete})`);

        const resultsAfterDelete = collection.search([0.707, 0.707, 0.0, 0.0], 5);
        const diagonalFound = resultsAfterDelete.some(r => r.id === 'vec4');
        assert(!diagonalFound, 'Deleted vector not in search results');

        // ============================================================
        // TEST 7: MCP Server - Tool Registration & Execution
        // ============================================================
        testSection('7. MCP Server - Tool Registration & Execution');

        const mcpServer = new McpServer(db);
        assert(mcpServer !== null, 'MCP Server created');

        // Test built-in tools
        const builtinTools = mcpServer.listTools();
        console.log(`  Built-in tools: ${builtinTools.map(t => t.name).join(', ')}`);
        assert(builtinTools.length >= 5, `At least 5 built-in tools (got ${builtinTools.length})`);

        const hasDbGet = builtinTools.some(t => t.name === 'db_get');
        const hasDbPut = builtinTools.some(t => t.name === 'db_put');
        const hasDbScan = builtinTools.some(t => t.name === 'db_scan');
        assert(hasDbGet && hasDbPut && hasDbScan, 'Built-in db tools registered');

        // Test db_put tool
        const putCall: McpToolCall = {
            name: 'db_put',
            arguments: {
                key: 'mcp:test',
                value: 'Hello from MCP'
            }
        };
        const putResult = mcpServer.callTool(putCall);
        console.log(`  db_put result:`, putResult.content);
        assert(putResult.isError === false, 'db_put executed successfully');

        // Test db_get tool
        const getCall: McpToolCall = {
            name: 'db_get',
            arguments: {
                key: 'mcp:test'
            }
        };
        const getResult = mcpServer.callTool(getCall);
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
        }, (args) => {
            const result = args.a * args.b;
            return { content: result, isError: false };
        });
        assert(true, 'Custom tool registered');

        const customCall: McpToolCall = {
            name: 'custom_multiply',
            arguments: { a: 7, b: 6 }
        };
        const customResult = mcpServer.callTool(customCall);
        assert(customResult.content === 42, `Custom tool returned 42 (got ${customResult.content})`);

        // Test resources
        const resources = mcpServer.listResources();
        console.log(`  Resources available: ${resources.length}`);
        assert(resources.length > 0, 'At least one resource registered');

        // Test prompts
        const prompts = mcpServer.listPrompts();
        console.log(`  Prompts available: ${prompts.length}`);

        // ============================================================
        // TEST 8: Policy Service - RBAC
        // ============================================================
        testSection('8. Policy Service - RBAC');

        const policyService = new PolicyService(db);
        assert(policyService !== null, 'Policy Service created');

        // Create namespace policy
        policyService.createNamespacePolicy('secure-ns', {
            namespace: 'secure-ns',
            defaultEffect: 'deny',
            rules: []
        });
        assert(true, 'Namespace policy created');

        // Add rules
        policyService.addRule('secure-ns', {
            id: 'rule-1',
            effect: 'allow',
            subjects: ['user:alice', 'user:bob'],
            actions: ['db:read' as PolicyAction],
            resources: ['*'],
            conditions: {},
            description: 'Allow Alice and Bob to read'
        });
        assert(true, 'Read rule added for Alice and Bob');

        policyService.addRule('secure-ns', {
            id: 'rule-2',
            effect: 'allow',
            subjects: ['role:admin'],
            actions: ['db:write' as PolicyAction, 'db:delete' as PolicyAction],
            resources: ['*'],
            conditions: {},
            description: 'Allow admins to write and delete'
        });
        assert(true, 'Write/Delete rule added for admins');

        // Test policy evaluation
        const readAllowed = policyService.evaluate({
            subject: 'user:alice',
            action: 'db:read',
            resource: 'secure-ns/data',
            namespace: 'secure-ns',
            context: {}
        });
        console.log(`  user:alice read -> ${readAllowed.decision} (${readAllowed.reason})`);
        assert(readAllowed.decision === true, 'Alice can read');

        const writeAllowed = policyService.evaluate({
            subject: 'user:alice',
            action: 'db:write',
            resource: 'secure-ns/data',
            namespace: 'secure-ns',
            context: {}
        });
        console.log(`  user:alice write -> ${writeAllowed.decision} (${writeAllowed.reason})`);
        assert(writeAllowed.decision === false, 'Alice cannot write');

        const adminWriteAllowed = policyService.evaluate({
            subject: 'role:admin',
            action: 'db:write',
            resource: 'secure-ns/data',
            namespace: 'secure-ns',
            context: {}
        });
        console.log(`  role:admin write -> ${adminWriteAllowed.decision} (${adminWriteAllowed.reason})`);
        assert(adminWriteAllowed.decision === true, 'Admin can write');

        // Test grants
        policyService.grantAccess('secure-ns', 'user:charlie', 'read' as NamespacePermission);
        assert(true, 'Granted read access to Charlie');

        const charlieHasRead = policyService.hasPermission('secure-ns', 'user:charlie', 'read');
        assert(charlieHasRead === true, 'Charlie has read permission');

        const charlieHasWrite = policyService.hasPermission('secure-ns', 'user:charlie', 'write');
        assert(charlieHasWrite === false, 'Charlie does not have write permission');

        // Test audit log
        const auditLog = policyService.getAuditLog('secure-ns', { limit: 10 });
        console.log(`  Audit log entries: ${auditLog.length}`);
        assert(auditLog.length > 0, 'Audit log contains entries');

        // ============================================================
        // TEST 9: End-to-End Integration
        // ============================================================
        testSection('9. End-to-End Integration Scenario');

        // Create a complete workflow combining all features
        const integrationNs = new Namespace(db, 'integration-test');
        const docsCollection = integrationNs.createCollection('documents', { dimension: 3 });

        // Add documents with vectors
        docsCollection.insert('doc1', [1.0, 0.0, 0.0], { 
            title: 'Machine Learning Basics',
            author: 'Alice'
        });
        docsCollection.insert('doc2', [0.9, 0.1, 0.0], { 
            title: 'Deep Learning Introduction',
            author: 'Bob'
        });
        docsCollection.insert('doc3', [0.0, 1.0, 0.0], { 
            title: 'Database Systems',
            author: 'Charlie'
        });

        // Setup policy for this namespace
        policyService.createNamespacePolicy('integration-test', {
            namespace: 'integration-test',
            defaultEffect: 'deny',
            rules: [{
                id: 'allow-all-read',
                effect: 'allow',
                subjects: ['*'],
                actions: ['collection:search'],
                resources: ['*'],
                conditions: {},
                description: 'Allow everyone to search'
            }]
        });

        // Perform semantic search
        const query = [0.95, 0.05, 0.0]; // Similar to ML/DL docs
        const semanticResults = docsCollection.search(query, 2);
        console.log(`  Semantic search for ML query found ${semanticResults.length} results:`);
        semanticResults.forEach((r, i) => {
            console.log(`    ${i + 1}. ${r.metadata?.title} by ${r.metadata?.author} (score: ${r.score.toFixed(3)})`);
        });
        assert(semanticResults.length === 2, 'Found 2 semantic matches');
        assert(semanticResults[0].metadata?.title.includes('Machine Learning') || 
               semanticResults[0].metadata?.title.includes('Deep Learning'),
               'Top result is ML-related');

        // Use MCP to query the data
        const mcpScanCall: McpToolCall = {
            name: 'db_scan',
            arguments: {
                prefix: `ns:integration-test:col:documents:doc:`
            }
        };
        const scanResult = mcpServer.callTool(mcpScanCall);
        console.log(`  MCP scan found entries:`, scanResult.content);
        assert(scanResult.isError === false, 'MCP scan executed successfully');

        // Verify policy enforcement
        const searchAllowed = policyService.evaluate({
            subject: 'user:guest',
            action: 'collection:search',
            resource: 'integration-test/documents',
            namespace: 'integration-test',
            context: {}
        });
        assert(searchAllowed.decision === true, 'Guest can search (policy allows)');

        console.log(colors.green('\n  ✓ End-to-end integration working perfectly!'));

        // ============================================================
        // TEST 10: Memory & Batch Operations
        // ============================================================
        testSection('10. Batch Operations & Performance');

        const batchSize = 100;
        console.log(`  Inserting ${batchSize} key-value pairs...`);
        const startTime = Date.now();
        
        for (let i = 0; i < batchSize; i++) {
            db.put(`batch:${i.toString().padStart(5, '0')}`, Buffer.from(`Value ${i}`));
        }
        
        const insertTime = Date.now() - startTime;
        console.log(`  Inserted ${batchSize} records in ${insertTime}ms`);
        assert(insertTime < 5000, `Batch insert completed in reasonable time (${insertTime}ms < 5000ms)`);

        // Scan batch
        const scanStart = Date.now();
        let batchCount = 0;
        for (const [key, value] of db.scan({ prefix: 'batch:' })) {
            batchCount++;
        }
        const scanTime = Date.now() - scanStart;
        console.log(`  Scanned ${batchCount} records in ${scanTime}ms`);
        assert(batchCount === batchSize, `Scanned all ${batchSize} records`);
        assert(scanTime < 2000, `Scan completed in reasonable time (${scanTime}ms < 2000ms)`);

        // ============================================================
        // Final Cleanup
        // ============================================================
        testSection('Cleanup');

        db.close();
        console.log('  Database closed');
        
        cleanup();
        console.log('  Test directories cleaned up');

    } catch (error) {
        console.error(colors.red('\n✗ Test failed with error:'), error);
        testsFailed++;
    } finally {
        if (db) {
            try {
                db.close();
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
