/**
 * Integration test for Namespace and Queue features (v0.4.1)
 */

import { Database, Namespace, Collection, PriorityQueue, TaskState } from '../src';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB_PATH = path.join(__dirname, '../test-data/namespace-test-db');

// Clean up test database before tests
function cleanup() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
  }
}

describe('Namespace API (v0.4.1)', () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  test('should export Namespace and Collection classes', () => {
    expect(Namespace).toBeDefined();
    expect(Collection).toBeDefined();
  });

  test('namespace and collection types should be available', async () => {
    // This test just verifies the types are exported
    expect(typeof Namespace).toBe('function');
    expect(typeof Collection).toBe('function');
  });
});

describe('Queue API (v0.4.1)', () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  test('should export PriorityQueue class', () => {
    expect(PriorityQueue).toBeDefined();
  });

  test('should export TaskState enum', () => {
    expect(TaskState).toBeDefined();
    expect(TaskState.PENDING).toBe('pending');
    expect(TaskState.CLAIMED).toBe('claimed');
    expect(TaskState.COMPLETED).toBe('completed');
    expect(TaskState.DEAD_LETTERED).toBe('dead_lettered');
  });

  test('queue types should be available', async () => {
    // This test just verifies the types are exported
    expect(typeof PriorityQueue).toBe('function');
  });
});

describe('SDK Version', () => {
  test('should be version 0.5.2', async () => {
    const { VERSION } = await import('../src/index');
    expect(VERSION).toBe('0.5.2');
  });
});
