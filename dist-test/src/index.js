"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrpcClient = exports.DatabaseError = exports.ProtocolError = exports.TransactionError = exports.ConnectionError = exports.ToonDBError = exports.Query = exports.FormatConversionError = exports.FormatCapabilities = exports.CanonicalFormat = exports.ContextFormat = exports.WireFormat = exports.IpcClient = exports.ToonDBClient = exports.Database = exports.EmbeddedTransaction = exports.EmbeddedDatabase = exports.VERSION = void 0;
// Version
exports.VERSION = '0.3.6';
// Embedded mode (FFI) - NEW
var embedded_1 = require("./embedded");
Object.defineProperty(exports, "EmbeddedDatabase", { enumerable: true, get: function () { return embedded_1.EmbeddedDatabase; } });
var embedded_2 = require("./embedded");
Object.defineProperty(exports, "EmbeddedTransaction", { enumerable: true, get: function () { return embedded_2.EmbeddedTransaction; } });
// Embedded mode (FFI) - Convenience alias
var embedded_3 = require("./embedded");
Object.defineProperty(exports, "Database", { enumerable: true, get: function () { return embedded_3.EmbeddedDatabase; } });
// Server mode (gRPC/IPC)
var grpc_client_1 = require("./grpc-client");
Object.defineProperty(exports, "ToonDBClient", { enumerable: true, get: function () { return grpc_client_1.ToonDBClient; } });
var ipc_client_1 = require("./ipc-client");
Object.defineProperty(exports, "IpcClient", { enumerable: true, get: function () { return ipc_client_1.IpcClient; } });
// Format utilities
var format_1 = require("./format");
Object.defineProperty(exports, "WireFormat", { enumerable: true, get: function () { return format_1.WireFormat; } });
Object.defineProperty(exports, "ContextFormat", { enumerable: true, get: function () { return format_1.ContextFormat; } });
Object.defineProperty(exports, "CanonicalFormat", { enumerable: true, get: function () { return format_1.CanonicalFormat; } });
Object.defineProperty(exports, "FormatCapabilities", { enumerable: true, get: function () { return format_1.FormatCapabilities; } });
Object.defineProperty(exports, "FormatConversionError", { enumerable: true, get: function () { return format_1.FormatConversionError; } });
// Type definitions
var query_1 = require("./query");
Object.defineProperty(exports, "Query", { enumerable: true, get: function () { return query_1.Query; } });
var errors_1 = require("./errors");
Object.defineProperty(exports, "ToonDBError", { enumerable: true, get: function () { return errors_1.ToonDBError; } });
Object.defineProperty(exports, "ConnectionError", { enumerable: true, get: function () { return errors_1.ConnectionError; } });
Object.defineProperty(exports, "TransactionError", { enumerable: true, get: function () { return errors_1.TransactionError; } });
Object.defineProperty(exports, "ProtocolError", { enumerable: true, get: function () { return errors_1.ProtocolError; } });
Object.defineProperty(exports, "DatabaseError", { enumerable: true, get: function () { return errors_1.DatabaseError; } });
// Convenience alias
var grpc_client_2 = require("./grpc-client");
Object.defineProperty(exports, "GrpcClient", { enumerable: true, get: function () { return grpc_client_2.ToonDBClient; } });
