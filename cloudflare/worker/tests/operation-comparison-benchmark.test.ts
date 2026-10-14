import { describe, expect, it, vi } from 'vitest';
import { corpus, corpusHash, developmentInputs, evaluate, verifyCorpus } from '../../../experiments/operation-comparison/evaluate.mjs';
import { freezeDecision } from '../src/decision-evidence';
import { gatewayDecision, runDecisionEngine, validateDecisionAnswers } from '../src/decision-engine';
import { freezeOperationComparisons, prepareOperationComparison } from '../src/operation-comparison';
import type { Repository } from '../src/repository';
import type { Env } from '../src/types';

async function frozenCase(row = developmentInputs()[0]) {
  const refs = [
    { document_id: 'project', chunk_id: 'project-chunk', excerpt: row.project.excerpt },
    { document_id: 'candidate', chunk_id: 'candidate-chunk', excerpt: row.candidate.excerpt },
  ];
  const repo = {
    getDocument: async (_tenant: string, id: string) => ({ id, index_id: 'public-benchmark', metadata: {} }),
    getChunkIdsForDocument: async (_tenant: string, id: string) => refs.filter((ref) => ref.document_id === id).map((ref) => ref.chunk_id),
    getChunksByIds: async (_tenant: string, ids: string[]) =>
      refs.filter((ref) => ids.includes(ref.chunk_id)).map((ref) => ({ id: ref.chunk_id, document_id: ref.document_id, content: ref.excerpt })),
  } as unknown as Repository;
  return freezeDecision(repo, 'public-fixture', 'public-benchmark', {
    question: row.user_problem,
    context_document_ids: ['project'],
    candidates: [{ id: row.id, document_ids: ['candidate'], capability_evidence: [refs[1]!] }],
    feature_evidence: [refs[0]!],
    feature_description: row.user_problem,
    feature_operation: row.operation,
  });
}

// Deliberately adversarial contract data, never a recorded model observation.
const invented = {
  c1: {
    supported: true,
    project_key: 'f1',
    candidate_key: 'k1',
    input: 'HTML',
    action: 'Extract text',
    output: 'Text',
    shared_input: 'HTML',
    shared_action: 'Extract text',
    shared_output: 'Text',
    project_method: 'Invented perfect extraction',
    candidate_method: 'Invented perfect extraction',
  },
};

describe('frozen public operation experiment contracts (not live quality)', () => {
  it('freezes source digests and keeps labels/held-out cases out of preparation inputs', () => {
    verifyCorpus();
    expect(corpus.cases.filter((row: { split: string }) => row.split === 'held_out')).toHaveLength(3);
    expect(developmentInputs()).toHaveLength(5);
    expect(JSON.stringify(developmentInputs())).not.toContain('provisional_label');
    expect(evaluate(null)).toMatchObject({ evaluated_cases: 0, false_positives: null, false_negatives: null, cache_reuse: null });
  });
  for (const row of developmentInputs())
    it(`preserves literal candidate ownership and partial input for ${row.id}`, async () => {
      const frozen = await frozenCase(row);
      expect(frozen.candidates[0]!.candidate_options.k1!.excerpt).toBe(row.candidate.excerpt);
      expect(frozen.coverage.candidates).toBe(1);
      expect(frozen.coverage.omitted_candidates).toBe(0);
      expect(frozen.coverage.packed_bytes).toBeLessThanOrEqual(24000);
    });
  it('demonstrates that valid citation IDs do not establish semantic entailment', async () => {
    const prepared = freezeOperationComparisons(await frozenCase(), invented);
    const decision = validateDecisionAnswers(prepared, { c1_utility: { type: 'choice', choice: 'high' } });
    expect(decision.items[0]!.benefit).toContain('Invented perfect extraction');
    expect(decision.items[0]!.candidate_evidence[0]!.excerpt).not.toContain('Invented perfect extraction');
    // Explicitly record this limitation rather than representing IDs as a semantic guard.
  });
  it('makes unavailable preparation explicit without another provider', async () => {
    await expect(prepareOperationComparison({} as Env, await frozenCase())).rejects.toThrow('gateway binding is unavailable');
  });
  it.each([429, 503])('does not retry preparation or usefulness on HTTP %s', async (status) => {
    const fetch = vi.fn(async () => new Response('Unavailable', { status }));
    const env = { FREE_AI: { fetch } } as unknown as Env;
    const frozen = await frozenCase();
    await expect(prepareOperationComparison(env, frozen)).rejects.toThrow(`(${status})`);
    const result = await runDecisionEngine(env, frozen, 'free_ai');
    expect(result).toMatchObject({ status: 'error', error: `Free AI decision request failed (${status})` });
    expect(fetch).toHaveBeenCalledTimes(2); // one per independently invoked stage, no retries
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });
  it.each(['fetch', 'body'])('bounds stalled %s even when a binding ignores abort', async (stage) => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(() => (stage === 'fetch' ? new Promise<Response>(() => {}) : Promise.resolve(new Response(new ReadableStream({ start() {} })))));
      const pending = gatewayDecision({ FREE_AI: { fetch } } as unknown as Env, {});
      const rejected = expect(pending).rejects.toThrow('deadline exceeded');
      await vi.advanceTimersByTimeAsync(30001);
      await rejected;
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it('reports each metric separately and excludes ambiguous cases from FP/FN', () => {
    const attribution = { project_id: 'knowledge-base', requested_model: 'auto', model: 'fixture-only', provider: 'fixture-only' };
    const observations = {
      mode: 'live_free_ai',
      corpus_sha256: corpusHash,
      rows: [
        { ...attribution, id: 'article-method-difference', status: 'ok', useful: false, latency_ms: 20, cache_hit: false },
        { ...attribution, id: 'generic-html', status: 'ok', useful: true, latency_ms: 10 },
        { ...attribution, id: 'partial-retrieval', status: 'ok', useful: true, latency_ms: 30 },
        { id: 'same-library', status: 'rate_limited', latency_ms: 5 },
      ],
    };
    expect(evaluate(observations)).toMatchObject({
      false_positives: ['generic-html'],
      false_negatives: ['article-method-difference'],
      ambiguous: ['partial-retrieval'],
      gateway_429: 1,
      citation_existence: { exact: 0, checked: 3 },
      cache_reuse: { explicitly_observed_hits: 0, known: 1 },
    });
    expect(() => evaluate({ ...observations, mode: 'synthetic' })).toThrow();
    expect(() => evaluate({ ...observations, corpus_sha256: 'changed' })).toThrow();
    expect(() => evaluate({ ...observations, rows: [{ id: 'metadata-overlap', status: 'ok', useful: true }] })).toThrow();
  });
});
