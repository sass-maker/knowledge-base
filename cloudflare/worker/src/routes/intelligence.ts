import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { jsonRecord } from '../app-utils';
import type { Variables } from '../auth';
import { type EnrichInput, enrichCatalog } from '../catalog-enrichment';
import { contentHash } from '../catalog-ingest';
import { compareKnowledgeDecisions, runKnowledgeDecision } from '../gateway-decisions';
import { freezeDecision } from '../decision-evidence';
import { prepareOperationComparison } from '../operation-comparison';
import type { DecisionEngineResult, DecisionInput, FrozenDecision } from '../decision-types';
import { readRequestJson } from '../request-json';
import type { AppRuntime } from '../runtime';
import type { Env } from '../types';

type App = Hono<{ Bindings: Env; Variables: Variables }>;

async function requireDecisionStorage(env: Env) {
  if (!(await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kb_decision_runs'").first())) {
    throw new HTTPException(503, { message: 'Decision storage migration 0011 is required' });
  }
}

async function storeDecision(env: Env, tenant: string, indexId: string, frozen: FrozenDecision, engines: Record<string, DecisionEngineResult>) {
  const id = crypto.randomUUID();
  const hash = await contentHash(frozen);
  await env.DB.prepare('INSERT INTO kb_decision_runs(id,tenant,index_id,input_hash,frozen_input,engines) VALUES(?,?,?,?,?,?)')
    .bind(id, tenant, indexId, hash, JSON.stringify(frozen), JSON.stringify(engines))
    .run();
  return { id, hash };
}

function agreement(baseline: DecisionEngineResult, candidate: DecisionEngineResult) {
  if (baseline.status !== 'ok' || candidate.status !== 'ok' || !baseline.result || !candidate.result)
    return { comparable: false, reason: 'Both engines must produce validated results' };
  const left = baseline.result.items;
  const right = new Map(candidate.result.items.map((item) => [item.candidate_id, item]));
  const matches = left.filter((item) => right.get(item.candidate_id)?.verdict === item.verdict).length;
  return {
    comparable: true,
    candidates: left.length,
    matching_verdicts: matches,
    rate: matches / left.length,
    differences: left
      .filter((item) => right.get(item.candidate_id)?.verdict !== item.verdict)
      .map((item) => ({ candidate_id: item.candidate_id, free_ai: item.verdict, jev: right.get(item.candidate_id)?.verdict })),
  };
}

export function registerIntelligenceRoutes(app: App, rt: AppRuntime): void {
  app.post('/v1/embeddings', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const body = jsonRecord(await readRequestJson(c.req.raw, 250000));
    const input = body.input;
    const model = '@cf/baai/bge-base-en-v1.5';
    if (
      body.model !== model ||
      body.dimensions !== 768 ||
      !Array.isArray(input) ||
      !input.length ||
      input.length > 100 ||
      input.some((value) => typeof value !== 'string' || !value.trim() || value.length > 10000)
    ) {
      return c.json({ error: 'Expected 1–100 texts, BGE base model, and dimensions 768' }, 400);
    }
    const data = await rt.embed(c.env, input as string[], { model, dimensions: 768 });
    if (data.length !== input.length || data.some((row) => row.length !== 768 || row.some((value) => !Number.isFinite(value))))
      throw new Error('Embedding response violates dimension contract');
    return c.json({ data, model, dimensions: 768 });
  });

  app.post('/v1/indexes/:id/enrich', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const body = jsonRecord(await readRequestJson(c.req.raw, 100000)) as unknown as EnrichInput;
    const tenant = c.get('tenant');
    const repo = rt.makeRepository(c.env);
    const indexId = c.req.param('id');
    if (!(await repo.getIndex(tenant, indexId))) return c.json({ error: 'Index not found' }, 404);
    try {
      return c.json(await enrichCatalog(c.env, repo, tenant, indexId, body));
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      console.error('knowledgebase enrichment failed', { index_id: indexId, subject_id: body.subject_id, error: String(error) });
      return c.json({ error: 'Source-grounded enrichment failed', detail: String(error), engine: { status: 'error', requested_model: 'auto' } }, 502);
    }
  });

  app.post('/v1/indexes/:id/decide', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const body = jsonRecord(await readRequestJson(c.req.raw, 100000)) as unknown as DecisionInput;
    if (body.engine !== undefined && body.engine !== 'free_ai' && body.engine !== 'jev') return c.json({ error: 'Unknown decision engine' }, 400);
    const tenant = c.get('tenant');
    const indexId = c.req.param('id');
    const repo = rt.makeRepository(c.env);
    if (!(await repo.getIndex(tenant, indexId))) return c.json({ error: 'Index not found' }, 404);
    await requireDecisionStorage(c.env);
    const frozen = await prepareOperationComparison(c.env, await freezeDecision(repo, tenant, indexId, body));
    const engineName = body.engine ?? 'free_ai';
    const engine = await runKnowledgeDecision(c.env, frozen, engineName);
    const stored = await storeDecision(c.env, tenant, indexId, frozen, { [engineName]: engine });
    return c.json({ decision_id: stored.id, input_hash: stored.hash, coverage: frozen.coverage, ...engine });
  });

  app.post('/v1/indexes/:id/compare', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const body = jsonRecord(await readRequestJson(c.req.raw, 100000)) as unknown as DecisionInput;
    const tenant = c.get('tenant');
    const indexId = c.req.param('id');
    const repo = rt.makeRepository(c.env);
    if (!(await repo.getIndex(tenant, indexId))) return c.json({ error: 'Index not found' }, 404);
    await requireDecisionStorage(c.env);
    const frozen = await prepareOperationComparison(c.env, await freezeDecision(repo, tenant, indexId, body));
    const engines = await compareKnowledgeDecisions(c.env, frozen);
    const stored = await storeDecision(c.env, tenant, indexId, frozen, engines);
    return c.json({
      comparison_id: stored.id,
      input_hash: stored.hash,
      coverage: frozen.coverage,
      engines,
      agreement: agreement(engines.free_ai, engines.jev),
    });
  });

  app.get('/v1/indexes/:id/decisions/:decision_id', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const row = await c.env.DB.prepare('SELECT * FROM kb_decision_runs WHERE tenant=? AND index_id=? AND id=?')
      .bind(c.get('tenant'), c.req.param('id'), c.req.param('decision_id'))
      .first<{ frozen_input: string; engines: string }>();
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({ ...row, frozen_input: jsonRecord(JSON.parse(row.frozen_input)), engines: jsonRecord(JSON.parse(row.engines)) });
  });
}
