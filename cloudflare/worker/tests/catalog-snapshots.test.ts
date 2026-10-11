import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { ingestCatalogDocument } from '../src/catalog-ingest';
import { createRuntime } from '../src/runtime';
import { createApp } from '../src/index';
import { catalogFixture, createCatalogIndex, sourceChunk, sourceDocument } from './catalog-fixture';

describe('catalog source snapshots', () => {
  it('applies the catalog migration without changing duplicate legacy document visibility', async () => {
    const { repo, sqlite } = catalogFixture('0010_file_dispatch_recovery.sql');
    await createCatalogIndex(repo);
    const one = sourceDocument('legacy-one', 'Private legacy source one.', { externalId: 'legacy:duplicate', metadata: { filename: 'legacy-one.md' } });
    const two = sourceDocument('legacy-two', 'Private legacy source two.', { externalId: one.externalId, metadata: { filename: 'legacy-two.md' } });
    await repo.createDocument(one);
    await repo.insertChunks([sourceChunk(one)]);
    await repo.createDocument(two);
    await repo.insertChunks([sourceChunk(two)]);
    sqlite.exec(readFileSync(new URL('../migrations/0011_catalog_snapshots_fts_decisions.sql', import.meta.url), 'utf8'));
    expect(await repo.listDocuments('tenant-a', 'catalog', 10, 0)).toHaveLength(2);
    expect(await repo.getChunksByIds('tenant-a', ['chunk:legacy-one', 'chunk:legacy-two'])).toHaveLength(2);
    expect((await repo.getDocument('tenant-a', one.id))?.metadata).toEqual(one.metadata);
    expect(await repo.getDocumentByExternalId('tenant-a', 'catalog', 'legacy:duplicate')).toBeNull();
    const protocol = sourceDocument('protocol', 'New canonical source.', { externalId: one.externalId });
    await repo.publishDocumentSnapshot(protocol, [sourceChunk(protocol)], null);
    expect((await repo.getDocumentByExternalId('tenant-a', 'catalog', one.externalId!))?.id).toBe('protocol');
    expect(await repo.listDocuments('tenant-a', 'catalog', 10, 0)).toHaveLength(3);
    sqlite.close();
  });
  it('retains historical citations, publishes one current revision, and filters stale vectors', async () => {
    const { repo, sqlite } = catalogFixture();
    await createCatalogIndex(repo);
    const old = sourceDocument('old');
    await repo.publishDocumentSnapshot(old, [sourceChunk(old)], null);
    const before = await repo.getIndexRevision('tenant-a', 'catalog');
    const replacement = sourceDocument('new', 'Supports exact source citations.', { externalId: old.externalId });
    await repo.publishDocumentSnapshot(replacement, [sourceChunk(replacement)], old.id);
    expect((await repo.getDocumentByExternalId('tenant-a', 'catalog', old.externalId!))?.id).toBe('new');
    expect((await repo.getDocument('tenant-a', 'old'))?.metadata._kb_snapshot_state).toBe('superseded');
    expect(await repo.getDocumentChunks('tenant-a', 'old')).toHaveLength(1);
    expect(await repo.getChunksByIds('tenant-a', ['chunk:old', 'chunk:new'])).toHaveLength(1);
    expect(await repo.getIndexRevision('tenant-a', 'catalog')).toBeGreaterThan(before);
    expect(await repo.getDocumentByExternalId('tenant-b', 'catalog', old.externalId!)).toBeNull();
    sqlite.close();
  });

  it('rolls back a losing publication without changing the winner', async () => {
    const { repo, sqlite } = catalogFixture();
    await createCatalogIndex(repo);
    const old = sourceDocument('old');
    await repo.publishDocumentSnapshot(old, [sourceChunk(old)], null);
    const winner = sourceDocument('winner', 'Winning revision.', { externalId: old.externalId });
    await repo.publishDocumentSnapshot(winner, [sourceChunk(winner)], old.id);
    const loser = sourceDocument('loser', 'Losing revision.', { externalId: old.externalId });
    await expect(repo.publishDocumentSnapshot(loser, [sourceChunk(loser)], old.id)).rejects.toThrow(/UNIQUE/);
    expect(await repo.getDocument('tenant-a', 'loser')).toBeNull();
    expect((await repo.getDocumentByExternalId('tenant-a', 'catalog', old.externalId!))?.id).toBe('winner');
    sqlite.close();
  });

  it('finds filtered evidence beyond the former first-5000-chunk corpus limit', async () => {
    const { repo, sqlite } = catalogFixture();
    await createCatalogIndex(repo);
    const noise = sourceDocument('noise', 'needle noise', { metadata: { kind: 'noise' } });
    await repo.createDocument(noise);
    await repo.insertChunks(Array.from({ length: 5005 }, (_, n) => ({ ...sourceChunk(noise, `noise:${n}`), chunkIndex: n })));
    const relevant = sourceDocument('target', 'needle relevant source');
    await repo.publishDocumentSnapshot(relevant, [sourceChunk(relevant)], null);
    const rows = await repo.searchLexicalChunks('tenant-a', 'catalog', ['needle'], 1, { kind: 'catalog_repo', visibility: 'public' });
    expect(rows.map((row) => row.id)).toEqual(['chunk:target']);
    expect(await repo.searchLexicalChunks('tenant-b', 'catalog', ['needle'], 1)).toEqual([]);
    sqlite.close();
  });

  it('reserves before inference, uploads then publishes, and replays without another debit', async () => {
    const fixture = catalogFixture();
    const { repo, env, sqlite, upsert, debits } = fixture;
    const index = await createCatalogIndex(repo);
    const embed = vi.fn(async (_env, texts: string[], options) => {
      expect(debits.length).toBe(1);
      expect(await repo.getDocumentByExternalId('tenant-a', 'catalog', 'repo:1')).toBeNull();
      return texts.map(() => Array(options.dimensions).fill(0.1));
    });
    const rt = createRuntime({ makeRepository: () => repo, embed });
    const input = {
      external_id: 'repo:1',
      content: 'An indexed catalog source.',
      metadata: { schema_version: 1, kind: 'catalog_repo', visibility: 'public', source_revision: 'sha' },
    };
    const first = await ingestCatalogDocument(env, rt, repo, index, input, undefined);
    const replay = await ingestCatalogDocument(env, rt, repo, index, input, undefined);
    expect(first.idempotent).toBe(false);
    expect(replay).toMatchObject({ document_id: first.document_id, idempotent: true, chunks_created: 0 });
    expect(debits).toEqual([768]);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    sqlite.close();
  });

  it('never calls inference or publishes when storage admission is denied', async () => {
    const { repo, env, sqlite, budgetFetch, upsert } = catalogFixture();
    const index = await createCatalogIndex(repo);
    budgetFetch.mockResolvedValueOnce(Response.json({ allowed: false }));
    const embed = vi.fn();
    const rt = createRuntime({ makeRepository: () => repo, embed });
    await expect(
      ingestCatalogDocument(
        env,
        rt,
        repo,
        index,
        { external_id: 'repo:1', content: 'Source text.', metadata: { kind: 'catalog_repo', visibility: 'public' } },
        undefined,
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(embed).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(await repo.listDocuments('tenant-a', 'catalog', 10, 0)).toEqual([]);
    sqlite.close();
  });

  it('exposes retrievable snapshots only to the authenticated tenant', async () => {
    const { repo, env, sqlite } = catalogFixture();
    await createCatalogIndex(repo);
    const document = sourceDocument('source');
    await repo.publishDocumentSnapshot(document, [sourceChunk(document)], null);
    const app = createApp({ makeRepository: () => repo });
    const headers = { Authorization: 'Bearer local-key' };
    const response = await app.request('/v1/indexes/catalog/documents/by-external-id?external_id=repo:source', { headers }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ document: { id: 'source' }, chunks: [{ id: 'chunk:source' }] });
    expect((await app.request('/v1/documents/source', {}, env)).status).toBe(401);
    env.RAG_SERVICE_KEYS = JSON.stringify({ 'local-key': 'tenant-b' });
    expect((await app.request('/v1/documents/source', { headers }, env)).status).toBe(404);
    sqlite.close();
  });
});
