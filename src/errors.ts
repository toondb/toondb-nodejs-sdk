/**
 * SochDB Error Classes
 *
 * @packageDocumentation
 */

// Copyright 2025 Sushanth (https://github.com/sushanthpy)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

/**
 * Base error class for all SochDB errors.
 */
export class SochDBError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SochDBError';
    Object.setPrototypeOf(this, SochDBError.prototype);
  }
}

/**
 * Error thrown when connection to the database fails.
 */
export class ConnectionError extends SochDBError {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionError';
    Object.setPrototypeOf(this, ConnectionError.prototype);
  }
}

/**
 * Error thrown when a transaction operation fails.
 */
export class TransactionError extends SochDBError {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionError';
    Object.setPrototypeOf(this, TransactionError.prototype);
  }
}

/**
 * Error thrown when there's a protocol error in IPC communication.
 */
export class ProtocolError extends SochDBError {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
    Object.setPrototypeOf(this, ProtocolError.prototype);
  }
}

/**
 * Error thrown when a database operation fails.
 */
export class DatabaseError extends SochDBError {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseError';
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}
