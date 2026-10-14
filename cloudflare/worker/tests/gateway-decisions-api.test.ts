import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { createApp } from '../src/index';
import { freezeDecision } from '../src/decision-evidence';
import { compareKnowledgeDecisions } from '../src/gateway-decisions';
import { catalogFixture, createCatalogIndex, sourceChunk, sourceDocument } from './catalog-fixture';
import type { JsonRecord } from '../src/types';

interface TypedInput {
  state: JsonRecord;
  questions: Array<{ id: string; type: string; prompt: string; options: string[] }>;
  project_id: string;
  engine?: string;
  engines?: Array<{ engine: string; model?: string }>;
}

const contract = JSON.parse(readFileSync(new NodeURL('../fixtures/decision-gateway-contract.json', import.meta.url), 'utf8')) as {
  request: TypedInput;
  input_hash: string;
  numeric_request: TypedInput;
  numeric_input_hash: string;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as JsonRecord;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function result(input: TypedInput, engine = 'free_ai'): JsonRecord {
  const hash = createHash('sha256')
    .update(canonical({ state: input.state, questions: input.questions }))
    .digest('hex');
  const common = { project_id: 'knowledge-base', input_hash: hash, engine, latency_ms: 12, usage: null };
  if (engine === 'jev')
    return {
      ...common,
      status: 'unavailable',
      requested_model: 'typesafe/jev',
      model: null,
      provider: null,
      answers: [],
      error: { code: 'provider_disabled', message: 'Jev provider is disabled.' },
    };
  return {
    ...common,
    status: 'ok',
    requested_model: 'auto',
    model: 'actual-free-model',
    provider: 'fixture-free-provider',
    usage: { total_tokens: 35 },
    answers: input.questions.map((question) => ({
      id: question.id,
      status: 'answered',
      value: question.id.endsWith('_fit') ? 'reference' : question.options[0],
      reason: 'Unverified provider prose must not replace the source quote.',
    })),
  };
}

async function fixture() {
  const base = catalogFixture();
  await createCatalogIndex(base.repo);
  for (const document of [
    sourceDocument('project', 'Project requires source citations for repository recommendations.'),
    sourceDocument('candidate', 'Library provides source citations for repository documents.'),
  ])
    await base.repo.publishDocumentSnapshot(document, [sourceChunk(document)], null);
  base.env.RAG_SERVICE_KEYS = JSON.stringify({ 'local-key': 'tenant-a', 'other-key': 'tenant-b' });
  base.env.RAG_GATEWAY_DECISIONS_ENABLED = 'true';
  const calls: Array<{ path: string; body: TypedInput }> = [];
  const gateway = vi.fn(async (request: Request) => {
    const body = (await request.json()) as TypedInput;
    const path = new URL(request.url).pathname;
    calls.push({ path, body });
    const free = result(body);
    return Response.json(
      path === '/v1/compare' ? { project_id: 'knowledge-base', input_hash: free.input_hash, results: [result(body, 'jev'), free] } : result(body, body.engine),
    );
  });
  base.env.FREE_AI = { fetch: gateway, run: vi.fn() };
  const app = createApp({ makeRepository: () => base.repo });
  const input = {
    question: 'Find useful citation capabilities.',
    context_document_ids: ['project'],
    candidates: [{ id: 'repo:2', document_ids: ['candidate'] }],
  };
  const headers = { Authorization: 'Bearer local-key', 'Content-Type': 'application/json' };
  const post = async (path = 'compare', body: unknown = input) => {
    const response = await app.request(`/v1/indexes/catalog/${path}`, { method: 'POST', headers, body: JSON.stringify(body) }, base.env);
    return { response, body: (await response.json()) as JsonRecord };
  };
  return { ...base, app, post, input, calls, gateway, headers };
}

describe('shared decision gateway HTTP adapter', () => {
  it('sends one bounded comparison, preserves attribution and disabled Jev, and persists quote-derived evidence', async () => {
    const f = await fixture();
    f.env.RAG_JEV_ENABLED = 'true'; // The opt-in adapter must never invoke this legacy native provider.
    const { response, body } = await f.post();
    expect(response.status).toBe(200);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.body).toEqual(contract.request);
    expect(f.calls[0]).toMatchObject({
      path: '/v1/compare',
      body: {
        project_id: 'knowledge-base',
        engines: [{ engine: 'free_ai', model: 'auto' }, { engine: 'jev' }],
        limits: { max_cost_usd: 0, deadline_ms: 30000, max_output_tokens: 4096 },
      },
    });
    expect(body).toMatchObject({
      engines: {
        free_ai: {
          status: 'ok',
          requested_model: 'auto',
          resolved_model: 'actual-free-model',
          provider: 'fixture-free-provider',
          usage: { total_tokens: 35 },
          decision_backend: 'free_ai_decisions',
          result: {
            items: [
              {
                candidate_id: 'repo:2',
                reason: 'Project requires source citations for repository recommendations.',
                benefit: 'Library provides source citations for repository documents.',
              },
            ],
          },
        },
        jev: { status: 'disabled', error_code: 'provider_disabled', resolved_model: null, provider: null },
      },
      agreement: { comparable: false },
    });
    expect(JSON.stringify((body.engines as JsonRecord).free_ai)).toContain('Unverified provider prose'); // Raw output retained, not used as evidence.
    expect((body.engines as JsonRecord).free_ai).toMatchObject({ gateway_input_hash: contract.input_hash });
    const stored = await f.app.request(`/v1/indexes/catalog/decisions/${body.comparison_id}`, { headers: f.headers }, f.env);
    expect(stored.status).toBe(200);
    expect(await stored.json()).toMatchObject({ engines: body.engines, frozen_input: { source_document_ids: ['project', 'candidate'] } });
    const hidden = await f.app.request(`/v1/indexes/catalog/decisions/${body.comparison_id}`, { headers: { Authorization: 'Bearer other-key' } }, f.env);
    expect(hidden.status).toBe(404);
    expect(f.env.AI.run).not.toHaveBeenCalled();
    expect(f.budgetFetch).not.toHaveBeenCalled();
    f.sqlite.close();
  });

  it('maps choice identities and meanings without changing state between decide and compare', async () => {
    const f = await fixture();
    const single = await f.post('decide');
    const compared = await f.post();
    expect(single.body).toMatchObject({ status: 'ok', decision_backend: 'free_ai_decisions' });
    expect(f.calls.map((call) => call.path)).toEqual(['/v1/decide', '/v1/compare']);
    expect(f.calls[0]!.body.state).toEqual(f.calls[1]!.body.state);
    expect(f.calls[0]!.body.questions).toEqual(f.calls[1]!.body.questions);
    expect(f.calls[0]!.body.questions[0]).toMatchObject({ id: 'c1_fit', type: 'choice', options: ['reference', 'reject'] });
    expect(f.calls[0]!.body.questions[0]!.prompt).toContain('reference: Evidence supports a useful comparison');
    expect((compared.body.engines as JsonRecord).free_ai).toMatchObject({ gateway_input_hash: single.body.gateway_input_hash });
    f.sqlite.close();
  });

  it('keeps the production legacy chat path unless explicitly enabled', async () => {
    const f = await fixture();
    delete f.env.RAG_GATEWAY_DECISIONS_ENABLED;
    f.gateway.mockImplementation(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/v1/chat/completions');
      const body = (await request.json()) as { messages: Array<{ content: string }> };
      const frozen = JSON.parse(body.messages[1]!.content) as { questions: Record<string, { criteria: JsonRecord }> };
      const answers = Object.fromEntries(
        Object.entries(frozen.questions).map(([id, q]) => [id, { type: 'choice', choice: id.endsWith('_fit') ? 'reference' : Object.keys(q.criteria)[0] }]),
      );
      return Response.json({ model: 'legacy-model', provider: 'legacy-provider', choices: [{ message: { content: JSON.stringify({ answers }) } }] });
    });
    expect((await f.post()).body).toMatchObject({ engines: { free_ai: { status: 'ok', resolved_model: 'legacy-model' }, jev: { status: 'disabled' } } });
    expect(f.gateway).toHaveBeenCalledTimes(1);
    f.sqlite.close();
  });

  it('matches the shared canonical hash for integer-like state keys', async () => {
    const f = await fixture();
    const frozen = await freezeDecision(f.repo, 'tenant-a', 'catalog', f.input);
    frozen.state = contract.numeric_request.state;
    const compared = await compareKnowledgeDecisions(f.env, frozen);
    expect(f.calls[0]!.body).toEqual(contract.numeric_request);
    expect(compared.free_ai).toMatchObject({ status: 'ok', gateway_input_hash: contract.numeric_input_hash });
    f.sqlite.close();
  });

  it('sends a sole none option for short documents and never invents positive source evidence', async () => {
    const f = await fixture();
    for (const document of [sourceDocument('short-project', 'Hi.'), sourceDocument('short-candidate', 'Go.')])
      await f.repo.publishDocumentSnapshot(document, [sourceChunk(document)], null);
    const input = { question: 'Find fit.', context_document_ids: ['short-project'], candidates: [{ id: 'short', document_ids: ['short-candidate'] }] };
    f.gateway.mockImplementationOnce(async (request: Request) => {
      const body = (await request.json()) as TypedInput;
      expect(body.questions.filter((q) => !q.id.endsWith('_fit')).map((q) => q.options)).toEqual([['none'], ['none']]);
      const free = result(body);
      (free.answers as JsonRecord[])[0]!.value = 'reject';
      return Response.json(free);
    });
    expect((await f.post('decide', input)).body).toMatchObject({
      status: 'ok',
      result: { abstained: true, items: [{ verdict: 'reject', project_evidence: [], candidate_evidence: [] }] },
    });
    expect((await f.post('decide', input)).body).toMatchObject({ status: 'error', error_code: 'decision_validation_error' });
    expect(f.gateway).toHaveBeenCalledTimes(2);
    f.sqlite.close();
  });

  it.each(['compare', 'decide'])('rejects wrong project attribution from %s', async (path) => {
    const f = await fixture();
    f.gateway.mockImplementationOnce(async (request: Request) => {
      const input = (await request.json()) as TypedInput;
      const free = result(input);
      return Response.json(
        path === 'compare'
          ? { project_id: 'wrong-project', input_hash: free.input_hash, results: [free, result(input, 'jev')] }
          : { ...free, project_id: 'wrong-project' },
      );
    });
    const { body } = await f.post(path);
    const engine = path === 'compare' ? (body.engines as JsonRecord).free_ai : body;
    expect(engine).toMatchObject({ status: 'error', error: 'Gateway project attribution mismatch' });
    expect(engine).toMatchObject({ raw: null });
    expect(f.gateway).toHaveBeenCalledTimes(1);
    f.sqlite.close();
  });

  it.each([404, 429, 503])('surfaces gateway HTTP %s without retrying the legacy endpoint or native AI', async (status) => {
    const f = await fixture();
    f.gateway.mockResolvedValueOnce(new Response('Unavailable', { status }));
    const { body } = await f.post();
    expect(body).toMatchObject({
      engines: {
        free_ai: { status: 'error', error_code: 'gateway_contract_error', error: `Free AI typed decision request failed (${status})` },
        jev: { status: 'error' },
      },
    });
    expect(f.gateway).toHaveBeenCalledTimes(1);
    expect(f.env.AI.run).not.toHaveBeenCalled();
    f.sqlite.close();
  });

  it.each(['hash', 'engine', 'duplicate', 'missing', 'model', 'provider', 'option', 'quote', 'integration'])(
    'rejects invalid %s in a typed response with no replacement model run',
    async (kind) => {
      const f = await fixture();
      f.gateway.mockImplementationOnce(async (request: Request) => {
        const body = (await request.json()) as TypedInput;
        const free = result(body);
        const jev = result(body, 'jev');
        const answers = free.answers as JsonRecord[];
        if (kind === 'hash') free.input_hash = 'wrong';
        if (kind === 'engine') free.engine = 'jev';
        if (kind === 'duplicate') answers[1] = answers[0]!;
        if (kind === 'missing') answers.pop();
        if (kind === 'model') free.model = 'auto';
        if (kind === 'provider') free.provider = null;
        if (kind === 'option') answers[1]!.value = 'invented';
        if (kind === 'quote') answers[1]!.value = 'none';
        if (kind === 'integration') answers[0]!.value = 'integration';
        return Response.json({ project_id: 'knowledge-base', input_hash: free.input_hash, results: [free, jev] });
      });
      const { body } = await f.post();
      expect((body.engines as JsonRecord).free_ai).toMatchObject({ status: 'error' });
      expect((body.engines as JsonRecord).free_ai).not.toHaveProperty('result');
      expect(f.gateway).toHaveBeenCalledTimes(1);
      expect(f.env.AI.run).not.toHaveBeenCalled();
      f.sqlite.close();
    },
  );

  it('preserves an explicit provider error and usage without obscuring the disabled comparison', async () => {
    const f = await fixture();
    f.gateway.mockImplementationOnce(async (request: Request) => {
      const input = (await request.json()) as TypedInput;
      const free: JsonRecord = { ...result(input), status: 'error', answers: [], error: { code: 'budget_exhausted', message: 'Free allowance exhausted.' } };
      return Response.json({ project_id: 'knowledge-base', input_hash: free.input_hash, results: [free, result(input, 'jev')] });
    });
    expect((await f.post()).body).toMatchObject({
      engines: {
        free_ai: { status: 'error', error_code: 'budget_exhausted', usage: { total_tokens: 35 } },
        jev: { status: 'disabled', error_code: 'provider_disabled' },
      },
      agreement: { comparable: false },
    });
    expect(f.gateway).toHaveBeenCalledTimes(1);
    f.sqlite.close();
  });

  it('abstains safely when all typed answers abstain', async () => {
    const f = await fixture();
    f.gateway.mockImplementationOnce(async (request: Request) => {
      const body = (await request.json()) as TypedInput;
      const row = result(body);
      row.answers = body.questions.map((q) => ({ id: q.id, status: 'abstained', value: null, reason: 'Insufficient evidence.' }));
      return Response.json(row);
    });
    expect((await f.post('decide')).body).toMatchObject({
      status: 'ok',
      result: { abstained: true, items: [{ verdict: 'reject', project_evidence: [], candidate_evidence: [] }] },
    });
    f.sqlite.close();
  });

  it('bounds a stalled service binding without invoking another engine', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    try {
      f.gateway.mockImplementationOnce(() => new Promise<Response>(() => {}));
      const pending = f.post();
      await vi.waitFor(() => expect(f.gateway).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(30001);
      expect((await pending).body).toMatchObject({
        engines: { free_ai: { status: 'error', error: 'Free AI typed decision deadline exceeded (30 seconds)' }, jev: { status: 'error' } },
      });
      expect(f.env.AI.run).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      f.sqlite.close();
    }
  });

  it('accepts a bounded multi-engine response above 64KiB with all sixty question identities intact', async () => {
    const f = await fixture();
    const input = { ...f.input, candidates: Array.from({ length: 20 }, (_, n) => ({ id: `candidate:${n}`, document_ids: ['candidate'] })) };
    f.gateway.mockImplementationOnce(async (request: Request) => {
      const body = (await request.json()) as TypedInput;
      expect(body.questions).toHaveLength(60);
      expect(new TextEncoder().encode(canonical({ state: body.state, questions: body.questions })).byteLength).toBeLessThanOrEqual(32768);
      const free = result(body);
      (free.answers as JsonRecord[]).forEach((row) => {
        row.reason = 'x'.repeat(700);
      });
      const jev = { ...free, engine: 'jev', requested_model: 'typesafe/jev', model: 'typesafe/jev', provider: 'mock-jev-provider' };
      const payload = { project_id: 'knowledge-base', input_hash: free.input_hash, results: [free, jev] };
      expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBeGreaterThan(65536);
      return Response.json(payload);
    });
    const { body } = await f.post('compare', input);
    expect(body).toMatchObject({ engines: { free_ai: { status: 'ok' }, jev: { status: 'ok' } }, agreement: { comparable: true, candidates: 20, rate: 1 } });
    expect(f.gateway).toHaveBeenCalledTimes(1);
    expect(f.env.AI.run).not.toHaveBeenCalled();
    f.sqlite.close();
  });

  it('never labels another resolved model as a successful Jev decision', async () => {
    const f = await fixture();
    f.gateway.mockImplementationOnce(async (request: Request) => {
      const input = (await request.json()) as TypedInput;
      const free = result(input);
      const impostor = { ...free, engine: 'jev', requested_model: 'typesafe/jev' };
      return Response.json({ project_id: 'knowledge-base', input_hash: free.input_hash, results: [free, impostor] });
    });
    expect((await f.post()).body).toMatchObject({
      engines: { free_ai: { status: 'ok' }, jev: { status: 'error', error: 'Gateway Jev result resolved a different model', resolved_model: null } },
    });
    expect(f.gateway).toHaveBeenCalledTimes(1);
    expect(f.env.AI.run).not.toHaveBeenCalled();
    f.sqlite.close();
  });
});
