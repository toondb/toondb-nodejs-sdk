"use strict";
/**
 * ToonDB Error Classes
 *
 * @packageDocumentation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseError = exports.ProtocolError = exports.TransactionError = exports.ConnectionError = exports.ToonDBError = void 0;
// Copyright 2025 Sushanth (https://github.com/sushanthpy)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
/**
 * Base error class for all ToonDB errors.
 */
class ToonDBError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToonDBError';
        Object.setPrototypeOf(this, ToonDBError.prototype);
    }
}
exports.ToonDBError = ToonDBError;
/**
 * Error thrown when connection to the database fails.
 */
class ConnectionError extends ToonDBError {
    constructor(message) {
        super(message);
        this.name = 'ConnectionError';
        Object.setPrototypeOf(this, ConnectionError.prototype);
    }
}
exports.ConnectionError = ConnectionError;
/**
 * Error thrown when a transaction operation fails.
 */
class TransactionError extends ToonDBError {
    constructor(message) {
        super(message);
        this.name = 'TransactionError';
        Object.setPrototypeOf(this, TransactionError.prototype);
    }
}
exports.TransactionError = TransactionError;
/**
 * Error thrown when there's a protocol error in IPC communication.
 */
class ProtocolError extends ToonDBError {
    constructor(message) {
        super(message);
        this.name = 'ProtocolError';
        Object.setPrototypeOf(this, ProtocolError.prototype);
    }
}
exports.ProtocolError = ProtocolError;
/**
 * Error thrown when a database operation fails.
 */
class DatabaseError extends ToonDBError {
    constructor(message) {
        super(message);
        this.name = 'DatabaseError';
        Object.setPrototypeOf(this, DatabaseError.prototype);
    }
}
exports.DatabaseError = DatabaseError;
