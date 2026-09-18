import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { D1FileOwnership, ownedRawKey, type FileOperation } from '../src/file-ownership';
import { backfillLegacyFile } from '../src/owned-storage';
import { D1MetadataRepository } from '../src/kb-metadata-repository';
import type { Env } from '../src/types';

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  sqlite.exec('PRAGMA foreign_keys = ON');
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(migrations).sort()) {
    sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'));
  }
  sqlite.exec(`INSERT OR IGNORE INTO kb_projects(name) VALUES ('tenant-a'), ('tenant-b');
    INSERT OR IGNORE INTO kb_domains(project, name) VALUES ('tenant-a', 'manual'), ('tenant-b', 'manual');`);
  const prepared = (query: string, values: unknown[] = []): unknown => ({
    bind: (...params: unknown[]) => prepared(query, params),
    first: async () => sqlite.prepare(query).get(...(values as string[])) ?? null,
    all: async () => ({ results: sqlite.prepare(query).all(...(values as string[])), success: true }),
    run: async () => run(query, values),
    execute: () => run(query, values),
  });
  const run = (query: string, values: unknown[]) => {
    const result = sqlite.prepare(query).run(...(values as string[]));
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  };
  const db = {
    prepare: prepared,
    batch: async (statements: { execute(): unknown }[]) => {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  return {
    sqlite,
    db,
    ledger: new D1FileOwnership(db),
    metadata: new D1MetadataRepository(db),
  };
}

const LEGACY_CONTENT = 'a private synthetic manual for backfill';
const legacyBytes = new TextEncoder().encode(LEGACY_CONTENT);
const legacyHash = createHash('sha256').update(legacyBytes).digest('hex');

function seedLegacyFile(sqlite: DatabaseSync, overrides: Partial<{ id: string; bytes: number; hash: string; objectKey: string }> = {}) {
  const id = overrides.id ?? 'legacy-1';
  sqlite.prepare(`INSERT INTO kb_files(id, project, domain, filename, mime, bytes, content_hash, canonical_hash, object_key)
    VALUES (?, 'tenant-a', 'manual', 'manual.txt', 'text/plain', ?, ?, NULL, ?)`)
    .run(id, overrides.bytes ?? legacyBytes.length, overrides.hash ?? legacyHash, overrides.objectKey ?? 'raw/legacy/shared-manual');
  return id;
}

function r2With(objects: Record<string, Uint8Array | string>, hooks: { failPut?: boolean } = {}) {
  return {
    get: vi.fn(async (key: string) => {
      const value = objects[key];
      if (value === undefined) return null;
      const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      return {
        arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
        text: async () => new TextDecoder().decode(data),
      };
    }),
    put: vi.fn(async (key: string, value: ArrayBuffer | Uint8Array | string) => {
      if (hooks.failPut) throw new Error('r2 uncertain');
      objects[key] = typeof value === 'string' ? value : new Uint8Array(value instanceof ArrayBuffer ? value : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }),
    delete: vi.fn(async (key: string) => {
      delete objects[key];
    }),
    _objects: objects,
  };
}

describe('backfillLegacyFile (issue #48 task 32)', () => {
  it('adopts, verifies, copies to owned keys, rebuilds parse provenance and publishes v2', async () => {
    const { sqlite, db, ledger, metadata } = fixture();
    const fileId = seedLegacyFile(sqlite);
    sqlite.prepare(`INSERT INTO kb_parse_artifacts(content_hash, parser, parser_version, object_key, page_count)
      VALUES (?, 'docling', '1.0', 'parse/legacy/shared-manual.json', 3)`).run(legacyHash);
    const objects: Record<string, Uint8Array | string> = {
      'raw/legacy/shared-manual': legacyBytes,
      'parse/legacy/shared-manual.json': '{"pages":[1,2,3]}',
    };
    const env = { DB: db, RAW_DOCS: r2With(objects) } as unknown as Env;

    expect(await backfillLegacyFile(env, metadata, 'tenant-a', fileId)).toBe('complete');

    const lifecycle = await ledger.get('tenant-a', fileId);
    expect(lifecycle).toMatchObject({ storage_version: 2, state: 'active', generation: 2, published_generation: 2 });
    const ownedKey = ownedRawKey('tenant-a', fileId, legacyHash);
    expect(new TextDecoder().decode(objects[ownedKey] as Uint8Array)).toBe(LEGACY_CONTENT);
    // The shared legacy object is retained for the zero-reference GC review.
    expect(objects['raw/legacy/shared-manual']).toBeDefined();
    // Parse provenance is rebuilt under the operation identity.
    const parse = sqlite.prepare(
      'SELECT * FROM kb_file_parse_artifacts WHERE project=? AND file_id=? AND generation=2',
    ).get('tenant-a', fileId) as { content_hash: string; parser: string } | undefined;
    expect(parse?.content_hash).toBe(legacyHash);
    // Re-running is idempotent.
    expect(await backfillLegacyFile(env, metadata, 'tenant-a', fileId)).toBe('complete');
  });

  it('refuses to copy bytes that fail hash or size verification', async () => {
    const { sqlite, db, ledger, metadata } = fixture();
    const fileId = seedLegacyFile(sqlite, { hash: 'a'.repeat(64) });
    const objects: Record<string, Uint8Array | string> = { 'raw/legacy/shared-manual': legacyBytes };
    const env = { DB: db, RAW_DOCS: r2With(objects) } as unknown as Env;

    expect(await backfillLegacyFile(env, metadata, 'tenant-a', fileId)).toBe('conflict');
    const lifecycle = await ledger.get('tenant-a', fileId);
    expect(lifecycle?.storage_version).toBe(1);
    // No owned bytes were written.
    expect(Object.keys(objects).some((key) => key.startsWith('raw/v2/'))).toBe(false);
  });

  it('leaves the operation running truthfully when the owned write is uncertain', async () => {
    const { sqlite, db, ledger, metadata } = fixture();
    const fileId = seedLegacyFile(sqlite);
    const objects: Record<string, Uint8Array | string> = { 'raw/legacy/shared-manual': legacyBytes };
    const env = { DB: db, RAW_DOCS: r2With(objects, { failPut: true }) } as unknown as Env;

    expect(await backfillLegacyFile(env, metadata, 'tenant-a', fileId)).toBe('pending');
    const reconciliation = await ledger.reconcileOperations('tenant-a', fileId);
    expect(reconciliation).toHaveLength(1);
    expect(reconciliation[0]?.classification).toBe('pending');
    expect(reconciliation[0]?.operation.kind).toBe('copy');
    // Settlement never comes from elapsed time: the op stays running.
    const running = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM kb_file_operations WHERE state='running'",
    ).get() as { n: number };
    expect(running.n).toBe(1);
  });
});

describe('reconcileOperations (issue #48 task 33)', () => {
  it('classifies prepared-only operations as settleable and started writes as pending', async () => {
    const { db, ledger, sqlite } = fixture();
    sqlite.prepare(`INSERT INTO kb_files(id, project, domain, filename, mime, bytes, content_hash, object_key)
      VALUES ('f1', 'tenant-a', 'manual', 'a.txt', 'text/plain', 5, 'h1', 'raw/v2/x')`).run();
    sqlite.exec(`INSERT INTO kb_file_lifecycle(project, file_id, domain, content_hash, storage_version, state, generation)
      VALUES ('tenant-a', 'f1', 'manual', 'h1', 2, 'active', 1)`);

    const settleable = await ledger.claim('tenant-a', 'f1', 'op-prepared', 'reprocess')!;
    await ledger.recordIntent(settleable!, { artifact_id: 'art-1', kind: 'parse', resource_id: 'parse/v2/x', provider: 'r2' });

    // Claim a second file whose artifact write started but never settled.
    sqlite.prepare(`INSERT INTO kb_files(id, project, domain, filename, mime, bytes, content_hash, object_key)
      VALUES ('f2', 'tenant-a', 'manual', 'b.txt', 'text/plain', 5, 'h2', 'raw/v2/y')`).run();
    sqlite.exec(`INSERT INTO kb_file_lifecycle(project, file_id, domain, content_hash, storage_version, state, generation)
      VALUES ('tenant-a', 'f2', 'manual', 'h2', 2, 'active', 1)`);
    const started = await ledger.claim('tenant-a', 'f2', 'op-started', 'reprocess')!;
    await ledger.recordIntent(started!, { artifact_id: 'art-2', kind: 'raw', resource_id: 'raw/v2/y', provider: 'r2' });
    await ledger.startWrite(started!, 'art-2');

    const [first, second] = [
      await ledger.reconcileOperations('tenant-a', 'f1'),
      await ledger.reconcileOperations('tenant-a', 'f2'),
    ];
    expect(first).toHaveLength(1);
    expect(first[0]?.classification).toBe('settleable');
    expect(second).toHaveLength(1);
    expect(second[0]?.classification).toBe('pending');
    expect(second[0]?.artifacts[0]?.dispatch_state).toBe('started');

    // A settleable operation can be cancelled; a pending one cannot.
    expect(await ledger.cancelPrepared('tenant-a', 'op-prepared')).toBe(true);
    expect(await ledger.cancelPrepared('tenant-a', 'op-started')).toBe(false);
    expect((await ledger.reconcileOperations('tenant-a', 'f2'))[0]?.classification).toBe('pending');
  });
});
