import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { URL } from 'node:url';
import { D1Repository } from '../src/d1-repository';
import type { CreateChunkInput, CreateDocumentInput } from '../src/repository';
import type { Env, VectorizeBinding } from '../src/types';
import { vi } from 'vitest';

export function catalogFixture(through = '0011_catalog_snapshots_fts_decisions.sql') {
  const sqlite = new DatabaseSync(':memory:');
  const directory = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith('.sql') && name <= through)
    .sort())
    sqlite.exec(readFileSync(new URL(file, directory), 'utf8'));
  class Statement {
    values: SQLInputValue[] = [];
    constructor(readonly sql: string) {}
    bind(...values: SQLInputValue[]) {
      this.values = values;
      return this;
    }
    async first(column?: string) {
      const row = sqlite.prepare(this.sql).get(...this.values);
      return column ? (row?.[column] ?? null) : (row ?? null);
    }
    async all() {
      return { success: true, results: sqlite.prepare(this.sql).all(...this.values), meta: {} };
    }
    async run() {
      const result = sqlite.prepare(this.sql).run(...this.values);
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  const repo = new D1Repository(db);
  const upsert = vi.fn(async () => ({ mutationId: 'local-mutation' }));
  const remove = vi.fn(async () => ({ mutationId: 'local-delete' }));
  const binding = { upsert, deleteByIds: remove, query: vi.fn(async () => ({ matches: [] })) } as unknown as VectorizeBinding;
  const debits: number[] = [];
  const budgetFetch = vi.fn(async (_url: string, init: RequestInit) => {
    const { dimensions } = JSON.parse(String(init.body)) as { dimensions: number };
    debits.push(dimensions);
    return Response.json({
      allowed: true,
      baselineVerified: true,
      monthKey: new Date().toISOString().slice(0, 7),
      retryAfter: 0,
      used: dimensions,
      remaining: 45000000 - dimensions,
      storedCap: 200000000,
      storedUsed: dimensions,
      storedRemaining: 200000000 - dimensions,
    });
  });
  const env = {
    DB: db,
    VECTORIZE: binding,
    AI: { run: vi.fn() },
    RAG_SERVICE_KEYS: JSON.stringify({ 'local-key': 'tenant-a' }),
    NEURON_BUDGET: { idFromName: (name: string) => name, get: () => ({ fetch: budgetFetch }) },
  } as unknown as Env;
  return { sqlite, db, repo, env, binding, upsert, remove, debits, budgetFetch };
}

export function sourceDocument(
  id: string,
  content = 'Supports source-grounded repository recommendations.',
  overrides: Partial<CreateDocumentInput> = {},
): CreateDocumentInput {
  return {
    id,
    tenant: 'tenant-a',
    indexId: 'catalog',
    externalId: `repo:${id}`,
    content,
    metadata: { _kb_snapshot_state: 'current', kind: 'catalog_repo', visibility: 'public' },
    ...overrides,
  };
}
export function sourceChunk(document: CreateDocumentInput, id = `chunk:${document.id}`): CreateChunkInput {
  return {
    id,
    tenant: document.tenant,
    indexId: document.indexId,
    documentId: document.id,
    content: document.content,
    chunkIndex: 0,
    metadata: document.metadata,
  };
}
export async function createCatalogIndex(repo: D1Repository, id = 'catalog', tenant = 'tenant-a') {
  return repo.createIndex({ id, tenant, name: id, externalId: id, dimensions: 768, embeddingModel: '@cf/baai/bge-base-en-v1.5', embeddingProvider: null });
}
