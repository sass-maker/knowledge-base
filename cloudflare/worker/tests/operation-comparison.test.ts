import { describe, expect, it, vi } from 'vitest';
import { freezeDecision } from '../src/decision-evidence';
import { validateDecisionAnswers } from '../src/decision-engine';
import { parseFeatureOperation } from '../src/feature-operation';
import { freezeOperationComparisons, prepareOperationComparison } from '../src/operation-comparison';
import type { Repository } from '../src/repository';
import type { Env } from '../src/types';

const operation = { input: 'Raw HTML', action: 'Extract article text', output: 'Readable article text', method: 'Readability', constraints: [], importance: 'core' as const };
const project = { document_id: 'project', chunk_id: 'project-chunk', excerpt: 'Extract readable article text from HTML with Readability.' };
const candidate = { document_id: 'candidate', chunk_id: 'candidate-chunk', excerpt: 'Main text extraction uses a rule-based extractor, with readability-lxml as a fallback.' };

async function fixture() {
  const refs = [project, candidate];
  const repo = {
    getDocument: async (_tenant: string, id: string) => ({ id, index_id: 'catalog', metadata: {} }),
    getChunkIdsForDocument: async (_tenant: string, id: string) => refs.filter((ref) => ref.document_id === id).map((ref) => ref.chunk_id),
    getChunksByIds: async (_tenant: string, ids: string[]) => refs.filter((ref) => ids.includes(ref.chunk_id)).map((ref) => ({ id: ref.chunk_id, document_id: ref.document_id, content: ref.excerpt })),
  } as unknown as Repository;
  const input = { question: 'Compare article extraction.', context_document_ids: ['project'], candidates: [{ id: '42', document_ids: ['candidate'], capability_evidence: [candidate] }], feature_evidence: [project], feature_description: project.excerpt, feature_operation: operation };
  return { repo, input, frozen: await freezeDecision(repo, 'tenant', 'catalog', input) };
}

const proposal = { c1: { supported: true, project_key: 'f1', candidate_key: 'k1', input: 'HTML pages', action: 'Extract main text', output: 'Article text', comparison_action: 'Compare article extraction on the same HTML fixtures.', differences: 'Python rules and fallbacks versus JavaScript Readability.' } };

describe('operation comparisons', () => {
  it('keeps the core operation and protects exact candidate capability evidence', async () => {
    const { frozen } = await fixture();
    expect(frozen.state.target_operation).toEqual(operation);
    expect(frozen.candidates[0]!.candidate_options.k1).toEqual(candidate);
  });
  it('prepares a cross-runtime comparison, then asks only for usefulness', async () => {
    const prepared = freezeOperationComparisons((await fixture()).frozen, proposal);
    expect(Object.keys(prepared.questions)).toEqual(['c1_utility']);
    const result = validateDecisionAnswers(prepared, { c1_utility: { type: 'choice', choice: 'high' } });
    expect(result.items[0]).toMatchObject({ verdict: 'reference', utility: 'high', comparison: { action: proposal.c1.comparison_action }, project_evidence: [project], candidate_evidence: [candidate] });
    expect(validateDecisionAnswers(prepared, { c1_utility: { type: 'choice', choice: 'low' } }).abstained).toBe(true);
  });
  it('does not let unsupported comparisons become recommendations', async () => {
    const prepared = freezeOperationComparisons((await fixture()).frozen, { c1: { supported: false, project_key: 'none', candidate_key: 'none' } });
    expect(prepared.questions.c1_utility!.criteria).toEqual({ reject: expect.any(String) });
    expect(validateDecisionAnswers(prepared, { c1_utility: { type: 'choice', choice: 'reject' } }).abstained).toBe(true);
    expect(() => validateDecisionAnswers(prepared, { c1_utility: { type: 'choice', choice: 'high' } })).toThrow('Invalid choice');
  });
  it.each([
    { c1: { ...proposal.c1, project_key: 'e1' } },
    { c1: { ...proposal.c1, candidate_key: 'made-up' } },
    { c1: { ...proposal.c1, comparison_action: '' } },
    { c1: { ...proposal.c1, differences: 'x'.repeat(141) } },
    { c2: proposal.c1 },
  ])('rejects malformed or uncited proposals: %j', async (payload) => {
    const { frozen } = await fixture();
    expect(() => freezeOperationComparisons(frozen, payload)).toThrow();
  });
  it('rejects candidate proof borrowed from the project', async () => {
    const { repo, input } = await fixture();
    await expect(freezeDecision(repo, 'tenant', 'catalog', { ...input, candidates: [{ ...input.candidates[0]!, capability_evidence: [project] }] })).rejects.toMatchObject({ status: 400 });
  });
  it.each([{ ...operation, input: '' }, { ...operation, action: 'x'.repeat(101) }, { ...operation, constraints: ['x'.repeat(101)] }, { ...operation, importance: 'unknown' }])('rejects invalid operation structures', (value) => {
    expect(() => parseFeatureOperation(value)).toThrow();
  });
  it('performs a separate gateway preparation call with project attribution', async () => {
    const { frozen } = await fixture();
    const fetch = vi.fn(async (request: Request) => {
      const body = await request.json() as { project_id: string; model: string; response_format: { type: string } };
      expect(body).toMatchObject({ project_id: 'knowledge-base', model: 'auto', response_format: { type: 'json_schema' } });
      return Response.json({ model: 'local', choices: [{ message: { content: JSON.stringify(proposal) } }] });
    });
    const prepared = await prepareOperationComparison({ FREE_AI: { fetch } } as unknown as Env, frozen);
    expect(fetch).toHaveBeenCalledOnce();
    expect(prepared.state.comparison_preparation).toMatchObject({ model: 'local', human_validated: false });
  });
});
