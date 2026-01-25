/**
 * Embedded Mode - FFI Support
 * 
 * Direct FFI bindings to SochDB native library.
 * No server required.
 */

export { EmbeddedDatabase, EmbeddedDatabaseConfig } from './database';
export { EmbeddedTransaction } from './transaction';
export { HnswIndex, HnswConfig, HnswBindings, SearchResult } from './ffi/hnsw-bindings';
