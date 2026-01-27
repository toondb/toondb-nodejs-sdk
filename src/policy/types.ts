/**
 * Policy Service Types
 * 
 * Type definitions for policy-based access control and namespace governance.
 */

/**
 * Policy rule for access control
 */
export interface PolicyRule {
  id: string;
  name: string;
  description?: string;
  effect: 'allow' | 'deny';
  principals: string[];
  resources: string[];
  actions: string[];
  conditions?: PolicyCondition[];
  priority?: number;
}

/**
 * Policy condition for contextual access control
 */
export interface PolicyCondition {
  type: 'time' | 'ip' | 'metadata' | 'custom';
  operator: 'equals' | 'not_equals' | 'contains' | 'starts_with' | 'ends_with' | 'in' | 'not_in' | 'between';
  key: string;
  value: any;
}

/**
 * Policy evaluation result
 */
export interface PolicyEvaluation {
  allowed: boolean;
  matchedRule?: PolicyRule;
  reason?: string;
  evaluationTime: number;
}

/**
 * Namespace policy for multi-tenant isolation
 */
export interface NamespacePolicy {
  namespace: string;
  rules: PolicyRule[];
  defaultEffect: 'allow' | 'deny';
  inheritFrom?: string;
  metadata?: Record<string, any>;
}

/**
 * Access grant for namespace-level permissions
 */
export interface NamespaceGrant {
  namespace: string;
  principal: string;
  permissions: NamespacePermission[];
  expiresAt?: number;
  grantedBy?: string;
  grantedAt?: number;
}

/**
 * Namespace permission levels
 */
export type NamespacePermission = 
  | 'read'
  | 'write'
  | 'delete'
  | 'admin'
  | 'create_collection'
  | 'delete_collection'
  | 'search'
  | 'manage_policy';

/**
 * Policy action types
 */
export type PolicyAction =
  | 'db:read'
  | 'db:write'
  | 'db:delete'
  | 'db:scan'
  | 'namespace:create'
  | 'namespace:delete'
  | 'namespace:list'
  | 'collection:create'
  | 'collection:delete'
  | 'collection:insert'
  | 'collection:search'
  | 'collection:update'
  | 'policy:read'
  | 'policy:write'
  | 'admin:*';

/**
 * Policy request for evaluation
 */
export interface PolicyRequest {
  principal: string;
  action: string;
  resource: string;
  context?: Record<string, any>;
}

/**
 * Policy set containing multiple policies
 */
export interface PolicySet {
  id: string;
  name: string;
  description?: string;
  policies: NamespacePolicy[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Audit log entry for policy decisions
 */
export interface PolicyAuditEntry {
  id: string;
  timestamp: number;
  principal: string;
  action: string;
  resource: string;
  decision: 'allow' | 'deny';
  matchedRule?: string;
  reason?: string;
  context?: Record<string, any>;
}
