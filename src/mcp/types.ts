/**
 * MCP (Model Context Protocol) Types
 * 
 * Type definitions for Model Context Protocol integration with LLM agents.
 */

/**
 * MCP Tool definition
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  outputSchema?: Record<string, any>;
}

/**
 * MCP Tool call request
 */
export interface McpToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/**
 * MCP Tool call result
 */
export interface McpToolResult {
  id: string;
  content: any;
  isError?: boolean;
  errorMessage?: string;
}

/**
 * MCP Resource definition
 */
export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * MCP Resource content
 */
export interface McpResourceContent {
  uri: string;
  mimeType: string;
  text?: string;
  blob?: Buffer;
}

/**
 * MCP Prompt definition
 */
export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

/**
 * MCP Prompt argument
 */
export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/**
 * MCP Prompt message
 */
export interface McpPromptMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * MCP Server capabilities
 */
export interface McpServerCapabilities {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  logging?: boolean;
}

/**
 * MCP Server configuration
 */
export interface McpServerConfig {
  name: string;
  version: string;
  capabilities: McpServerCapabilities;
}

/**
 * MCP Client configuration
 */
export interface McpClientConfig {
  serverUri?: string;
  transport?: 'stdio' | 'sse' | 'websocket';
  timeout?: number;
}

/**
 * MCP Transport interface
 */
export interface McpTransport {
  send(message: any): Promise<void>;
  receive(): AsyncGenerator<any>;
  close(): Promise<void>;
}

/**
 * MCP Error
 */
export class McpError extends Error {
  code: number;
  data?: any;

  constructor(message: string, code: number, data?: any) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.data = data;
  }
}

// Error codes
export const MCP_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TOOL_NOT_FOUND: -32001,
  RESOURCE_NOT_FOUND: -32002,
  PROMPT_NOT_FOUND: -32003,
} as const;
