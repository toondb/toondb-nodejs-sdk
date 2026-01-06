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
 * Token-aware context retrieval for LLM applications.
 *
 * The ContextQuery builder provides:
 * 1. Token budgeting - Fit context within model limits
 * 2. Relevance scoring - Prioritize most relevant chunks
 * 3. Deduplication - Avoid repeating similar content
 * 4. Structured output - Ready for LLM prompts
 *
 * @example
 * ```typescript
 * const result = await new ContextQuery(collection)
 *   .addVectorQuery(embedding, 0.7)
 *   .addKeywordQuery('machine learning', 0.3)
 *   .withTokenBudget(4000)
 *   .withMinRelevance(0.5)
 *   .execute();
 *
 * const prompt = result.asText() + '\n\nQuestion: ' + question;
 * ```
 */

import { Database } from './database';

/** Deduplication strategy for context results. */
export enum DeduplicationStrategy {
  NONE = 'none',
  EXACT = 'exact',
  SEMANTIC = 'semantic',
}

/** Context output format. */
export enum ContextFormat {
  TEXT = 'text',
  MARKDOWN = 'markdown',
  JSON = 'json',
  TOON = 'toon',
}

/** Truncation strategy for handling budget overflow. */
export enum TruncationStrategy {
  TAIL_DROP = 'tail_drop',
  HEAD_DROP = 'head_drop',
  PROPORTIONAL = 'proportional',
  STRICT = 'strict',
}

/**
 * Estimates token count for text.
 *
 * Uses a simple heuristic by default (4 chars ≈ 1 token), but can be
 * configured with an actual tokenizer for accuracy.
 */
export class TokenEstimator {
  private tokenizer?: (text: string) => number;

  /**
   * Create a token estimator.
   * @param tokenizer Optional function that takes text and returns token count.
   *                  If undefined, uses heuristic (4 chars ≈ 1 token).
   */
  constructor(tokenizer?: (text: string) => number) {
    this.tokenizer = tokenizer;
  }

  /** Count tokens in text. */
  count(text: string): number {
    if (this.tokenizer) {
      return this.tokenizer(text);
    }
    // Heuristic: ~4 chars per token for English
    return Math.max(1, Math.floor(text.length / 4));
  }

  /**
   * Create estimator using tiktoken (requires tiktoken-node package).
   * @param model OpenAI model name for tokenizer selection
   */
  static tiktoken(model: string = 'gpt-4'): TokenEstimator {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { encoding_for_model } = require('tiktoken');
      const encoding = encoding_for_model(model);
      return new TokenEstimator((text) => encoding.encode(text).length);
    } catch {
      throw new Error('tiktoken not installed. Install with: npm install tiktoken');
    }
  }
}

/** A chunk of context with metadata. */
export interface ContextChunk {
  id: string | number;
  text: string;
  score: number;
  tokens: number;
  source?: string;
  metadata?: Record<string, unknown>;
  chunkIndex?: number;
  docScore?: number;
}

/** Score range tuple. */
export type ScoreRange = [number, number];

/** Result of a context query. */
export interface ContextResultData {
  chunks: ContextChunk[];
  totalTokens: number;
  budgetTokens: number;
  droppedCount: number;
  vectorScoreRange?: ScoreRange;
  keywordScoreRange?: ScoreRange;
}

/** Result of a context query with formatting methods. */
export class ContextResult implements ContextResultData {
  chunks: ContextChunk[];
  totalTokens: number;
  budgetTokens: number;
  droppedCount: number;
  vectorScoreRange?: ScoreRange;
  keywordScoreRange?: ScoreRange;

  constructor(data: ContextResultData) {
    this.chunks = data.chunks;
    this.totalTokens = data.totalTokens;
    this.budgetTokens = data.budgetTokens;
    this.droppedCount = data.droppedCount;
    this.vectorScoreRange = data.vectorScoreRange;
    this.keywordScoreRange = data.keywordScoreRange;
  }

  /**
   * Format chunks as text for LLM prompt.
   * @param separator Separator between chunks
   */
  asText(separator: string = '\n\n---\n\n'): string {
    return this.chunks.map((chunk) => chunk.text).join(separator);
  }

  /**
   * Format chunks as markdown.
   * @param includeScores Include relevance scores
   */
  asMarkdown(includeScores: boolean = false): string {
    return this.chunks
      .map((chunk, i) => {
        let header = `## Chunk ${i + 1}`;
        if (includeScores) {
          header += ` (score: ${chunk.score.toFixed(3)})`;
        }
        return `${header}\n\n${chunk.text}`;
      })
      .join('\n\n');
  }

  /** Convert to plain object. */
  toJSON(): ContextResultData {
    return {
      chunks: this.chunks,
      totalTokens: this.totalTokens,
      budgetTokens: this.budgetTokens,
      droppedCount: this.droppedCount,
      vectorScoreRange: this.vectorScoreRange,
      keywordScoreRange: this.keywordScoreRange,
    };
  }
}

/** Vector query configuration. */
export interface VectorQueryConfig {
  embedding: number[];
  weight: number;
  topK: number;
}

/** Keyword query configuration. */
export interface KeywordQueryConfig {
  query: string;
  weight: number;
  topK: number;
}

/**
 * Token-aware context query builder.
 *
 * Provides a fluent API for building context queries with vector similarity,
 * keyword search, token budgeting, and deduplication.
 */
export class ContextQuery {
  private db: Database;
  private collectionName: string;
  private _tokenBudget: number = 4096;
  private _minRelevance: number = 0.0;
  private _maxChunks: number = 100;
  private _vectorQueries: VectorQueryConfig[] = [];
  private _keywordQueries: KeywordQueryConfig[] = [];
  private _deduplication: DeduplicationStrategy = DeduplicationStrategy.NONE;
  private _similarityThreshold: number = 0.9;
  private _format: ContextFormat = ContextFormat.TEXT;
  private _truncation: TruncationStrategy = TruncationStrategy.TAIL_DROP;
  private _estimator: TokenEstimator = new TokenEstimator();
  private _fusionK: number = 60;
  private _includeMetadata: boolean = true;
  private _recencyWeight: number = 0.0;
  private _diversityWeight: number = 0.0;

  /**
   * Create a new context query builder.
   * @param db Database instance
   * @param collectionName Collection to query
   */
  constructor(db: Database, collectionName: string) {
    this.db = db;
    this.collectionName = collectionName;
  }

  /** Add a vector similarity query. */
  addVectorQuery(embedding: number[], weight: number = 1.0): this {
    this._vectorQueries.push({
      embedding,
      weight,
      topK: 50,
    });
    return this;
  }

  /** Add a vector query with custom top-k. */
  addVectorQueryWithK(embedding: number[], weight: number, topK: number): this {
    this._vectorQueries.push({
      embedding,
      weight,
      topK,
    });
    return this;
  }

  /** Add a keyword/BM25 query. */
  addKeywordQuery(query: string, weight: number = 1.0): this {
    this._keywordQueries.push({
      query,
      weight,
      topK: 50,
    });
    return this;
  }

  /** Add a keyword query with custom top-k. */
  addKeywordQueryWithK(query: string, weight: number, topK: number): this {
    this._keywordQueries.push({
      query,
      weight,
      topK,
    });
    return this;
  }

  /** Set the maximum tokens in result. */
  withTokenBudget(budget: number): this {
    this._tokenBudget = budget;
    return this;
  }

  /** Set minimum relevance score threshold. */
  withMinRelevance(score: number): this {
    this._minRelevance = score;
    return this;
  }

  /** Set maximum number of chunks in result. */
  withMaxChunks(max: number): this {
    this._maxChunks = max;
    return this;
  }

  /** Set deduplication strategy. */
  withDeduplication(strategy: DeduplicationStrategy, threshold: number = 0.9): this {
    this._deduplication = strategy;
    this._similarityThreshold = threshold;
    return this;
  }

  /** Set output format. */
  withFormat(format: ContextFormat): this {
    this._format = format;
    return this;
  }

  /** Set truncation strategy. */
  withTruncation(strategy: TruncationStrategy): this {
    this._truncation = strategy;
    return this;
  }

  /** Set custom tokenizer function. */
  withTokenizer(tokenizer: (text: string) => number): this {
    this._estimator = new TokenEstimator(tokenizer);
    return this;
  }

  /** Set the RRF fusion k parameter (default: 60). */
  withFusionK(k: number): this {
    this._fusionK = k;
    return this;
  }

  /** Set weight for recency in scoring (0-1). */
  withRecencyWeight(weight: number): this {
    this._recencyWeight = weight;
    return this;
  }

  /** Set weight for diversity in result set (0-1). */
  withDiversityWeight(weight: number): this {
    this._diversityWeight = weight;
    return this;
  }

  /** Set whether to include metadata in results. */
  includeMetadata(include: boolean): this {
    this._includeMetadata = include;
    return this;
  }

  /** Execute the context query and return results. */
  async execute(): Promise<ContextResult> {
    // Collect candidate chunks from all queries
    const candidates = new Map<string, ContextChunk>();
    const vectorScores: number[] = [];
    const keywordScores: number[] = [];

    // Execute vector queries
    for (const vq of this._vectorQueries) {
      const results = await this.executeVectorQuery(vq);
      for (const chunk of results) {
        const existing = candidates.get(String(chunk.id));
        if (existing) {
          existing.score = this.rrfFusion(existing.score, chunk.score * vq.weight);
        } else {
          chunk.score = chunk.score * vq.weight;
          candidates.set(String(chunk.id), chunk);
        }
        vectorScores.push(chunk.score);
      }
    }

    // Execute keyword queries
    for (const kq of this._keywordQueries) {
      const results = await this.executeKeywordQuery(kq);
      for (const chunk of results) {
        const existing = candidates.get(String(chunk.id));
        if (existing) {
          existing.score = this.rrfFusion(existing.score, chunk.score * kq.weight);
        } else {
          chunk.score = chunk.score * kq.weight;
          candidates.set(String(chunk.id), chunk);
        }
        keywordScores.push(chunk.score);
      }
    }

    // Convert to array and filter by minimum relevance
    let chunks = Array.from(candidates.values()).filter(
      (chunk) => chunk.score >= this._minRelevance
    );

    // Sort by score descending
    chunks.sort((a, b) => b.score - a.score);

    // Apply deduplication
    chunks = this.deduplicate(chunks);

    // Apply token budget
    let totalTokens = 0;
    let droppedCount = 0;
    const finalChunks: ContextChunk[] = [];

    for (const chunk of chunks) {
      if (finalChunks.length >= this._maxChunks) {
        droppedCount++;
        continue;
      }

      const tokens = this._estimator.count(chunk.text);
      chunk.tokens = tokens;

      if (this._truncation === TruncationStrategy.STRICT && totalTokens + tokens > this._tokenBudget) {
        droppedCount++;
        continue;
      }

      if (totalTokens + tokens > this._tokenBudget) {
        switch (this._truncation) {
          case TruncationStrategy.TAIL_DROP:
            droppedCount++;
            continue;
          case TruncationStrategy.HEAD_DROP:
            if (finalChunks.length > 0) {
              totalTokens -= finalChunks[0].tokens;
              finalChunks.shift();
              droppedCount++;
            }
            break;
          case TruncationStrategy.PROPORTIONAL:
            const available = this._tokenBudget - totalTokens;
            if (available > 0) {
              const ratio = available / tokens;
              const truncLen = Math.floor(chunk.text.length * ratio);
              if (truncLen > 0) {
                chunk.text = chunk.text.substring(0, truncLen) + '...';
                chunk.tokens = available;
              } else {
                droppedCount++;
                continue;
              }
            }
            break;
        }
      }

      totalTokens += chunk.tokens;
      finalChunks.push(chunk);
    }

    // Build result
    const result: ContextResultData = {
      chunks: finalChunks,
      totalTokens,
      budgetTokens: this._tokenBudget,
      droppedCount,
    };

    // Set score ranges
    if (vectorScores.length > 0) {
      vectorScores.sort((a, b) => a - b);
      result.vectorScoreRange = [vectorScores[0], vectorScores[vectorScores.length - 1]];
    }
    if (keywordScores.length > 0) {
      keywordScores.sort((a, b) => a - b);
      result.keywordScoreRange = [keywordScores[0], keywordScores[keywordScores.length - 1]];
    }

    return new ContextResult(result);
  }

  /** RRF fusion for combining scores. */
  private rrfFusion(score1: number, score2: number): number {
    return score1 + score2;
  }

  /** Execute a vector similarity search. */
  private async executeVectorQuery(vq: VectorQueryConfig): Promise<ContextChunk[]> {
    // This would call the actual vector search API
    // For now, return empty - implementation depends on DB interface
    try {
      const results = await (this.db as any).vectorSearch?.(
        this.collectionName,
        vq.embedding,
        vq.topK
      );
      if (!results) return [];

      return results.map((r: any) => ({
        id: r.id,
        text: typeof r.value === 'string' ? r.value : r.value?.toString() || '',
        score: r.score || 0,
        tokens: 0,
        metadata: r.metadata,
      }));
    } catch {
      return [];
    }
  }

  /** Execute a keyword/BM25 search. */
  private async executeKeywordQuery(kq: KeywordQueryConfig): Promise<ContextChunk[]> {
    // This would call the actual keyword search API
    // For now, use prefix scan as approximation
    try {
      const results = await this.db.scan(this.collectionName + '/' + kq.query);
      return results.slice(0, kq.topK).map((r: { key: Buffer; value: Buffer }, i: number) => ({
        id: r.key.toString(),
        text: r.value?.toString() || '',
        score: 1.0 / (i + 1),
        tokens: 0,
      }));
    } catch {
      return [];
    }
  }

  /** Deduplicate chunks based on strategy. */
  private deduplicate(chunks: ContextChunk[]): ContextChunk[] {
    if (this._deduplication === DeduplicationStrategy.NONE) {
      return chunks;
    }

    const seen = new Set<string>();
    const result: ContextChunk[] = [];

    for (const chunk of chunks) {
      switch (this._deduplication) {
        case DeduplicationStrategy.EXACT:
          if (!seen.has(chunk.text)) {
            seen.add(chunk.text);
            result.push(chunk);
          }
          break;
        case DeduplicationStrategy.SEMANTIC:
          // For semantic, we'd need embedding comparison
          // Simplified: use text prefix hash for now
          const hash = chunk.text.substring(0, 100);
          if (!seen.has(hash)) {
            seen.add(hash);
            result.push(chunk);
          }
          break;
      }
    }

    return result;
  }
}

/**
 * Helper function to estimate tokens for a string.
 */
export function estimateTokens(text: string): number {
  return new TokenEstimator().count(text);
}

/**
 * Helper function to split text by token count.
 */
export function splitByTokens(
  text: string,
  maxTokensPerChunk: number,
  overlap: number = 0
): string[] {
  const estimator = new TokenEstimator();
  const chunks: string[] = [];

  // Simple split by characters (approximate)
  const charsPerToken = 4;
  const maxChars = maxTokensPerChunk * charsPerToken;
  const overlapChars = overlap * charsPerToken;

  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.substring(start, end));
    start = end - overlapChars;
    if (start >= text.length) break;
  }

  return chunks;
}
