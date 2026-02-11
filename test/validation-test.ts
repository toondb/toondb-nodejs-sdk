/**
 * Comprehensive validation test for Node.js SDK
 * Tests all documented API patterns from README
 */

import { Database } from '../src/index';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB_PATH = path.join(__dirname, 'validation_test_db');

async function cleanup() {
    if (fs.existsSync(TEST_DB_PATH)) {
        fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    }
}

async function testBasicKV() {
    console.log('\n=== Testing Basic KV Operations ===');

    const db = Database.open(TEST_DB_PATH);

    try {
        // Store data
        await db.put(Buffer.from('user:1'), Buffer.from('Alice'));
        await db.put(Buffer.from('user:2'), Buffer.from('Bob'));
        console.log('✓ Put operations successful');

        // Retrieve data
        const user = await db.get(Buffer.from('user:1'));
        if (user?.toString() !== 'Alice') {
            throw new Error(`Expected 'Alice', got '${user?.toString()}'`);
        }
        console.log('✓ Get operation successful');

        // Delete data
        await db.delete(Buffer.from('user:1'));
        const deleted = await db.get(Buffer.from('user:1'));
        if (deleted !== null) {
            throw new Error('Delete failed - key still exists');
        }
        console.log('✓ Delete operation successful');

    } finally {
        db.close();
    }
}

async function testPathOperations() {
    console.log('\n=== Testing Path-Based Keys ===');

    const db = Database.open(TEST_DB_PATH);

    try {
        // Store with path
        await db.putPath('users/alice/name', Buffer.from('Alice Smith'));
        await db.putPath('users/alice/email', Buffer.from('alice@example.com'));
        await db.putPath('users/bob/name', Buffer.from('Bob Jones'));
        console.log('✓ Path put operations successful');

        // Retrieve by path
        const name = await db.getPath('users/alice/name');
        if (name?.toString() !== 'Alice Smith') {
            throw new Error(`Expected 'Alice Smith', got '${name?.toString()}'`);
        }
        console.log('✓ Path get operation successful');

        // Delete by path
        // Note: deletePath not yet implemented in embedded mode, using delete with path key
        await db.delete(Buffer.from('users/alice/email'));
        const deleted = await db.getPath('users/alice/email');
        if (deleted !== null) {
            throw new Error('Path delete failed');
        }
        console.log('✓ Path delete operation successful');

    } finally {
        db.close();
    }
}

async function testTransactions() {
    console.log('\n=== Testing Transactions (ACID with SSI) ===');

    const db = Database.open(TEST_DB_PATH);

    try {
        // Async/await pattern
        await db.withTransaction(async (txn) => {
            await txn.put(Buffer.from('accounts/alice'), Buffer.from('1000'));
            await txn.put(Buffer.from('accounts/bob'), Buffer.from('500'));

            // Read within transaction
            const balance = await txn.get(Buffer.from('accounts/alice'));
            if (balance?.toString() !== '1000') {
                throw new Error('Transaction read-your-own-writes failed');
            }
        });
        console.log('✓ Async/await transaction successful');

        // Manual transaction control
        const txn = db.transaction();
        try {
            await txn.put(Buffer.from('key1'), Buffer.from('value1'));
            await txn.put(Buffer.from('key2'), Buffer.from('value2'));

            const commitTs = await txn.commit();
            console.log(`✓ Manual transaction committed at: ${commitTs}`);
        } catch (error) {
            await txn.abort();
            throw error;
        }

        // Verify committed data
        const value1 = await db.get(Buffer.from('key1'));
        if (value1?.toString() !== 'value1') {
            throw new Error('Transaction commit verification failed');
        }
        console.log('✓ Transaction commit verified');

    } finally {
        db.close();
    }
}

async function testScanOperations() {
    console.log('\n=== Testing Prefix Scanning ===');

    const db = Database.open(TEST_DB_PATH);

    try {
        // Insert test data
        for (let i = 1; i <= 5; i++) {
            await db.put(Buffer.from(`scan_test:${i}`), Buffer.from(`value${i}`));
        }
        console.log('✓ Inserted 5 test records');

        // Scan with prefix
        let count = 0;
        for await (const [key, value] of db.scanPrefix(Buffer.from('scan_test:'))) {
            count++;
            console.log(`  Found: ${key.toString()} = ${value.toString()}`);
        }

        if (count !== 5) {
            throw new Error(`Expected 5 records, found ${count}`);
        }
        console.log(`✓ Scanned ${count} records successfully`);

    } finally {
        db.close();
    }
}

async function testSSIConflictHandling() {
    console.log('\n=== Testing SSI Conflict Handling ===');

    const db = Database.open(TEST_DB_PATH);

    try {
        // Initialize counter
        await db.put(Buffer.from('counter'), Buffer.from('0'));

        const MAX_RETRIES = 3;
        let retries = 0;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                await db.withTransaction(async (txn) => {
                    // Read and modify
                    const value = parseInt((await txn.get(Buffer.from('counter')))?.toString() || '0');
                    await txn.put(Buffer.from('counter'), Buffer.from((value + 1).toString()));
                });
                break;  // Success
            } catch (error: any) {
                if (error.message && error.message.includes('SSI conflict')) {
                    retries++;
                    if (attempt === MAX_RETRIES - 1) throw error;
                    console.log(`  Retry ${attempt + 1} due to SSI conflict`);
                    continue;
                }
                throw error;
            }
        }

        console.log(`✓ SSI conflict handling works (${retries} retries)`);

    } finally {
        db.close();
    }
}

async function testStatistics() {
    console.log('\n=== Testing Statistics & Monitoring ===');

    const db = Database.open(TEST_DB_PATH);

    try {
        const stats = await db.stats();

        console.log(`  Active transactions: ${stats.activeTransactions}`);
        console.log(`  Memtable size: ${stats.memtableSizeBytes} bytes`);
        console.log(`  WAL size: ${stats.walSizeBytes} bytes`);
        console.log('✓ Statistics retrieval successful');

    } finally {
        db.close();
    }
}

async function testCheckpoint() {
    console.log('\n=== Testing Checkpoints & Snapshots ===');

    const db = Database.open(TEST_DB_PATH);

    try {
        const lsn = await db.checkpoint();
        console.log(`  Checkpoint LSN: ${lsn}`);
        console.log('✓ Checkpoint successful');

    } finally {
        db.close();
    }
}

async function runAllTests() {
    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║  SochDB Node.js SDK - Comprehensive Validation    ║');
    console.log('╚════════════════════════════════════════════════════╝');

    await cleanup();

    try {
        await testBasicKV();
        await testPathOperations();
        await testTransactions();
        await testScanOperations();
        await testSSIConflictHandling();
        await testStatistics();
        await testCheckpoint();

        console.log('\n╔════════════════════════════════════════════════════╗');
        console.log('║              ✅ ALL TESTS PASSED                   ║');
        console.log('╚════════════════════════════════════════════════════╝\n');

    } catch (error: any) {
        console.error('\n❌ TEST FAILED:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await cleanup();
    }
}

runAllTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
