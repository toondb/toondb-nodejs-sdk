/**
 * Policy & Safety Hooks for Agent Operations
 *
 * Provides a trigger system for enforcing policies on agent actions:
 * - Pre-write validation (block dangerous operations)
 * - Post-read filtering (redact sensitive data)
 * - Rate limiting (prevent runaway agents)
 * - Audit logging (track all operations)
 *
 * @example
 * ```typescript
 * import { Database } from 'toondb';
 * import { PolicyEngine, PolicyAction } from 'toondb/policy';
 *
 * const db = await Database.open('./data');
 * const policy = new PolicyEngine(db);
 *
 * // Block writes to system keys
 * policy.beforeWrite('system/*', (ctx) => {
 *   if (ctx.agentId) {
 *     return PolicyAction.DENY;
 *   }
 *   return PolicyAction.ALLOW;
 * });
 *
 * // Redact sensitive data on read
 * policy.afterRead('users/* /email', (ctx) => {
 *   if (ctx.get('redact_pii')) {
 *     ctx.modifiedValue = Buffer.from('[REDACTED]');
 *     return PolicyAction.MODIFY;
 *   }
 *   return PolicyAction.ALLOW;
 * });
 *
 * // Rate limit writes per agent
 * policy.addRateLimit('write', 100, 'agent_id');
 *
 * // Use policy-wrapped operations
 * await policy.put(Buffer.from('users/alice'), Buffer.from('data'), {
 *   agent_id: 'agent_001',
 * });
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
 * Action to take when a policy is triggered.
 */
export enum PolicyAction {
  /** Allow the operation */
  ALLOW = 'allow',
  /** Block the operation */
  DENY = 'deny',
  /** Allow with modifications (check modifiedValue in context) */
  MODIFY = 'modify',
  /** Allow but log the operation */
  LOG = 'log',
}

/**
 * When the policy is triggered.
 */
export enum PolicyTrigger {
  BEFORE_READ = 'before_read',
  AFTER_READ = 'after_read',
  BEFORE_WRITE = 'before_write',
  AFTER_WRITE = 'after_write',
  BEFORE_DELETE = 'before_delete',
  AFTER_DELETE = 'after_delete',
}

/**
 * Context for policy evaluation.
 */
export interface PolicyContext {
  operation: string;
  key: Buffer;
  value: Buffer | null;
  modifiedValue?: Buffer;
  agentId?: string;
  sessionId?: string;
  timestamp: number;
  custom: Record<string, string>;
  get(key: string): string | undefined;
}

/**
 * Policy handler function.
 */
export type PolicyHandler = (ctx: PolicyContext) => PolicyAction;

/**
 * Audit log entry.
 */
export interface AuditEntry {
  timestamp: number;
  operation: string;
  key: string;
  agentId?: string;
  sessionId?: string;
  result: string;
}

/**
 * Rate limit configuration.
 */
interface RateLimitConfig {
  operation: string;
  maxPerMinute: number;
  scope: string;
}

/**
 * Token bucket rate limiter.
 */
class RateLimiter {
  private maxPerMinute: number;
  private tokens: number;
  private lastRefill: number;

  constructor(maxPerMinute: number) {
    this.maxPerMinute = maxPerMinute;
    this.tokens = maxPerMinute;
    this.lastRefill = Date.now();
  }

  tryAcquire(): boolean {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    // Refill tokens based on elapsed time
    const refill = Math.floor((elapsed / 60000) * this.maxPerMinute);
    if (refill > 0) {
      this.tokens = Math.min(this.maxPerMinute, this.tokens + refill);
      this.lastRefill = now;
    }

    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }
}

/**
 * Pattern-based policy.
 */
class PatternPolicy {
  pattern: string;
  trigger: PolicyTrigger;
  handler: PolicyHandler;
  private regex: RegExp;

  constructor(pattern: string, trigger: PolicyTrigger, handler: PolicyHandler) {
    this.pattern = pattern;
    this.trigger = trigger;
    this.handler = handler;

    // Convert glob pattern to regex
    let regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');
    this.regex = new RegExp(`^${regex}$`);
  }

  matches(key: Buffer): boolean {
    return this.regex.test(key.toString());
  }
}

/**
 * Error thrown when a policy blocks an operation.
 */
export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyViolationError';
  }
}

/**
 * Policy engine for enforcing safety rules on database operations.
 */
export class PolicyEngine {
  private db: Database;
  private policies: Map<PolicyTrigger, PatternPolicy[]>;
  private rateLimiters: Map<string, Map<string, RateLimiter>>;
  private rateLimitConfigs: RateLimitConfig[];
  private auditLog: AuditEntry[];
  private auditEnabled: boolean;
  private maxAuditEntries: number;

  constructor(db: Database) {
    this.db = db;
    this.policies = new Map();
    this.rateLimiters = new Map();
    this.rateLimitConfigs = [];
    this.auditLog = [];
    this.auditEnabled = false;
    this.maxAuditEntries = 10000;

    // Initialize policy arrays for each trigger
    for (const trigger of Object.values(PolicyTrigger)) {
      this.policies.set(trigger as PolicyTrigger, []);
    }
  }

  /**
   * Register a pre-write policy handler.
   */
  beforeWrite(pattern: string, handler: PolicyHandler): void {
    this.policies.get(PolicyTrigger.BEFORE_WRITE)!.push(
      new PatternPolicy(pattern, PolicyTrigger.BEFORE_WRITE, handler)
    );
  }

  /**
   * Register a post-write policy handler.
   */
  afterWrite(pattern: string, handler: PolicyHandler): void {
    this.policies.get(PolicyTrigger.AFTER_WRITE)!.push(
      new PatternPolicy(pattern, PolicyTrigger.AFTER_WRITE, handler)
    );
  }

  /**
   * Register a pre-read policy handler.
   */
  beforeRead(pattern: string, handler: PolicyHandler): void {
    this.policies.get(PolicyTrigger.BEFORE_READ)!.push(
      new PatternPolicy(pattern, PolicyTrigger.BEFORE_READ, handler)
    );
  }

  /**
   * Register a post-read policy handler.
   */
  afterRead(pattern: string, handler: PolicyHandler): void {
    this.policies.get(PolicyTrigger.AFTER_READ)!.push(
      new PatternPolicy(pattern, PolicyTrigger.AFTER_READ, handler)
    );
  }

  /**
   * Register a pre-delete policy handler.
   */
  beforeDelete(pattern: string, handler: PolicyHandler): void {
    this.policies.get(PolicyTrigger.BEFORE_DELETE)!.push(
      new PatternPolicy(pattern, PolicyTrigger.BEFORE_DELETE, handler)
    );
  }

  /**
   * Add a rate limit policy.
   * @param operation - "read", "write", "delete", or "all"
   * @param maxPerMinute - Maximum operations per minute
   * @param scope - "global", "agent_id", or "session_id"
   */
  addRateLimit(operation: string, maxPerMinute: number, scope: string = 'global'): void {
    this.rateLimitConfigs.push({ operation, maxPerMinute, scope });
  }

  /**
   * Enable audit logging.
   */
  enableAudit(maxEntries: number = 10000): void {
    this.auditEnabled = true;
    this.maxAuditEntries = maxEntries;
  }

  /**
   * Disable audit logging.
   */
  disableAudit(): void {
    this.auditEnabled = false;
  }

  /**
   * Get recent audit log entries.
   */
  getAuditLog(limit: number = 100): AuditEntry[] {
    const start = Math.max(0, this.auditLog.length - limit);
    return this.auditLog.slice(start);
  }

  private checkRateLimit(operation: string, ctx: PolicyContext): boolean {
    for (const config of this.rateLimitConfigs) {
      if (config.operation !== operation && config.operation !== 'all') {
        continue;
      }

      let scopeKey = 'global';
      if (config.scope === 'agent_id') {
        scopeKey = ctx.agentId || 'unknown';
      } else if (config.scope === 'session_id') {
        scopeKey = ctx.sessionId || 'unknown';
      } else if (config.scope !== 'global') {
        scopeKey = ctx.get(config.scope) || 'unknown';
      }

      const limiterKey = `${config.operation}:${config.scope}`;
      if (!this.rateLimiters.has(limiterKey)) {
        this.rateLimiters.set(limiterKey, new Map());
      }
      const scopeLimiters = this.rateLimiters.get(limiterKey)!;
      if (!scopeLimiters.has(scopeKey)) {
        scopeLimiters.set(scopeKey, new RateLimiter(config.maxPerMinute));
      }

      if (!scopeLimiters.get(scopeKey)!.tryAcquire()) {
        return false;
      }
    }
    return true;
  }

  private evaluatePolicies(trigger: PolicyTrigger, ctx: PolicyContext): PolicyAction {
    const policies = this.policies.get(trigger) || [];
    for (const policy of policies) {
      if (policy.matches(ctx.key)) {
        const action = policy.handler(ctx);
        if (action === PolicyAction.DENY || action === PolicyAction.MODIFY) {
          return action;
        }
      }
    }
    return PolicyAction.ALLOW;
  }

  private audit(operation: string, key: Buffer, ctx: PolicyContext, result: string): void {
    if (!this.auditEnabled) {
      return;
    }

    this.auditLog.push({
      timestamp: Date.now(),
      operation,
      key: key.toString(),
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      result,
    });

    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-this.maxAuditEntries);
    }
  }

  private makeContext(
    operation: string,
    key: Buffer,
    value: Buffer | null,
    custom: Record<string, string> = {}
  ): PolicyContext {
    return {
      operation,
      key,
      value,
      agentId: custom.agent_id,
      sessionId: custom.session_id,
      timestamp: Date.now(),
      custom,
      get: (k: string) => custom[k],
    };
  }

  /**
   * Put a value with policy enforcement.
   */
  async put(key: Buffer, value: Buffer, context: Record<string, string> = {}): Promise<void> {
    const ctx = this.makeContext('write', key, value, context);

    if (!this.checkRateLimit('write', ctx)) {
      this.audit('write', key, ctx, 'rate_limited');
      throw new PolicyViolationError('Rate limit exceeded');
    }

    const action = this.evaluatePolicies(PolicyTrigger.BEFORE_WRITE, ctx);
    if (action === PolicyAction.DENY) {
      this.audit('write', key, ctx, 'denied');
      throw new PolicyViolationError('Write blocked by policy');
    }

    const writeValue = action === PolicyAction.MODIFY && ctx.modifiedValue
      ? ctx.modifiedValue
      : value;

    await this.db.put(key, writeValue);

    ctx.value = writeValue;
    this.evaluatePolicies(PolicyTrigger.AFTER_WRITE, ctx);
    this.audit('write', key, ctx, 'allowed');
  }

  /**
   * Get a value with policy enforcement.
   */
  async get(key: Buffer, context: Record<string, string> = {}): Promise<Buffer | null> {
    const ctx = this.makeContext('read', key, null, context);

    if (!this.checkRateLimit('read', ctx)) {
      this.audit('read', key, ctx, 'rate_limited');
      throw new PolicyViolationError('Rate limit exceeded');
    }

    const beforeAction = this.evaluatePolicies(PolicyTrigger.BEFORE_READ, ctx);
    if (beforeAction === PolicyAction.DENY) {
      this.audit('read', key, ctx, 'denied');
      throw new PolicyViolationError('Read blocked by policy');
    }

    const value = await this.db.get(key);
    if (value === null) {
      return null;
    }

    ctx.value = value;
    const afterAction = this.evaluatePolicies(PolicyTrigger.AFTER_READ, ctx);

    if (afterAction === PolicyAction.MODIFY && ctx.modifiedValue) {
      this.audit('read', key, ctx, 'allowed');
      return ctx.modifiedValue;
    } else if (afterAction === PolicyAction.DENY) {
      this.audit('read', key, ctx, 'redacted');
      return null;
    }

    this.audit('read', key, ctx, 'allowed');
    return value;
  }

  /**
   * Delete a value with policy enforcement.
   */
  async delete(key: Buffer, context: Record<string, string> = {}): Promise<void> {
    const ctx = this.makeContext('delete', key, null, context);

    if (!this.checkRateLimit('delete', ctx)) {
      this.audit('delete', key, ctx, 'rate_limited');
      throw new PolicyViolationError('Rate limit exceeded');
    }

    const action = this.evaluatePolicies(PolicyTrigger.BEFORE_DELETE, ctx);
    if (action === PolicyAction.DENY) {
      this.audit('delete', key, ctx, 'denied');
      throw new PolicyViolationError('Delete blocked by policy');
    }

    await this.db.delete(key);
    this.audit('delete', key, ctx, 'allowed');
  }
}

// ============================================================================
// Built-in Policy Helpers
// ============================================================================

/**
 * Policy that denies all matching operations.
 */
export function denyAll(): PolicyHandler {
  return () => PolicyAction.DENY;
}

/**
 * Policy that allows all matching operations.
 */
export function allowAll(): PolicyHandler {
  return () => PolicyAction.ALLOW;
}

/**
 * Policy that requires an agent_id in context.
 */
export function requireAgentId(): PolicyHandler {
  return (ctx) => ctx.agentId ? PolicyAction.ALLOW : PolicyAction.DENY;
}

/**
 * Policy factory that redacts values.
 */
export function redactValue(replacement: Buffer = Buffer.from('[REDACTED]')): PolicyHandler {
  return (ctx) => {
    ctx.modifiedValue = replacement;
    return PolicyAction.MODIFY;
  };
}
