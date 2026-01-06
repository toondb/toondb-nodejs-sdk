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

/**
 * Semi-GraphDB Overlay for Agent Memory.
 *
 * Provides a lightweight graph layer on top of ToonDB's KV storage for modeling
 * agent memory relationships:
 *
 * - Entity-to-entity relationships (user <-> conversation <-> message)
 * - Causal chains (action1 -> action2 -> action3)
 * - Reference graphs (document <- citation <- quote)
 *
 * Storage Model:
 *   Nodes: _graph/{namespace}/nodes/{node_id} -> {type, properties}
 *   Edges: _graph/{namespace}/edges/{from_id}/{edge_type}/{to_id} -> {properties}
 *   Index: _graph/{namespace}/index/{edge_type}/{to_id} -> [from_ids] (reverse lookup)
 *
 * @example
 * ```typescript
 * const graph = new GraphOverlay(db, 'agent_001');
 *
 * graph.addNode('user_1', 'User', { name: 'Alice' });
 * graph.addNode('conv_1', 'Conversation', { title: 'Planning' });
 *
 * graph.addEdge('user_1', 'STARTED', 'conv_1');
 *
 * const path = await graph.shortestPath('user_1', 'msg_1');
 * ```
 */

import { Database } from './database';

/** Graph traversal order. */
export enum TraversalOrder {
  BFS = 'bfs',
  DFS = 'dfs',
}

/** Edge direction for neighbor queries. */
export enum EdgeDirection {
  OUTGOING = 'outgoing',
  INCOMING = 'incoming',
  BOTH = 'both',
}

/** A node in the graph. */
export interface GraphNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

/** An edge in the graph. */
export interface GraphEdge {
  fromId: string;
  edgeType: string;
  toId: string;
  properties: Record<string, unknown>;
}

/** A neighboring node with its connecting edge. */
export interface Neighbor {
  nodeId: string;
  edge: GraphEdge;
}

/** A subgraph containing nodes and edges. */
export interface Subgraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

/**
 * Lightweight graph overlay on ToonDB.
 *
 * Provides graph operations for agent memory without a full graph database.
 * Uses the underlying KV store for persistence with O(1) node/edge operations.
 */
export class GraphOverlay {
  private static readonly PREFIX = '_graph';
  private readonly db: Database;
  private readonly namespace: string;
  private readonly prefix: string;

  /**
   * Create a new graph overlay.
   * @param db ToonDB Database instance
   * @param namespace Namespace for graph isolation (e.g., agent_id)
   */
  constructor(db: Database, namespace: string = 'default') {
    this.db = db;
    this.namespace = namespace;
    this.prefix = `${GraphOverlay.PREFIX}/${namespace}`;
  }

  // Key helpers
  private nodeKey(nodeId: string): string {
    return `${this.prefix}/nodes/${nodeId}`;
  }

  private edgeKey(fromId: string, edgeType: string, toId: string): string {
    return `${this.prefix}/edges/${fromId}/${edgeType}/${toId}`;
  }

  private edgePrefix(fromId: string, edgeType?: string): string {
    if (edgeType) {
      return `${this.prefix}/edges/${fromId}/${edgeType}/`;
    }
    return `${this.prefix}/edges/${fromId}/`;
  }

  private reverseIndexKey(edgeType: string, toId: string, fromId: string): string {
    return `${this.prefix}/index/${edgeType}/${toId}/${fromId}`;
  }

  private reverseIndexPrefix(edgeType: string, toId: string): string {
    return `${this.prefix}/index/${edgeType}/${toId}/`;
  }

  // ==========================================================================
  // Node Operations
  // ==========================================================================

  /**
   * Add a node to the graph.
   * @param nodeId Unique node identifier
   * @param nodeType Node type label (e.g., "User", "Message", "Tool")
   * @param properties Optional node properties
   * @returns The created GraphNode
   */
  async addNode(
    nodeId: string,
    nodeType: string,
    properties: Record<string, unknown> = {}
  ): Promise<GraphNode> {
    const node: GraphNode = {
      id: nodeId,
      type: nodeType,
      properties,
    };

    await this.db.put(this.nodeKey(nodeId), JSON.stringify(node));
    return node;
  }

  /**
   * Get a node by ID.
   * @param nodeId Node identifier
   * @returns GraphNode if found, null otherwise
   */
  async getNode(nodeId: string): Promise<GraphNode | null> {
    const data = await this.db.get(this.nodeKey(nodeId));
    if (!data) {
      return null;
    }
    return JSON.parse(data.toString()) as GraphNode;
  }

  /**
   * Update a node's properties or type.
   * @param nodeId Node identifier
   * @param properties Properties to merge (null to skip)
   * @param nodeType New type (null to keep existing)
   * @returns Updated GraphNode if found, null otherwise
   */
  async updateNode(
    nodeId: string,
    properties?: Record<string, unknown>,
    nodeType?: string
  ): Promise<GraphNode | null> {
    const node = await this.getNode(nodeId);
    if (!node) {
      return null;
    }

    if (properties) {
      Object.assign(node.properties, properties);
    }
    if (nodeType) {
      node.type = nodeType;
    }

    await this.db.put(this.nodeKey(nodeId), JSON.stringify(node));
    return node;
  }

  /**
   * Delete a node from the graph.
   * @param nodeId Node identifier
   * @param cascade If true, also delete all connected edges
   * @returns true if deleted, false if not found
   */
  async deleteNode(nodeId: string, cascade: boolean = false): Promise<boolean> {
    const node = await this.getNode(nodeId);
    if (!node) {
      return false;
    }

    if (cascade) {
      // Delete outgoing edges
      const outEdges = await this.getEdges(nodeId);
      for (const edge of outEdges) {
        await this.deleteEdge(nodeId, edge.edgeType, edge.toId);
      }

      // Delete incoming edges
      const inEdges = await this.getIncomingEdges(nodeId);
      for (const edge of inEdges) {
        await this.deleteEdge(edge.fromId, edge.edgeType, nodeId);
      }
    }

    await this.db.delete(this.nodeKey(nodeId));
    return true;
  }

  /**
   * Check if a node exists.
   * @param nodeId Node identifier
   * @returns true if exists, false otherwise
   */
  async nodeExists(nodeId: string): Promise<boolean> {
    const data = await this.db.get(this.nodeKey(nodeId));
    return data !== null;
  }

  // ==========================================================================
  // Edge Operations
  // ==========================================================================

  /**
   * Add an edge between two nodes.
   * @param fromId Source node ID
   * @param edgeType Edge type label (e.g., "SENT", "REFERENCES", "CAUSED")
   * @param toId Target node ID
   * @param properties Optional edge properties
   * @returns The created GraphEdge
   */
  async addEdge(
    fromId: string,
    edgeType: string,
    toId: string,
    properties: Record<string, unknown> = {}
  ): Promise<GraphEdge> {
    const edge: GraphEdge = {
      fromId,
      edgeType,
      toId,
      properties,
    };

    // Store edge
    await this.db.put(this.edgeKey(fromId, edgeType, toId), JSON.stringify(edge));

    // Store reverse index
    await this.db.put(this.reverseIndexKey(edgeType, toId, fromId), fromId);

    return edge;
  }

  /**
   * Get a specific edge.
   * @param fromId Source node ID
   * @param edgeType Edge type
   * @param toId Target node ID
   * @returns GraphEdge if found, null otherwise
   */
  async getEdge(fromId: string, edgeType: string, toId: string): Promise<GraphEdge | null> {
    const data = await this.db.get(this.edgeKey(fromId, edgeType, toId));
    if (!data) {
      return null;
    }
    return JSON.parse(data.toString()) as GraphEdge;
  }

  /**
   * Get all outgoing edges from a node.
   * @param fromId Source node ID
   * @param edgeType Optional filter by edge type
   * @returns List of GraphEdge objects
   */
  async getEdges(fromId: string, edgeType?: string): Promise<GraphEdge[]> {
    const prefix = this.edgePrefix(fromId, edgeType);
    const results = await this.db.scan(prefix);

    const edges: GraphEdge[] = [];
    for (const result of results) {
      try {
        const edge = JSON.parse(result.value.toString()) as GraphEdge;
        edges.push(edge);
      } catch {
        continue;
      }
    }

    return edges;
  }

  /**
   * Get all incoming edges to a node.
   * @param toId Target node ID
   * @param edgeType Optional filter by edge type
   * @returns List of GraphEdge objects
   */
  async getIncomingEdges(toId: string, edgeType?: string): Promise<GraphEdge[]> {
    const edges: GraphEdge[] = [];

    if (edgeType) {
      // Query specific edge type
      const prefix = this.reverseIndexPrefix(edgeType, toId);
      const results = await this.db.scan(prefix);

      for (const result of results) {
        const fromId = result.value.toString();
        const edge = await this.getEdge(fromId, edgeType, toId);
        if (edge) {
          edges.push(edge);
        }
      }
    } else {
      // Query all edge types - scan all index entries
      const indexPrefix = `${this.prefix}/index/`;
      const results = await this.db.scan(indexPrefix);

      for (const result of results) {
        const parts = result.key.toString().split('/');
        if (parts.length >= 6 && parts[4] === toId) {
          const fromId = result.value.toString();
          const et = parts[3];
          const edge = await this.getEdge(fromId, et, toId);
          if (edge) {
            edges.push(edge);
          }
        }
      }
    }

    return edges;
  }

  /**
   * Delete an edge.
   * @param fromId Source node ID
   * @param edgeType Edge type
   * @param toId Target node ID
   * @returns true if deleted, false if not found
   */
  async deleteEdge(fromId: string, edgeType: string, toId: string): Promise<boolean> {
    const edge = await this.getEdge(fromId, edgeType, toId);
    if (!edge) {
      return false;
    }

    // Delete edge
    await this.db.delete(this.edgeKey(fromId, edgeType, toId));

    // Delete reverse index
    await this.db.delete(this.reverseIndexKey(edgeType, toId, fromId));

    return true;
  }

  // ==========================================================================
  // Traversal Operations
  // ==========================================================================

  /**
   * Breadth-first search from a starting node.
   * @param startId Starting node ID
   * @param maxDepth Maximum traversal depth
   * @param edgeTypes Optional filter by edge types
   * @param nodeTypes Optional filter by node types
   * @returns List of reachable node IDs in BFS order
   */
  async bfs(
    startId: string,
    maxDepth: number = 10,
    edgeTypes?: string[],
    nodeTypes?: string[]
  ): Promise<string[]> {
    return this.traverse(startId, maxDepth, edgeTypes, nodeTypes, TraversalOrder.BFS);
  }

  /**
   * Depth-first search from a starting node.
   * @param startId Starting node ID
   * @param maxDepth Maximum traversal depth
   * @param edgeTypes Optional filter by edge types
   * @param nodeTypes Optional filter by node types
   * @returns List of reachable node IDs in DFS order
   */
  async dfs(
    startId: string,
    maxDepth: number = 10,
    edgeTypes?: string[],
    nodeTypes?: string[]
  ): Promise<string[]> {
    return this.traverse(startId, maxDepth, edgeTypes, nodeTypes, TraversalOrder.DFS);
  }

  private async traverse(
    startId: string,
    maxDepth: number,
    edgeTypes?: string[],
    nodeTypes?: string[],
    order: TraversalOrder = TraversalOrder.BFS
  ): Promise<string[]> {
    const visited = new Set<string>();
    const result: string[] = [];

    interface Item {
      nodeId: string;
      depth: number;
    }

    const frontier: Item[] = [{ nodeId: startId, depth: 0 }];
    const edgeTypeSet = new Set(edgeTypes || []);
    const nodeTypeSet = new Set(nodeTypes || []);

    while (frontier.length > 0) {
      const current =
        order === TraversalOrder.BFS ? frontier.shift()! : frontier.pop()!;

      if (visited.has(current.nodeId)) {
        continue;
      }
      visited.add(current.nodeId);

      // Check node type filter
      if (nodeTypes && nodeTypes.length > 0) {
        const node = await this.getNode(current.nodeId);
        if (!node || !nodeTypeSet.has(node.type)) {
          continue;
        }
      }

      result.push(current.nodeId);

      if (current.depth >= maxDepth) {
        continue;
      }

      // Get outgoing edges
      const edges = await this.getEdges(current.nodeId);
      for (const edge of edges) {
        if (edgeTypes && edgeTypes.length > 0 && !edgeTypeSet.has(edge.edgeType)) {
          continue;
        }
        if (!visited.has(edge.toId)) {
          frontier.push({ nodeId: edge.toId, depth: current.depth + 1 });
        }
      }
    }

    return result;
  }

  /**
   * Find shortest path between two nodes using BFS.
   * @param fromId Source node ID
   * @param toId Target node ID
   * @param maxDepth Maximum path length
   * @param edgeTypes Optional filter by edge types
   * @returns List of node IDs forming the path, or null if not reachable
   */
  async shortestPath(
    fromId: string,
    toId: string,
    maxDepth: number = 10,
    edgeTypes?: string[]
  ): Promise<string[] | null> {
    if (fromId === toId) {
      return [fromId];
    }

    const visited = new Set<string>([fromId]);
    const parent = new Map<string, string>();

    interface Item {
      nodeId: string;
      depth: number;
    }

    const frontier: Item[] = [{ nodeId: fromId, depth: 0 }];
    const edgeTypeSet = new Set(edgeTypes || []);

    while (frontier.length > 0) {
      const current = frontier.shift()!;

      if (current.depth >= maxDepth) {
        continue;
      }

      const edges = await this.getEdges(current.nodeId);
      for (const edge of edges) {
        if (edgeTypes && edgeTypes.length > 0 && !edgeTypeSet.has(edge.edgeType)) {
          continue;
        }

        const nextId = edge.toId;
        if (visited.has(nextId)) {
          continue;
        }

        visited.add(nextId);
        parent.set(nextId, current.nodeId);

        if (nextId === toId) {
          // Reconstruct path
          const path: string[] = [toId];
          let curr = toId;
          while (parent.has(curr)) {
            curr = parent.get(curr)!;
            path.unshift(curr);
          }
          return path;
        }

        frontier.push({ nodeId: nextId, depth: current.depth + 1 });
      }
    }

    return null; // No path found
  }

  // ==========================================================================
  // Query Operations
  // ==========================================================================

  /**
   * Get neighboring nodes with their connecting edges.
   * @param nodeId Node ID
   * @param edgeTypes Optional filter by edge types
   * @param direction Edge direction ('outgoing', 'incoming', or 'both')
   * @returns List of Neighbor objects
   */
  async getNeighbors(
    nodeId: string,
    edgeTypes?: string[],
    direction: EdgeDirection = EdgeDirection.OUTGOING
  ): Promise<Neighbor[]> {
    const neighbors: Neighbor[] = [];
    const edgeTypeSet = new Set(edgeTypes || []);

    if (direction === EdgeDirection.OUTGOING || direction === EdgeDirection.BOTH) {
      const edges = await this.getEdges(nodeId);
      for (const edge of edges) {
        if (edgeTypes && edgeTypes.length > 0 && !edgeTypeSet.has(edge.edgeType)) {
          continue;
        }
        neighbors.push({ nodeId: edge.toId, edge });
      }
    }

    if (direction === EdgeDirection.INCOMING || direction === EdgeDirection.BOTH) {
      const edges = await this.getIncomingEdges(nodeId);
      for (const edge of edges) {
        if (edgeTypes && edgeTypes.length > 0 && !edgeTypeSet.has(edge.edgeType)) {
          continue;
        }
        neighbors.push({ nodeId: edge.fromId, edge });
      }
    }

    return neighbors;
  }

  /**
   * Get all nodes of a specific type.
   * Note: This scans all nodes, use sparingly for large graphs.
   * @param nodeType Node type to filter by
   * @param limit Maximum number of nodes to return
   * @returns List of GraphNode objects
   */
  async getNodesByType(nodeType: string, limit: number = 100): Promise<GraphNode[]> {
    const prefix = `${this.prefix}/nodes/`;
    const results = await this.db.scan(prefix);

    const nodes: GraphNode[] = [];
    for (const result of results) {
      try {
        const node = JSON.parse(result.value.toString()) as GraphNode;
        if (node.type === nodeType) {
          nodes.push(node);
          if (nodes.length >= limit) {
            break;
          }
        }
      } catch {
        continue;
      }
    }

    return nodes;
  }

  /**
   * Get a subgraph starting from a node.
   * @param startId Starting node ID
   * @param maxDepth Maximum traversal depth
   * @param edgeTypes Optional filter by edge types
   * @returns Subgraph containing nodes and edges
   */
  async getSubgraph(
    startId: string,
    maxDepth: number = 2,
    edgeTypes?: string[]
  ): Promise<Subgraph> {
    const nodeIds = await this.bfs(startId, maxDepth, edgeTypes);

    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    // First collect all nodes
    for (const nodeId of nodeIds) {
      const node = await this.getNode(nodeId);
      if (node) {
        nodes.set(nodeId, node);
      }
    }

    // Then collect edges where both endpoints are in the subgraph
    for (const nodeId of nodeIds) {
      const nodeEdges = await this.getEdges(nodeId);
      for (const edge of nodeEdges) {
        if (nodes.has(edge.toId)) {
          edges.push(edge);
        }
      }
    }

    return { nodes, edges };
  }
}
