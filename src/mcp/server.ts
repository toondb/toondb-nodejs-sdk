/**
 * MCP Server Implementation
 * 
 * SochDB MCP Server for exposing database operations to LLM agents.
 */

import { EmbeddedDatabase } from '../embedded';
import {
  McpTool,
  McpToolCall,
  McpToolResult,
  McpResource,
  McpResourceContent,
  McpPrompt,
  McpPromptMessage,
  McpServerConfig,
  McpServerCapabilities,
  McpError,
  MCP_ERROR_CODES,
} from './types';

/**
 * MCP Server for SochDB
 * 
 * Exposes database operations as MCP tools for LLM agents.
 * 
 * @example
 * ```typescript
 * import { EmbeddedDatabase, McpServer } from '@sochdb/sochdb';
 * 
 * const db = EmbeddedDatabase.open('./mydb');
 * const server = new McpServer(db, {
 *   name: 'sochdb-mcp',
 *   version: '1.0.0',
 *   capabilities: { tools: true, resources: true }
 * });
 * 
 * // List available tools
 * const tools = server.listTools();
 * 
 * // Execute a tool call
 * const result = await server.callTool({
 *   id: 'call_1',
 *   name: 'db_get',
 *   arguments: { key: 'user:123' }
 * });
 * ```
 */
export class McpServer {
  private db: EmbeddedDatabase;
  private config: McpServerConfig;
  private tools: Map<string, McpTool> = new Map();
  private prompts: Map<string, McpPrompt> = new Map();
  private customToolHandlers: Map<string, (args: Record<string, any>) => Promise<any>> = new Map();

  constructor(db: EmbeddedDatabase, config: McpServerConfig) {
    this.db = db;
    this.config = config;
    this.registerBuiltinTools();
  }

  /**
   * Register built-in database tools
   */
  private registerBuiltinTools(): void {
    // Key-Value operations
    this.registerTool({
      name: 'db_get',
      description: 'Get a value from the database by key',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The key to retrieve' },
        },
        required: ['key'],
      },
    }, async (args) => {
      const value = await this.db.get(Buffer.from(args.key));
      return value ? value.toString() : null;
    });

    this.registerTool({
      name: 'db_put',
      description: 'Store a value in the database',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The key to store' },
          value: { type: 'string', description: 'The value to store' },
        },
        required: ['key', 'value'],
      },
    }, async (args) => {
      await this.db.put(Buffer.from(args.key), Buffer.from(args.value));
      return { success: true };
    });

    this.registerTool({
      name: 'db_delete',
      description: 'Delete a key from the database',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The key to delete' },
        },
        required: ['key'],
      },
    }, async (args) => {
      await this.db.delete(Buffer.from(args.key));
      return { success: true };
    });

    this.registerTool({
      name: 'db_scan',
      description: 'Scan keys with a prefix',
      inputSchema: {
        type: 'object',
        properties: {
          prefix: { type: 'string', description: 'The prefix to scan' },
          limit: { type: 'number', description: 'Maximum results', default: 100 },
        },
        required: ['prefix'],
      },
    }, async (args) => {
      const results: Array<{ key: string; value: string }> = [];
      const limit = args.limit || 100;
      let count = 0;

      for await (const [keyBuffer, valueBuffer] of this.db.scanPrefix(Buffer.from(args.prefix))) {
        if (count >= limit) break;
        results.push({
          key: keyBuffer.toString(),
          value: valueBuffer.toString(),
        });
        count++;
      }

      return results;
    });

    this.registerTool({
      name: 'db_stats',
      description: 'Get database statistics',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    }, async () => {
      const stats = await this.db.stats();
      return {
        memtableSizeBytes: stats.memtableSizeBytes.toString(),
        walSizeBytes: stats.walSizeBytes.toString(),
        activeTransactions: stats.activeTransactions,
      };
    });
  }

  /**
   * Register a custom tool
   */
  registerTool(
    tool: McpTool,
    handler: (args: Record<string, any>) => Promise<any>
  ): void {
    this.tools.set(tool.name, tool);
    this.customToolHandlers.set(tool.name, handler);
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): boolean {
    this.customToolHandlers.delete(name);
    return this.tools.delete(name);
  }

  /**
   * List all available tools
   */
  listTools(): McpTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Call a tool
   */
  async callTool(call: McpToolCall): Promise<McpToolResult> {
    const handler = this.customToolHandlers.get(call.name);
    
    if (!handler) {
      return {
        id: call.id,
        content: null,
        isError: true,
        errorMessage: `Tool not found: ${call.name}`,
      };
    }

    try {
      const content = await handler(call.arguments);
      return {
        id: call.id,
        content,
        isError: false,
      };
    } catch (error: any) {
      return {
        id: call.id,
        content: null,
        isError: true,
        errorMessage: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Register a prompt template
   */
  registerPrompt(prompt: McpPrompt): void {
    this.prompts.set(prompt.name, prompt);
  }

  /**
   * List all available prompts
   */
  listPrompts(): McpPrompt[] {
    return Array.from(this.prompts.values());
  }

  /**
   * Get prompt messages
   */
  getPrompt(name: string, args?: Record<string, any>): McpPromptMessage[] | null {
    const prompt = this.prompts.get(name);
    if (!prompt) {
      return null;
    }

    // For now, return empty messages - actual implementation would render the prompt
    return [];
  }

  /**
   * List available resources
   */
  async listResources(): Promise<McpResource[]> {
    // Return database stats as a resource
    return [{
      uri: 'sochdb://stats',
      name: 'Database Statistics',
      description: 'Current database statistics',
      mimeType: 'application/json',
    }];
  }

  /**
   * Read a resource
   */
  async readResource(uri: string): Promise<McpResourceContent | null> {
    if (uri === 'sochdb://stats') {
      const stats = await this.db.stats();
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(stats, (_, v) => 
          typeof v === 'bigint' ? v.toString() : v
        ),
      };
    }
    return null;
  }

  /**
   * Get server info
   */
  getServerInfo(): McpServerConfig {
    return { ...this.config };
  }
}
