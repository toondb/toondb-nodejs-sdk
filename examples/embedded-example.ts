/**
 * Simple example demonstrating embedded FFI mode
 */

import { Database } from '../src/index';

async function main() {
    console.log('=== ToonDB Node.js SDK - Embedded Mode (FFI) ===\n');

    // Open database (creates if doesn't exist)
    console.log('Opening database...');
    const db = Database.open('./example_db');

    try {
        // Simple KV operations
        console.log('\n1. Basic KV Operations:');
        await db.put(Buffer.from('user:1'), Buffer.from('Alice'));
        await db.put(Buffer.from('user:2'), Buffer.from('Bob'));

        const user1 = await db.get(Buffer.from('user:1'));
        console.log(`  user:1 = ${user1?.toString()}`);

        // Path operations
        console.log('\n2. Path Operations:');
        await db.putPath('users/alice/email', Buffer.from('alice@example.com'));
        await db.putPath('users/alice/age', Buffer.from('30'));

        const email = await db.getPath('users/alice/email');
        console.log(`  alice email = ${email?.toString()}`);

        // Transactions
        console.log('\n3. Transactions:');
        await db.withTransaction(async (txn) => {
            await txn.put(Buffer.from('counter'), Buffer.from('1'));
            await txn.put(Buffer.from('last_update'), Buffer.from(Date.now().toString()));
            console.log('  Transaction committed');
        });

        // Scan operations
        console.log('\n4. Scan Operations:');
        let count = 0;
        for await (const [key, value] of db.scanPrefix(Buffer.from('user:'))) {
            console.log(`  ${key.toString()} = ${value.toString()}`);
            count++;
        }
        console.log(`  Found ${count} users`);

        // Stats
        console.log('\n5. Database Stats:');
        const stats = await db.stats();
        console.log(`  Active transactions: ${stats.activeTransactions}`);
        console.log(`  Memtable size: ${stats.memtableSizeBytes} bytes`);

        // Checkpoint
        console.log('\n6. Checkpoint:');
        const lsn = await db.checkpoint();
        console.log(`  Checkpoint LSN: ${lsn}`);

    } finally {
        db.close();
        console.log('\nDatabase closed.');
    }
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
