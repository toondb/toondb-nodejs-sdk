/**
 * Simple test for embedded FFI mode (JavaScript)
 */

const { Database } = require('../dist/cjs/index');
const fs = require('fs');
const path = require('path');

async function testEmbeddedMode() {
    const dbPath = path.join(__dirname, 'test_embedded_db');

    // Clean up if exists
    if (fs.existsSync(dbPath)) {
        fs.rmSync(dbPath, { recursive: true, force: true });
    }

    console.log('=== Testing Node.js Embedded Mode (FFI) ===\n');

    try {
        // 1. Open database
        console.log('1. Opening database...');
        const db = Database.open(dbPath);
        console.log('   ✓ Database opened successfully');

        // 2. Basic KV operations
        console.log('\n2. Testing basic KV operations...');
        await db.put(Buffer.from('test_key'), Buffer.from('test_value'));
        console.log('   ✓ Put successful');

        const value = await db.get(Buffer.from('test_key'));
        if (value?.toString() === 'test_value') {
            console.log('   ✓ Get successful, value matches');
        } else {
            throw new Error(`Expected 'test_value', got '${value?.toString()}'`);
        }

        // 3. Path operations
        console.log('\n3. Testing path operations...');
        await db.putPath('users/alice', Buffer.from('Alice'));
        const alice = await db.getPath('users/alice');
        if (alice?.toString() === 'Alice') {
            console.log('   ✓ Path operations successful');
        } else {
            throw new Error(`Expected 'Alice', got '${alice?.toString()}'`);
        }

        // 4. Transactions
        console.log('\n4. Testing transactions...');
        await db.withTransaction(async (txn) => {
            await txn.put(Buffer.from('txn_key1'), Buffer.from('value1'));
            await txn.put(Buffer.from('txn_key2'), Buffer.from('value2'));
        });

        const txnValue = await db.get(Buffer.from('txn_key1'));
        if (txnValue?.toString() === 'value1') {
            console.log('   ✓ Transaction commit successful');
        } else {
            throw new Error('Transaction did not commit properly');
        }

        // 5. Scan operations
        console.log('\n5. Testing scan operations...');
        await db.put(Buffer.from('scan_1'), Buffer.from('val1'));
        await db.put(Buffer.from('scan_2'), Buffer.from('val2'));
        await db.put(Buffer.from('scan_3'), Buffer.from('val3'));

        let count = 0;
        for await (const [key, value] of db.scanPrefix(Buffer.from('scan_'))) {
            count++;
        }

        if (count === 3) {
            console.log(`   ✓ Scan successful (found ${count} keys)`);
        } else {
            throw new Error(`Expected 3 keys, found ${count}`);
        }

        // 6. Stats
        console.log('\n6. Testing stats...');
        const stats = await db.stats();
        console.log(`   ✓ Stats retrieved: ${stats.activeTransactions} active transactions`);

        // 7. Checkpoint
        console.log('\n7. Testing checkpoint...');
        const lsn = await db.checkpoint();
        console.log(`   ✓ Checkpoint successful: LSN ${lsn}`);

        // Close
        db.close();
        console.log('\n8. Database closed');

        console.log('\n✅ All tests passed!');
        return true;

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        throw error;
    } finally {
        // Cleanup
        if (fs.existsSync(dbPath)) {
            fs.rmSync(dbPath, { recursive: true, force: true });
        }
    }
}

// Run tests
testEmbeddedMode()
    .then(() => {
        console.log('\nTest suite completed successfully');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\nTest suite failed:', err);
        process.exit(1);
    });
