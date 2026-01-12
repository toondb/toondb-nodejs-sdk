"use strict";
/**
 * Copyright 2025 Sushanth (https://github.com/sushanthpy)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FormatCapabilities = exports.CanonicalFormat = exports.ContextFormat = exports.WireFormat = exports.FormatConversionError = void 0;
/**
 * Unified Output Format Semantics
 *
 * Provides format enums for query results and LLM context packaging.
 * This mirrors the Rust toondb-client format module for consistency.
 */
/**
 * Error when format conversion fails.
 */
class FormatConversionError extends Error {
    constructor(fromFormat, toFormat, reason) {
        super(`Cannot convert ${fromFormat} to ${toFormat}: ${reason}`);
        this.fromFormat = fromFormat;
        this.toFormat = toFormat;
        this.reason = reason;
        this.name = 'FormatConversionError';
    }
}
exports.FormatConversionError = FormatConversionError;
/**
 * Output format for query results sent to clients.
 *
 * These formats are optimized for transmission efficiency and
 * client-side processing.
 */
var WireFormat;
(function (WireFormat) {
    /**
     * TOON format (default, 40-66% fewer tokens than JSON).
     * Optimized for LLM consumption.
     */
    WireFormat["TOON"] = "toon";
    /**
     * Standard JSON for compatibility.
     */
    WireFormat["JSON"] = "json";
    /**
     * Raw columnar format for analytics.
     * More efficient for large result sets with projection pushdown.
     */
    WireFormat["COLUMNAR"] = "columnar";
})(WireFormat || (exports.WireFormat = WireFormat = {}));
(function (WireFormat) {
    /**
     * Parse format from string.
     */
    function fromString(s) {
        const lower = s.toLowerCase();
        switch (lower) {
            case 'toon':
                return WireFormat.TOON;
            case 'json':
                return WireFormat.JSON;
            case 'columnar':
            case 'column':
                return WireFormat.COLUMNAR;
            default:
                throw new FormatConversionError(s, 'WireFormat', `Unknown format '${s}'. Valid: toon, json, columnar`);
        }
    }
    WireFormat.fromString = fromString;
})(WireFormat || (exports.WireFormat = WireFormat = {}));
/**
 * Output format for LLM context packaging.
 *
 * These formats are optimized for readability and token efficiency
 * when constructing prompts for language models.
 */
var ContextFormat;
(function (ContextFormat) {
    /**
     * TOON format (default, token-efficient).
     * Structured data with minimal syntax overhead.
     */
    ContextFormat["TOON"] = "toon";
    /**
     * JSON format.
     * Widely understood by LLMs, good for structured data.
     */
    ContextFormat["JSON"] = "json";
    /**
     * Markdown format.
     * Best for human-readable context with formatting.
     */
    ContextFormat["MARKDOWN"] = "markdown";
})(ContextFormat || (exports.ContextFormat = ContextFormat = {}));
(function (ContextFormat) {
    /**
     * Parse format from string.
     */
    function fromString(s) {
        const lower = s.toLowerCase();
        switch (lower) {
            case 'toon':
                return ContextFormat.TOON;
            case 'json':
                return ContextFormat.JSON;
            case 'markdown':
            case 'md':
                return ContextFormat.MARKDOWN;
            default:
                throw new FormatConversionError(s, 'ContextFormat', `Unknown format '${s}'. Valid: toon, json, markdown`);
        }
    }
    ContextFormat.fromString = fromString;
})(ContextFormat || (exports.ContextFormat = ContextFormat = {}));
/**
 * Canonical storage format (server-side only).
 *
 * This is the format used for internal storage and is optimized
 * for storage efficiency and query performance.
 */
var CanonicalFormat;
(function (CanonicalFormat) {
    /**
     * TOON canonical format.
     */
    CanonicalFormat["TOON"] = "toon";
})(CanonicalFormat || (exports.CanonicalFormat = CanonicalFormat = {}));
/**
 * Helper to check format capabilities and conversions.
 */
class FormatCapabilities {
    /**
     * Convert WireFormat to ContextFormat if compatible.
     */
    static wireToContext(wire) {
        switch (wire) {
            case WireFormat.TOON:
                return ContextFormat.TOON;
            case WireFormat.JSON:
                return ContextFormat.JSON;
            default:
                return null;
        }
    }
    /**
     * Convert ContextFormat to WireFormat if compatible.
     */
    static contextToWire(ctx) {
        switch (ctx) {
            case ContextFormat.TOON:
                return WireFormat.TOON;
            case ContextFormat.JSON:
                return WireFormat.JSON;
            default:
                return null;
        }
    }
    /**
     * Check if format supports round-trip: decode(encode(x)) = x.
     */
    static supportsRoundTrip(fmt) {
        return fmt === WireFormat.TOON || fmt === WireFormat.JSON;
    }
}
exports.FormatCapabilities = FormatCapabilities;
