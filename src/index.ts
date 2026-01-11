/**
 * ToonDB Node.js SDK v0.3.4
 * 
 * Dual-mode architecture: Embedded (FFI) + Server (gRPC/IPC)
 * 
 * Architecture: Flexible Deployment
 * ==================================
 * This SDK supports BOTH modes:
 * 
 * 1. Embedded Mode (FFI) - For single-process apps:
 *    - Direct FFI bindings to Rust libraries
 *    - No server required - just npm install and run
 *    - Best for: Local development, simple apps
 * 
 * 2. Server Mode (gRPC/IPC) - For distributed systems:
 *    - Thin client connecting to toondb-grpc server
 *    - Best for: Production, multi-language, scalability
 * 
 * @example Embedded Mode
 * ```typescript
 * import { Database } from '@sushanth/toondb';
 * 
 * // Direct FFI - no server needed
 * const db = await Database.open('./mydb');
 * await db.put(Buffer.from('key'), Buffer.from('value'));
 * await db.close();
 * ```
 * 
 * @example Server Mode
 * ```typescript
 * import { ToonDBClient } from '@sushanth/toondb';
 * 
 * // Connect to server
 * const client = new ToonDBClient({ address: 'localhost:50051' });
 * await client.putKv('key', Buffer.from('value'));
 * ```
 */

// Version
export const VERSION = '0.3.6';

// Embedded mode (FFI) - NEW
export { EmbeddedDatabase, EmbeddedDatabaseConfig } from './embedded';
export { EmbeddedTransaction } from './embedded';

// Embedded mode (FFI) - Convenience alias
export { EmbeddedDatabase as Database } from './embedded';

// Server mode (gRPC/IPC)
export { ToonDBClient } from './grpc-client';
export type {
  SearchResult,
  Document,
  GraphNode,
  GraphEdge,
} from './grpc-client';

export { IpcClient } from './ipc-client';

// Format utilities
export {
  WireFormat,
  ContextFormat,
  CanonicalFormat,
  FormatCapabilities,
  FormatConversionError,
} from './format';

// Type definitions
export { Query } from './query';
export type { QueryResult } from './query';

export {
  ToonDBError,
  ConnectionError,
  TransactionError,
  ProtocolError,
  DatabaseError,
} from './errors';

// Convenience alias
export { ToonDBClient as GrpcClient } from './grpc-client';
