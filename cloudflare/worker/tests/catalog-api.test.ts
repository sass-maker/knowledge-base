import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index';
import { catalogFixture, createCatalogIndex } from './catalog-fixture';
import type { JsonRecord } from '../src/types';

async function apiFixture() {
  const fixture = catalogFixture();
  await createCatalogIndex(fixture.repo);
  const gatewayRequests: JsonRecord[] = [];
  const gateway = vi.fn(async (request: Request) => {
    const body = (await request.json()) as { model: string; project_id: string; messages: Array<{ content: string }> };
    expect(body.model).toBe('auto');
    expect(body.project_id).toBe('knowledge-base');
    const input = JSON.parse(body.messages[1]!.content) as JsonRecord;
    gatewayRequests.push(input);
    let output: JsonRecord;
    if (Array.isArray(input.chunks)) {
      const chunk = input.chunks[0] as { document_id: string; chunk_id: string; text: string };
      const evidence = { document_id: chunk.document_id, chunk_id: chunk.chunk_id, excerpt: chunk.text };
      output = { facts: [{ field: 'purpose', value: 'Repository source citations.', evidence: [evidence] }], inferences: [], needs: [] };
    } else {
      const questions = input.questions as Record<string, { criteria: Record<string, string> }>;
      output = {
        answers: Object.fromEntries(
          Object.entries(questions).map(([key, question]) => [
            key,
            { type: 'choice', choice: key.endsWith('_fit') ? 'reference' : Object.keys(question.criteria)[0] },
          ]),
        ),
      };
    }
    return Response.json(
      { model: 'local-gateway-model', choices: [{ message: { content: JSON.stringify(output) } }], usage: { total_tokens: 20 } },
      { headers: { 'x-gateway-model': 'local-gateway-model', 'x-gateway-provider': 'local-fixture' } },
    );
  });
  fixture.env.FREE_AI = { run: vi.fn(), fetch: gateway };
  const app = createApp({
    makeRepository: () => fixture.repo,
    embed: async (_env, texts, options) => texts.map(() => Array(options?.dimensions ?? 768).fill(0.1)),
  });
  const headers = { Authorization: 'Bearer local-key', 'Content-Type': 'application/json' };
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers, body: JSON.stringify(body) }, fixture.env);
  return { ...fixture, app, headers, post, gateway, gatewayRequests };
}

describe('catalog intelligence HTTP contract with isolated SQLite', () => {
  it('completes ingest, citation retrieval, enrichment, decide and compare with Jev disabled', async () => {
    const fixture = await apiFixture();
    const { post, app, headers, env, sqlite } = fixture;
    const response = await post('/v1/indexes/catalog/ingest', {
      documents: [
        {
          external_id: 'project:1:source',
          content: 'Project supports repository discovery and requires source citations.',
          metadata: { kind: 'project_context', visibility: 'public', schema_version: 1, source_revision: 'sha' },
        },
        {
          external_id: 'repo:2',
          content: 'Library supplies exact source citations for repository documents.',
          metadata: { kind: 'catalog_repo', visibility: 'public', schema_version: 1, source_revision: 'sha' },
        },
      ],
    });
    expect(response.status).toBe(201);
    const ingest = (await response.json()) as { documents: Array<{ document_id: string }> };
    const project = ingest.documents[0]!.document_id;
    const candidate = ingest.documents[1]!.document_id;
    const source = await app.request(`/v1/documents/${project}`, { headers }, env);
    expect(source.status).toBe(200);
    expect(await source.json()).toMatchObject({ document: { id: project }, chunks: [{ metadata: { file_id: project, page_start: 1 } }] });
    const enriched = await post('/v1/indexes/catalog/enrich', { document_ids: [project], subject_id: 'project:1', source_revision: 'sha' });
    expect(enriched.status).toBe(200);
    expect(await enriched.json()).toMatchObject({
      schema_version: 1,
      profile: { purpose: 'Repository source citations.' },
      needs: [],
      validation: { source_quotes_validated: true, human_validated: false },
    });
    const input = {
      question: 'Find useful repository citation capabilities.',
      context_document_ids: [project],
      candidates: [{ id: '2', document_ids: [candidate] }],
    };
    const decision = await post('/v1/indexes/catalog/decide', input);
    expect(decision.status).toBe(200);
    const decided = (await decision.json()) as JsonRecord;
    expect(decided).toMatchObject({
      status: 'ok',
      result: { items: [{ candidate_id: '2', verdict: 'reference' }] },
      coverage: { candidates: 1, omitted_candidates: 0 },
    });
    const comparison = await post('/v1/indexes/catalog/compare', input);
    expect(comparison.status).toBe(200);
    const compared = (await comparison.json()) as JsonRecord;
    expect(compared).toMatchObject({
      engines: { free_ai: { status: 'ok' }, jev: { status: 'disabled' } },
      agreement: { comparable: false },
      input_hash: decided.input_hash,
    });
    const stored = await app.request(`/v1/indexes/catalog/decisions/${compared.comparison_id}`, { headers }, env);
    expect(stored.status).toBe(200);
    const persisted = (await stored.json()) as { frozen_input: { state: JsonRecord; questions: JsonRecord } };
    expect(fixture.gatewayRequests[1]).toEqual(fixture.gatewayRequests[2]);
    expect(fixture.gatewayRequests[2]).toEqual({ state: persisted.frozen_input.state, questions: persisted.frozen_input.questions });
    expect(env.AI.run).not.toHaveBeenCalled();
    sqlite.close();
  });

  it('surfaces malformed inputs and cross-index evidence before inference', async () => {
    const { post, gateway, sqlite } = await apiFixture();
    expect((await post('/v1/indexes/catalog/enrich', null)).status).toBe(400);
    expect((await post('/v1/indexes/catalog/decide', { question: 'q', context_document_ids: [], candidates: [] })).status).toBe(400);
    expect(
      (await post('/v1/indexes/catalog/compare', { question: 'q', context_document_ids: ['missing'], candidates: [{ id: '1', document_ids: ['missing'] }] }))
        .status,
    ).toBe(404);
    expect((await post('/v1/embeddings', { input: ['source'], dimensions: 384, model: '@cf/baai/bge-base-en-v1.5' })).status).toBe(400);
    expect(gateway).not.toHaveBeenCalled();
    sqlite.close();
  });

  it('preserves explicit model validation errors without a successful fallback', async () => {
    const { repo, post, gateway, sqlite } = await apiFixture();
    const document = {
      id: 'source',
      tenant: 'tenant-a',
      indexId: 'catalog',
      externalId: 'repo:1',
      content: 'Source citation capability.',
      metadata: { kind: 'catalog_repo', visibility: 'public' },
    };
    await repo.publishDocumentSnapshot(
      document,
      [{ id: 'chunk', tenant: 'tenant-a', indexId: 'catalog', documentId: 'source', content: document.content, metadata: document.metadata, chunkIndex: 0 }],
      null,
    );
    gateway.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"facts":[]}' } }] }));
    const enriched = await post('/v1/indexes/catalog/enrich', { document_ids: ['source'], subject_id: 'repo:1' });
    expect(enriched.status).toBe(502);
    expect(await enriched.json()).toMatchObject({ error: 'Source-grounded enrichment failed', engine: { status: 'error' } });
    gateway.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"answers":{}}' } }] }));
    const decision = await post('/v1/indexes/catalog/decide', {
      question: 'Fit?',
      context_document_ids: ['source'],
      candidates: [{ id: '1', document_ids: ['source'] }],
    });
    expect(decision.status).toBe(200);
    expect(await decision.json()).toMatchObject({ status: 'error', error: 'Decision answer ids do not match frozen questions' });
    sqlite.close();
  });
});
