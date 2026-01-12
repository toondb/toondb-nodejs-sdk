"use strict";
/**
 * ToonDB Query Builder
 *
 * Fluent query interface for ToonDB.
 *
 * @packageDocumentation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Query = void 0;
/**
 * Fluent query builder for ToonDB.
 *
 * @example
 * ```typescript
 * const results = await db.query('users/')
 *   .limit(10)
 *   .select(['name', 'email'])
 *   .toList();
 * ```
 */
class Query {
    constructor(client, pathPrefix) {
        this._client = client;
        this._pathPrefix = pathPrefix;
    }
    /**
     * Limit the number of results.
     *
     * @param n - Maximum number of results to return
     * @returns This query builder for chaining
     */
    limit(n) {
        this._limit = n;
        return this;
    }
    /**
     * Skip the first n results.
     *
     * @param n - Number of results to skip
     * @returns This query builder for chaining
     */
    offset(n) {
        this._offset = n;
        return this;
    }
    /**
     * Select specific columns to return.
     *
     * @param columns - Array of column names to select
     * @returns This query builder for chaining
     */
    select(columns) {
        this._columns = columns;
        return this;
    }
    /**
     * Execute the query and return results as TOON string.
     *
     * @returns TOON formatted string (e.g., "result[N]{cols}: row1; row2")
     */
    async execute() {
        return this._client.query(this._pathPrefix, {
            limit: this._limit,
            offset: this._offset,
            columns: this._columns,
        });
    }
    /**
     * Execute and parse results into a list of objects.
     *
     * @returns Array of result objects
     */
    async toList() {
        const toonStr = await this.execute();
        return this._parseToon(toonStr);
    }
    /**
     * Execute and return the first result, or null if none.
     *
     * @returns First result or null
     */
    async first() {
        const originalLimit = this._limit;
        this._limit = 1;
        const results = await this.toList();
        this._limit = originalLimit;
        return results.length > 0 ? results[0] : null;
    }
    /**
     * Execute and return the count of results.
     *
     * @returns Number of matching results
     */
    async count() {
        const results = await this.toList();
        return results.length;
    }
    /**
     * Simple TOON parser.
     *
     * Parses TOON format: "result[N]{col1,col2}: val1,val2; val3,val4"
     */
    _parseToon(toonStr) {
        if (!toonStr || toonStr === 'result[0]{}:') {
            return [];
        }
        // Parse header: result[N]{cols}:
        const headerMatch = toonStr.match(/^result\[(\d+)\]\{([^}]*)\}:\s*/);
        if (!headerMatch) {
            // Try to parse as JSON if not TOON format
            try {
                return JSON.parse(toonStr);
            }
            catch {
                return [];
            }
        }
        const count = parseInt(headerMatch[1], 10);
        if (count === 0) {
            return [];
        }
        const columns = headerMatch[2].split(',').map((c) => c.trim());
        const body = toonStr.substring(headerMatch[0].length);
        // Split rows by semicolon
        const rows = body.split(';').map((r) => r.trim()).filter((r) => r.length > 0);
        return rows.map((row) => {
            const values = row.split(',').map((v) => v.trim());
            const result = {};
            columns.forEach((col, idx) => {
                if (col && idx < values.length) {
                    // Try to parse as JSON/number
                    let value = values[idx];
                    if (value === 'null') {
                        value = null;
                    }
                    else if (value === 'true') {
                        value = true;
                    }
                    else if (value === 'false') {
                        value = false;
                    }
                    else if (!isNaN(Number(value))) {
                        value = Number(value);
                    }
                    result[col] = value;
                }
            });
            return result;
        });
    }
}
exports.Query = Query;
