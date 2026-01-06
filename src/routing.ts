/**
 * Tool Routing Primitive for Multi-Agent Scenarios
 *
 * Provides a first-class system for routing tool calls to agents based on:
 * - Agent capabilities
 * - Tool requirements
 * - Load balancing
 * - Agent availability
 *
 * @example
 * ```typescript
 * import { Database } from 'toondb';
 * import { ToolDispatcher, ToolCategory, RoutingStrategy } from 'toondb/routing';
 *
 * const db = await Database.open('./data');
 * const dispatcher = new ToolDispatcher(db);
 *
 * // Register a local agent
 * dispatcher.registerLocalAgent(
 *   'code_agent',
 *   [ToolCategory.CODE],
 *   async (tool, args) => ({ result: `Processed ${tool}` }),
 * );
 *
 * // Register a tool
 * dispatcher.registerTool({
 *   name: 'search_code',
 *   description: 'Search codebase',
 *   category: ToolCategory.CODE,
 * });
 *
 * // Invoke with automatic routing
 * const result = await dispatcher.invoke('search_code', { query: 'auth' });
 * ```
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

import { Database } from './database';

/**
 * Standard tool categories for routing.
 */
export enum ToolCategory {
  CODE = 'code',
  SEARCH = 'search',
  DATABASE = 'database',
  WEB = 'web',
  FILE = 'file',
  GIT = 'git',
  SHELL = 'shell',
  EMAIL = 'email',
  CALENDAR = 'calendar',
  MEMORY = 'memory',
  VECTOR = 'vector',
  GRAPH = 'graph',
  CUSTOM = 'custom',
}

/**
 * How to select among multiple capable agents.
 */
export enum RoutingStrategy {
  ROUND_ROBIN = 'round_robin',
  RANDOM = 'random',
  LEAST_LOADED = 'least_loaded',
  STICKY = 'sticky',
  PRIORITY = 'priority',
  FASTEST = 'fastest',
}

/**
 * Agent availability status.
 */
export enum AgentStatus {
  AVAILABLE = 'available',
  BUSY = 'busy',
  OFFLINE = 'offline',
  DEGRADED = 'degraded',
}

/**
 * Tool definition.
 */
export interface Tool {
  name: string;
  description: string;
  category: ToolCategory;
  schema?: Record<string, any>;
  requiredCapabilities?: ToolCategory[];
  timeoutSeconds?: number;
  retries?: number;
  metadata?: Record<string, any>;
}

/**
 * Tool handler function.
 */
export type ToolHandler = (toolName: string, args: Record<string, any>) => Promise<any>;

/**
 * Agent definition.
 */
export interface Agent {
  agentId: string;
  capabilities: ToolCategory[];
  endpoint?: string;
  handler?: ToolHandler;
  priority: number;
  maxConcurrent: number;
  metadata?: Record<string, any>;

  // Runtime state
  status: AgentStatus;
  currentLoad: number;
  totalCalls: number;
  totalLatencyMs: number;
  lastSuccess?: number;
  lastFailure?: number;
}

/**
 * Result of a tool routing decision.
 */
export interface RouteResult {
  agentId: string;
  toolName: string;
  result: any;
  latencyMs: number;
  success: boolean;
  error?: string;
  retriesUsed: number;
}

/**
 * Context for routing decisions.
 */
export interface RoutingContext {
  sessionId?: string;
  userId?: string;
  priority?: number;
  timeoutOverride?: number;
  preferredAgent?: string;
  excludedAgents?: string[];
  custom?: Record<string, any>;
}

const AGENT_PREFIX = '/_routing/agents/';
const TOOL_PREFIX = '/_routing/tools/';

/**
 * Registry of agents and their capabilities.
 */
export class AgentRegistry {
  private db: Database;
  private agents: Map<string, Agent> = new Map();

  constructor(db: Database) {
    this.db = db;
    this.loadAgents();
  }

  private async loadAgents(): Promise<void> {
    try {
      const results = await this.db.scan(AGENT_PREFIX);
      for (const { key, value } of results) {
        try {
          const data = JSON.parse(value.toString());
          const agent: Agent = {
            agentId: data.agent_id,
            capabilities: data.capabilities.map((c: string) => c as ToolCategory),
            endpoint: data.endpoint,
            priority: data.priority || 100,
            maxConcurrent: data.max_concurrent || 10,
            metadata: data.metadata,
            status: AgentStatus.AVAILABLE,
            currentLoad: 0,
            totalCalls: 0,
            totalLatencyMs: 0,
          };
          this.agents.set(agent.agentId, agent);
        } catch (e) {
          // Skip invalid entries
        }
      }
    } catch (e) {
      // No existing agents
    }
  }

  /**
   * Register an agent with capabilities.
   */
  async registerAgent(
    agentId: string,
    capabilities: ToolCategory[],
    options: {
      endpoint?: string;
      handler?: ToolHandler;
      priority?: number;
      maxConcurrent?: number;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<Agent> {
    const agent: Agent = {
      agentId,
      capabilities,
      endpoint: options.endpoint,
      handler: options.handler,
      priority: options.priority || 100,
      maxConcurrent: options.maxConcurrent || 10,
      metadata: options.metadata,
      status: AgentStatus.AVAILABLE,
      currentLoad: 0,
      totalCalls: 0,
      totalLatencyMs: 0,
    };

    this.agents.set(agentId, agent);

    // Persist to database (skip handler as it's not serializable)
    const data = {
      agent_id: agentId,
      capabilities,
      endpoint: options.endpoint,
      priority: agent.priority,
      max_concurrent: agent.maxConcurrent,
      metadata: options.metadata,
    };
    await this.db.put(
      Buffer.from(`${AGENT_PREFIX}${agentId}`),
      Buffer.from(JSON.stringify(data))
    );

    return agent;
  }

  /**
   * Remove an agent registration.
   */
  async unregisterAgent(agentId: string): Promise<boolean> {
    if (this.agents.has(agentId)) {
      this.agents.delete(agentId);
      await this.db.delete(Buffer.from(`${AGENT_PREFIX}${agentId}`));
      return true;
    }
    return false;
  }

  /**
   * Get an agent by ID.
   */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * List all registered agents.
   */
  listAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Find agents capable of handling the required categories.
   */
  findCapableAgents(required: ToolCategory[], exclude: string[] = []): Agent[] {
    const excludeSet = new Set(exclude);
    const capable: Agent[] = [];

    for (const agent of this.agents.values()) {
      if (excludeSet.has(agent.agentId)) continue;
      if (agent.status === AgentStatus.OFFLINE) continue;

      const agentCaps = new Set(agent.capabilities);
      const hasAll = required.every((req) => agentCaps.has(req));
      if (hasAll) {
        capable.push(agent);
      }
    }

    return capable;
  }

  /**
   * Update an agent's status.
   */
  updateAgentStatus(agentId: string, status: AgentStatus): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
    }
  }

  /**
   * Record a tool call result for an agent.
   */
  recordCall(agentId: string, latencyMs: number, success: boolean): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.totalCalls++;
      agent.totalLatencyMs += latencyMs;
      if (success) {
        agent.lastSuccess = Date.now();
      } else {
        agent.lastFailure = Date.now();
      }
    }
  }
}

/**
 * Routes tool calls to appropriate agents.
 */
export class ToolRouter {
  private registry: AgentRegistry;
  private db: Database;
  private defaultStrategy: RoutingStrategy;
  private tools: Map<string, Tool> = new Map();
  private roundRobinIdx: Map<string, number> = new Map();
  private sessionAffinity: Map<string, string> = new Map();

  constructor(registry: AgentRegistry, defaultStrategy: RoutingStrategy = RoutingStrategy.PRIORITY) {
    this.registry = registry;
    this.db = (registry as any).db;
    this.defaultStrategy = defaultStrategy;
    this.loadTools();
  }

  private async loadTools(): Promise<void> {
    try {
      const results = await this.db.scan(TOOL_PREFIX);
      for (const { key, value } of results) {
        try {
          const data = JSON.parse(value.toString());
          const tool: Tool = {
            name: data.name,
            description: data.description,
            category: data.category as ToolCategory,
            schema: data.schema,
            requiredCapabilities: data.required_capabilities?.map((c: string) => c as ToolCategory),
            timeoutSeconds: data.timeout_seconds || 30,
            retries: data.retries || 1,
            metadata: data.metadata,
          };
          this.tools.set(tool.name, tool);
        } catch (e) {
          // Skip invalid entries
        }
      }
    } catch (e) {
      // No existing tools
    }
  }

  /**
   * Register a tool for routing.
   */
  async registerTool(tool: Tool): Promise<Tool> {
    const fullTool: Tool = {
      ...tool,
      timeoutSeconds: tool.timeoutSeconds || 30,
      retries: tool.retries || 1,
    };
    this.tools.set(tool.name, fullTool);

    // Persist to database
    const data = {
      name: tool.name,
      description: tool.description,
      category: tool.category,
      schema: tool.schema,
      required_capabilities: tool.requiredCapabilities,
      timeout_seconds: fullTool.timeoutSeconds,
      retries: fullTool.retries,
      metadata: tool.metadata,
    };
    await this.db.put(
      Buffer.from(`${TOOL_PREFIX}${tool.name}`),
      Buffer.from(JSON.stringify(data))
    );

    return fullTool;
  }

  /**
   * Remove a tool registration.
   */
  async unregisterTool(name: string): Promise<boolean> {
    if (this.tools.has(name)) {
      this.tools.delete(name);
      await this.db.delete(Buffer.from(`${TOOL_PREFIX}${name}`));
      return true;
    }
    return false;
  }

  /**
   * Get a tool by name.
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * List all registered tools.
   */
  listTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Route a tool call to the best agent.
   */
  async route(
    toolName: string,
    args: Record<string, any>,
    context: RoutingContext = {},
    strategy?: RoutingStrategy
  ): Promise<RouteResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        agentId: '',
        toolName,
        result: null,
        latencyMs: 0,
        success: false,
        error: `Unknown tool: ${toolName}`,
        retriesUsed: 0,
      };
    }

    // Determine required capabilities
    const required = tool.requiredCapabilities || [tool.category];

    // Find capable agents
    let capable = this.registry.findCapableAgents(required, context.excludedAgents);
    if (capable.length === 0) {
      return {
        agentId: '',
        toolName,
        result: null,
        latencyMs: 0,
        success: false,
        error: `No capable agents for tool '${toolName}'`,
        retriesUsed: 0,
      };
    }

    // Select agent using strategy
    const useStrategy = strategy || this.defaultStrategy;
    let agent = this.selectAgent(capable, useStrategy, context);

    // Execute with retries
    const timeout = context.timeoutOverride || tool.timeoutSeconds || 30;
    const retries = tool.retries || 1;
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const start = Date.now();
      try {
        const result = await this.invokeAgent(agent, tool, args, timeout);
        const latencyMs = Date.now() - start;

        this.registry.recordCall(agent.agentId, latencyMs, true);

        // Update session affinity
        if (context.sessionId) {
          this.sessionAffinity.set(context.sessionId, agent.agentId);
        }

        return {
          agentId: agent.agentId,
          toolName,
          result,
          latencyMs,
          success: true,
          retriesUsed: attempt,
        };
      } catch (e: any) {
        const latencyMs = Date.now() - start;
        this.registry.recordCall(agent.agentId, latencyMs, false);
        lastError = e.message;

        // Try next capable agent on failure
        capable = capable.filter((a) => a.agentId !== agent.agentId);
        if (capable.length > 0) {
          agent = this.selectAgent(capable, useStrategy, context);
        }
      }
    }

    return {
      agentId: agent.agentId,
      toolName,
      result: null,
      latencyMs: 0,
      success: false,
      error: lastError || 'All retries exhausted',
      retriesUsed: retries,
    };
  }

  private selectAgent(
    capable: Agent[],
    strategy: RoutingStrategy,
    context: RoutingContext
  ): Agent {
    if (capable.length === 0) {
      throw new Error('No capable agents');
    }

    // Preferred agent override
    if (context.preferredAgent) {
      const preferred = capable.find((a) => a.agentId === context.preferredAgent);
      if (preferred) return preferred;
    }

    // Session affinity (sticky routing)
    if (strategy === RoutingStrategy.STICKY && context.sessionId) {
      const prevAgent = this.sessionAffinity.get(context.sessionId);
      if (prevAgent) {
        const sticky = capable.find((a) => a.agentId === prevAgent);
        if (sticky) return sticky;
      }
    }

    switch (strategy) {
      case RoutingStrategy.ROUND_ROBIN: {
        const key = capable.map((a) => a.agentId).sort().join(',');
        const idx = (this.roundRobinIdx.get(key) || 0) % capable.length;
        this.roundRobinIdx.set(key, idx + 1);
        return capable[idx];
      }

      case RoutingStrategy.RANDOM:
        return capable[Math.floor(Math.random() * capable.length)];

      case RoutingStrategy.LEAST_LOADED:
        return capable.reduce((a, b) => (a.currentLoad < b.currentLoad ? a : b));

      case RoutingStrategy.PRIORITY:
        return capable.reduce((a, b) => {
          if (a.priority > b.priority) return a;
          if (a.priority < b.priority) return b;
          return a.currentLoad < b.currentLoad ? a : b;
        });

      case RoutingStrategy.FASTEST: {
        let best = capable[0];
        let bestAvg = Infinity;
        for (const a of capable) {
          if (a.totalCalls > 0) {
            const avg = a.totalLatencyMs / a.totalCalls;
            if (avg < bestAvg) {
              bestAvg = avg;
              best = a;
            }
          }
        }
        return best;
      }

      default:
        return capable[0];
    }
  }

  private async invokeAgent(
    agent: Agent,
    tool: Tool,
    args: Record<string, any>,
    timeout: number
  ): Promise<any> {
    agent.currentLoad++;
    try {
      if (agent.handler) {
        // Local function handler
        return await agent.handler(tool.name, args);
      }

      if (agent.endpoint) {
        // Remote HTTP invocation
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

        try {
          const response = await fetch(agent.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tool: tool.name,
              args,
              metadata: tool.metadata,
            }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          return await response.json();
        } catch (e: any) {
          clearTimeout(timeoutId);
          throw e;
        }
      }

      throw new Error(`Agent ${agent.agentId} has no handler or endpoint`);
    } finally {
      agent.currentLoad--;
    }
  }
}

/**
 * High-level dispatcher for multi-agent tool orchestration.
 */
export class ToolDispatcher {
  private db: Database;
  private _registry: AgentRegistry;
  private _router: ToolRouter;

  constructor(db: Database) {
    this.db = db;
    this._registry = new AgentRegistry(db);
    this._router = new ToolRouter(this._registry);
  }

  /**
   * Get the agent registry.
   */
  get registry(): AgentRegistry {
    return this._registry;
  }

  /**
   * Get the tool router.
   */
  get router(): ToolRouter {
    return this._router;
  }

  /**
   * Register a local (in-process) agent.
   */
  async registerLocalAgent(
    agentId: string,
    capabilities: ToolCategory[],
    handler: ToolHandler,
    priority: number = 100
  ): Promise<Agent> {
    return this._registry.registerAgent(agentId, capabilities, { handler, priority });
  }

  /**
   * Register a remote (HTTP) agent.
   */
  async registerRemoteAgent(
    agentId: string,
    capabilities: ToolCategory[],
    endpoint: string,
    priority: number = 100
  ): Promise<Agent> {
    return this._registry.registerAgent(agentId, capabilities, { endpoint, priority });
  }

  /**
   * Register a tool for routing.
   */
  async registerTool(tool: Tool): Promise<Tool> {
    return this._router.registerTool(tool);
  }

  /**
   * Invoke a tool with automatic routing.
   */
  async invoke(
    toolName: string,
    args: Record<string, any> = {},
    context: RoutingContext = {}
  ): Promise<RouteResult> {
    return this._router.route(toolName, args, context);
  }

  /**
   * List all registered agents with their status.
   */
  listAgents(): Record<string, any>[] {
    return this._registry.listAgents().map((a) => ({
      agent_id: a.agentId,
      capabilities: a.capabilities,
      status: a.status,
      priority: a.priority,
      current_load: a.currentLoad,
      total_calls: a.totalCalls,
      avg_latency_ms: a.totalCalls > 0 ? a.totalLatencyMs / a.totalCalls : null,
      has_endpoint: !!a.endpoint,
      has_handler: !!a.handler,
    }));
  }

  /**
   * List all registered tools.
   */
  listTools(): Record<string, any>[] {
    return this._router.listTools().map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      schema: t.schema,
      timeout_seconds: t.timeoutSeconds,
      retries: t.retries,
    }));
  }
}
