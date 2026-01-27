/**
 * Policy Service Implementation
 * 
 * Policy-based access control and namespace governance for SochDB.
 */

import { EmbeddedDatabase } from '../embedded';
import {
  PolicyRule,
  PolicyCondition,
  PolicyEvaluation,
  NamespacePolicy,
  NamespaceGrant,
  NamespacePermission,
  PolicyRequest,
  PolicySet,
  PolicyAuditEntry,
} from './types';

/**
 * Policy Service for access control and governance
 * 
 * @example
 * ```typescript
 * import { EmbeddedDatabase, PolicyService } from '@sochdb/sochdb';
 * 
 * const db = EmbeddedDatabase.open('./mydb');
 * const policy = new PolicyService(db);
 * 
 * // Create a namespace policy
 * await policy.createNamespacePolicy({
 *   namespace: 'tenant_123',
 *   rules: [{
 *     id: 'read_only',
 *     name: 'Read Only Access',
 *     effect: 'allow',
 *     principals: ['user:*'],
 *     resources: ['collection:*'],
 *     actions: ['read', 'search']
 *   }],
 *   defaultEffect: 'deny'
 * });
 * 
 * // Evaluate access
 * const result = await policy.evaluate({
 *   principal: 'user:alice',
 *   action: 'read',
 *   resource: 'collection:documents'
 * });
 * ```
 */
export class PolicyService {
  private db: EmbeddedDatabase;
  private prefix: Buffer;
  private cache: Map<string, NamespacePolicy> = new Map();
  private auditEnabled = true;

  constructor(db: EmbeddedDatabase, options?: { enableAudit?: boolean }) {
    this.db = db;
    this.prefix = Buffer.from('_policy:');
    this.auditEnabled = options?.enableAudit ?? true;
  }

  /**
   * Create a namespace policy
   */
  async createNamespacePolicy(policy: NamespacePolicy): Promise<void> {
    const key = this.policyKey(policy.namespace);
    const data = {
      ...policy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    await this.db.put(key, Buffer.from(JSON.stringify(data)));
    this.cache.set(policy.namespace, policy);
  }

  /**
   * Get a namespace policy
   */
  async getNamespacePolicy(namespace: string): Promise<NamespacePolicy | null> {
    // Check cache first
    if (this.cache.has(namespace)) {
      return this.cache.get(namespace)!;
    }

    const key = this.policyKey(namespace);
    const value = await this.db.get(key);
    
    if (!value) {
      return null;
    }

    const policy = JSON.parse(value.toString()) as NamespacePolicy;
    this.cache.set(namespace, policy);
    return policy;
  }

  /**
   * Update a namespace policy
   */
  async updateNamespacePolicy(namespace: string, updates: Partial<NamespacePolicy>): Promise<void> {
    const existing = await this.getNamespacePolicy(namespace);
    if (!existing) {
      throw new Error(`Policy not found for namespace: ${namespace}`);
    }

    const updated = {
      ...existing,
      ...updates,
      namespace, // Ensure namespace doesn't change
      updatedAt: Date.now(),
    };

    const key = this.policyKey(namespace);
    await this.db.put(key, Buffer.from(JSON.stringify(updated)));
    this.cache.set(namespace, updated);
  }

  /**
   * Delete a namespace policy
   */
  async deleteNamespacePolicy(namespace: string): Promise<boolean> {
    const key = this.policyKey(namespace);
    await this.db.delete(key);
    this.cache.delete(namespace);
    return true;
  }

  /**
   * Add a rule to a namespace policy
   */
  async addRule(namespace: string, rule: PolicyRule): Promise<void> {
    const policy = await this.getNamespacePolicy(namespace);
    if (!policy) {
      throw new Error(`Policy not found for namespace: ${namespace}`);
    }

    // Check for duplicate rule ID
    if (policy.rules.some(r => r.id === rule.id)) {
      throw new Error(`Rule with id '${rule.id}' already exists`);
    }

    policy.rules.push(rule);
    await this.updateNamespacePolicy(namespace, { rules: policy.rules });
  }

  /**
   * Remove a rule from a namespace policy
   */
  async removeRule(namespace: string, ruleId: string): Promise<boolean> {
    const policy = await this.getNamespacePolicy(namespace);
    if (!policy) {
      return false;
    }

    const index = policy.rules.findIndex(r => r.id === ruleId);
    if (index === -1) {
      return false;
    }

    policy.rules.splice(index, 1);
    await this.updateNamespacePolicy(namespace, { rules: policy.rules });
    return true;
  }

  /**
   * Evaluate a policy request
   */
  async evaluate(request: PolicyRequest): Promise<PolicyEvaluation> {
    const startTime = Date.now();
    
    // Extract namespace from resource
    const namespace = this.extractNamespace(request.resource);
    const policy = namespace ? await this.getNamespacePolicy(namespace) : null;

    let result: PolicyEvaluation;

    if (!policy) {
      // No policy = allow by default
      result = {
        allowed: true,
        reason: 'No policy defined',
        evaluationTime: Date.now() - startTime,
      };
    } else {
      // Evaluate rules in priority order
      const sortedRules = [...policy.rules].sort((a, b) => 
        (a.priority || 0) - (b.priority || 0)
      );

      let matchedRule: PolicyRule | undefined;

      for (const rule of sortedRules) {
        if (this.matchesRule(request, rule)) {
          matchedRule = rule;
          break;
        }
      }

      if (matchedRule) {
        result = {
          allowed: matchedRule.effect === 'allow',
          matchedRule,
          reason: `Matched rule: ${matchedRule.name}`,
          evaluationTime: Date.now() - startTime,
        };
      } else {
        result = {
          allowed: policy.defaultEffect === 'allow',
          reason: `Default effect: ${policy.defaultEffect}`,
          evaluationTime: Date.now() - startTime,
        };
      }
    }

    // Log audit entry
    if (this.auditEnabled) {
      await this.logAudit(request, result);
    }

    return result;
  }

  /**
   * Grant namespace access to a principal
   */
  async grantAccess(grant: NamespaceGrant): Promise<void> {
    const key = this.grantKey(grant.namespace, grant.principal);
    const data = {
      ...grant,
      grantedAt: Date.now(),
    };
    
    await this.db.put(key, Buffer.from(JSON.stringify(data)));
  }

  /**
   * Revoke namespace access from a principal
   */
  async revokeAccess(namespace: string, principal: string): Promise<boolean> {
    const key = this.grantKey(namespace, principal);
    await this.db.delete(key);
    return true;
  }

  /**
   * Check if principal has permission
   */
  async hasPermission(
    namespace: string,
    principal: string,
    permission: NamespacePermission
  ): Promise<boolean> {
    const key = this.grantKey(namespace, principal);
    const value = await this.db.get(key);
    
    if (!value) {
      return false;
    }

    const grant = JSON.parse(value.toString()) as NamespaceGrant;

    // Check expiration
    if (grant.expiresAt && Date.now() > grant.expiresAt) {
      return false;
    }

    // Admin has all permissions
    if (grant.permissions.includes('admin')) {
      return true;
    }

    return grant.permissions.includes(permission);
  }

  /**
   * List all grants for a namespace
   */
  async listGrants(namespace: string): Promise<NamespaceGrant[]> {
    const grants: NamespaceGrant[] = [];
    const prefix = Buffer.from(`_grant:${namespace}:`);

    try {
      for await (const [_, valueBuffer] of this.db.scanPrefix(prefix)) {
        const grant = JSON.parse(valueBuffer.toString()) as NamespaceGrant;
        grants.push(grant);
      }
    } catch (error) {
      // Ignore scan errors
    }

    return grants;
  }

  /**
   * Get audit log entries
   */
  async getAuditLog(options?: {
    namespace?: string;
    principal?: string;
    action?: string;
    since?: number;
    limit?: number;
  }): Promise<PolicyAuditEntry[]> {
    const entries: PolicyAuditEntry[] = [];
    const prefix = Buffer.from('_audit:');
    const limit = options?.limit || 100;

    try {
      for await (const [_, valueBuffer] of this.db.scanPrefix(prefix)) {
        const entry = JSON.parse(valueBuffer.toString()) as PolicyAuditEntry;
        
        // Apply filters
        if (options?.namespace && !entry.resource.includes(options.namespace)) {
          continue;
        }
        if (options?.principal && entry.principal !== options.principal) {
          continue;
        }
        if (options?.action && entry.action !== options.action) {
          continue;
        }
        if (options?.since && entry.timestamp < options.since) {
          continue;
        }

        entries.push(entry);
        
        if (entries.length >= limit) {
          break;
        }
      }
    } catch (error) {
      // Ignore scan errors
    }

    // Sort by timestamp descending
    return entries.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Clear policy cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  // Private methods

  private policyKey(namespace: string): Buffer {
    return Buffer.concat([this.prefix, Buffer.from(`namespace:${namespace}`)]);
  }

  private grantKey(namespace: string, principal: string): Buffer {
    return Buffer.from(`_grant:${namespace}:${principal}`);
  }

  private extractNamespace(resource: string): string | null {
    // Extract namespace from resource like "namespace:tenant_123:collection:docs"
    const parts = resource.split(':');
    if (parts.length >= 2 && parts[0] === 'namespace') {
      return parts[1];
    }
    // Try to extract from collection format "collection:tenant_123:docs"
    if (parts.length >= 2 && parts[0] === 'collection') {
      return parts[1];
    }
    return null;
  }

  private matchesRule(request: PolicyRequest, rule: PolicyRule): boolean {
    // Check principals
    if (!this.matchesPatterns(request.principal, rule.principals)) {
      return false;
    }

    // Check resources
    if (!this.matchesPatterns(request.resource, rule.resources)) {
      return false;
    }

    // Check actions
    if (!this.matchesPatterns(request.action, rule.actions)) {
      return false;
    }

    // Check conditions
    if (rule.conditions && rule.conditions.length > 0) {
      for (const condition of rule.conditions) {
        if (!this.evaluateCondition(condition, request.context)) {
          return false;
        }
      }
    }

    return true;
  }

  private matchesPatterns(value: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (this.matchesPattern(value, pattern)) {
        return true;
      }
    }
    return false;
  }

  private matchesPattern(value: string, pattern: string): boolean {
    if (pattern === '*') {
      return true;
    }
    
    if (pattern.endsWith('*')) {
      return value.startsWith(pattern.slice(0, -1));
    }
    
    if (pattern.startsWith('*')) {
      return value.endsWith(pattern.slice(1));
    }
    
    return value === pattern;
  }

  private evaluateCondition(condition: PolicyCondition, context?: Record<string, any>): boolean {
    if (!context) {
      return false;
    }

    const value = context[condition.key];
    if (value === undefined) {
      return false;
    }

    switch (condition.operator) {
      case 'equals':
        return value === condition.value;
      case 'not_equals':
        return value !== condition.value;
      case 'contains':
        return String(value).includes(String(condition.value));
      case 'starts_with':
        return String(value).startsWith(String(condition.value));
      case 'ends_with':
        return String(value).endsWith(String(condition.value));
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(value);
      case 'not_in':
        return Array.isArray(condition.value) && !condition.value.includes(value);
      case 'between':
        if (Array.isArray(condition.value) && condition.value.length === 2) {
          return value >= condition.value[0] && value <= condition.value[1];
        }
        return false;
      default:
        return false;
    }
  }

  private async logAudit(request: PolicyRequest, result: PolicyEvaluation): Promise<void> {
    const entry: PolicyAuditEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      principal: request.principal,
      action: request.action,
      resource: request.resource,
      decision: result.allowed ? 'allow' : 'deny',
      matchedRule: result.matchedRule?.id,
      reason: result.reason,
      context: request.context,
    };

    const key = Buffer.from(`_audit:${entry.timestamp}:${entry.id}`);
    await this.db.put(key, Buffer.from(JSON.stringify(entry)));
  }
}
