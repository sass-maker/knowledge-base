import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDecisionEngine } from '../src/decision-engine';
import { freezeDecision, validateEvidence } from '../src/decision-evidence';
import { enrichCatalog } from '../src/catalog-enrichment';
import { catalogFixture, createCatalogIndex, sourceChunk, sourceDocument } from './catalog-fixture';
import type { Env } from '../src/types';

afterEach(() => vi.useRealTimers());
async function decisionFixture(count = 1) {
  const fixture = catalogFixture();
  await createCatalogIndex(fixture.repo);
  const context = sourceDocument(
    'context',
    'TODO: add source citations for repository recommendations. ' + 'Project supports repository discovery. '.repeat(15),
  );
  await fixture.repo.publishDocumentSnapshot(context, [sourceChunk(context)], null);
  const candidates = [];
  for (let i = 0; i < count; i++) {
    const doc = sourceDocument(
      `candidate${i}`,
      Array.from(
        { length: 7 },
        (_, n) => `Candidate ${i} capability ${n} supports repository citations and evidence. ${'Detailed compatibility description '.repeat(9)}`,
      ).join('\n'),
    );
    await fixture.repo.publishDocumentSnapshot(doc, [sourceChunk(doc)], null);
    candidates.push({ id: String(i), document_ids: [doc.id] });
  }
  return {
    ...fixture,
    input: { question: 'Which candidates provide relevant repository source citations?', context_document_ids: [context.id], candidates },
    context,
  };
}
function answers(frozen: Awaited<ReturnType<typeof freezeDecision>>, verdict = 'reference') {
  return Object.fromEntries(
    Object.keys(frozen.questions).map((key) => [
      key,
      { type: 'choice', choice: key.endsWith('_fit') ? verdict : Object.keys(frozen.questions[key]!.criteria)[0] },
    ]),
  );
}

describe('source-grounded decisions', () => {
  it('packs every candidate within the shared model budget and retains exact evidence', async () => {
    const { repo, sqlite, input } = await decisionFixture(20);
    const frozen = await freezeDecision(repo, 'tenant-a', 'catalog', input);
    expect(frozen.candidates).toHaveLength(20);
    expect(frozen.coverage.omitted_candidates).toBe(0);
    expect(frozen.coverage.packed_bytes).toBeLessThanOrEqual(24000);
    expect(frozen.questions).toHaveProperty('c20_candidate');
    for (const candidate of frozen.candidates)
      for (const ref of Object.values(candidate.candidate_options))
        expect(
          (await repo.getDocumentChunks('tenant-a', ref.document_id)).some((chunk) => chunk.id === ref.chunk_id && chunk.content.includes(ref.excerpt)),
        ).toBe(true);
    sqlite.close();
  });

  it('requires current scoped indexed source evidence and exact quotations', async () => {
    const { repo, sqlite, input, context } = await decisionFixture();
    await expect(freezeDecision(repo, 'tenant-b', 'catalog', input)).rejects.toMatchObject({ status: 404 });
    await expect(
      freezeDecision(repo, 'tenant-a', 'catalog', {
        ...input,
        explicit_gaps: [{ document_id: context.id, chunk_id: `chunk:${context.id}`, excerpt: 'Invented gap' }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    const replacement = sourceDocument('context-new', 'New project state.', { externalId: context.externalId });
    await repo.publishDocumentSnapshot(replacement, [sourceChunk(replacement)], context.id);
    await expect(freezeDecision(repo, 'tenant-a', 'catalog', input)).rejects.toMatchObject({ status: 409 });
    sqlite.close();
  });

  it('keeps Jev disabled without paid-model approval and validates gateway decisions', async () => {
    const { env, repo, sqlite, input } = await decisionFixture();
    const frozen = await freezeDecision(repo, 'tenant-a', 'catalog', input);
    env.FREE_AI = {
      run: vi.fn(),
      fetch: vi.fn(async () =>
        Response.json(
          { choices: [{ message: { content: JSON.stringify({ answers: answers(frozen) }) } }], usage: { total_tokens: 17 } },
          { headers: { 'x-gateway-model': 'resolved-local-model', 'x-gateway-provider': 'local-fixture' } },
        ),
      ),
    };
    expect((await runDecisionEngine(env, frozen, 'jev')).status).toBe('disabled');
    expect(env.AI.run).not.toHaveBeenCalled();
    const result = await runDecisionEngine(env, frozen, 'free_ai');
    expect(result).toMatchObject({ status: 'ok', resolved_model: 'resolved-local-model', provider: 'local-fixture', usage: { total_tokens: 17 } });
    expect(result.result?.items[0]?.reason).toBe(result.result?.items[0]?.project_evidence[0]?.excerpt);
    sqlite.close();
  });

  it('rejects unsupported positive choices and malformed telemetry without fallback', async () => {
    const { env, repo, sqlite, input } = await decisionFixture();
    const frozen = await freezeDecision(repo, 'tenant-a', 'catalog', input);
    const rows = answers(frozen);
    rows.c1_project = { type: 'choice', choice: 'none' };
    env.RAG_JEV_ENABLED = 'true';
    env.AI = { run: vi.fn(async () => ({ answers: rows, model: 'mock-jev', usage: {} })) } as unknown as Env['AI'];
    expect((await runDecisionEngine(env, frozen, 'jev')).status).toBe('error');
    const confidence = { ...answers(frozen), c1_fit: { type: 'choice', choice: 'reference', confidence: Number.NaN } };
    vi.mocked(env.AI.run).mockResolvedValueOnce({ answers: confidence });
    expect((await runDecisionEngine(env, frozen, 'jev')).status).toBe('error');
    const probabilities = { ...answers(frozen), c1_fit: { type: 'choice', choice: 'reference', probabilities: [] } };
    vi.mocked(env.AI.run).mockResolvedValueOnce({ answers: probabilities });
    expect((await runDecisionEngine(env, frozen, 'jev')).status).toBe('error');
    sqlite.close();
  });

  it('terminates a mocked native Jev call at the deadline without fallback', async () => {
    const { env, repo, sqlite, input } = await decisionFixture();
    const frozen = await freezeDecision(repo, 'tenant-a', 'catalog', input);
    vi.useFakeTimers();
    env.RAG_JEV_ENABLED = 'true';
    env.AI = { run: vi.fn(() => new Promise(() => {})) } as unknown as Env['AI'];
    const pending = runDecisionEngine(env, frozen, 'jev');
    await vi.advanceTimersByTimeAsync(30001);
    expect(await pending).toMatchObject({ status: 'error', error: 'Jev decision deadline exceeded (30 seconds)' });
    sqlite.close();
  });

  it('extracts only explicitly documented needs with allowed taxonomy in one mocked call', async () => {
    const { env, repo, sqlite, context } = await decisionFixture();
    const chunks = await repo.getDocumentChunks('tenant-a', context.id);
    const evidence = validateEvidence(
      { document_id: context.id, chunk_id: `chunk:${context.id}`, excerpt: 'TODO: add source citations for repository recommendations.' },
      chunks,
    );
    const fetch = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                facts: [{ field: 'purpose', value: 'Repository discovery.', evidence: [evidence] }],
                inferences: [],
                needs: [{ title: 'Source citations', desired_outcome: 'Attach source citations.', constraints: [], evidence: [evidence] }],
                taxonomy: { category: 'Developer tools', subcategories: [], keywords: ['citations'] },
              }),
            },
          },
        ],
      }),
    );
    env.FREE_AI = { run: vi.fn(), fetch };
    const result = await enrichCatalog(env, repo, 'tenant-a', 'catalog', {
      document_ids: [context.id],
      subject_id: 'project:1',
      classification: { categories: ['Developer tools'] },
    });
    expect(result.needs).toHaveLength(1);
    expect(result.taxonomy?.category).toBe('Developer tools');
    expect(result.validation.human_validated).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    sqlite.close();
  });
});
