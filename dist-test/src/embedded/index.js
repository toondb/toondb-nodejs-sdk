"use strict";
/**
 * Embedded Mode - FFI Support
 *
 * Direct FFI bindings to ToonDB native library.
 * No server required.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddedTransaction = exports.EmbeddedDatabase = void 0;
var database_1 = require("./database");
Object.defineProperty(exports, "EmbeddedDatabase", { enumerable: true, get: function () { return database_1.EmbeddedDatabase; } });
var transaction_1 = require("./transaction");
Object.defineProperty(exports, "EmbeddedTransaction", { enumerable: true, get: function () { return transaction_1.EmbeddedTransaction; } });
