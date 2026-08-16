import type { Hono } from 'hono';
import type { Variables } from '../auth';
import type { Env } from '../types';
import type { AppRuntime } from '../runtime';
import {
  type KbQueryBody,
  type KbSearchBody,
  type KbSessionBody,
  type QueryBody,
} from '../app-types';
import { answerQualityDrilldown, clampTopK, compareTraces, contextWithIndex, sseEvent, timingStages, traceExportSummary, withTimingHeaders } from '../query';
import type { JsonRecord } from '../types';

type App = Hono<{ Bindings: Env; Variables: Variables }>;

export function registerSearchRoutes(app: App, rt: AppRuntime): void {
  const {
    makeRepository,
    makeMetadataRepository,
    embed,
    queryCache,
    answerCache,
    embeddingCache,
    indexCache,
    indexRecordCache,
    kbDomainIndexCache,
    lexicalChunkCache,
    clearAnswerAndQueryCaches,
    rememberIndex,
    rememberIndexRecord,
    rememberKbDomainIndexRecord,
    getKbDomainIndex,
    getIndexRecord,
    indexExists,
    embedOne,
    rerankWithWorkersAi,
    rerankQueryPayload,
    getSharedQueryCache,
    setSharedQueryCache,
    clearSharedQueryCache,
    getSharedEmbeddingCache,
    setSharedEmbeddingCache,
    clearKbDomainCaches,
    deleteKbFiles,
    relationshipsWithEntityNames,
    persistSharedQueryCache,
    getCachedLexicalChunks,
    clearLexicalChunkCache,
    primeLexicalChunkCache,
    runTextQuery,
    kbDomainCreateIndexBody,
    resolveKbDomainEmbeddingSelection,
    persistKbDomainEmbeddingSelection,
    applyKbDomainEmbeddingSelection,
    formEmbeddingSelection,
    ensureKbIndex,
    validateKbIndexReadiness,
    validateKbSchedulingReadiness,
    upsertChunkVectors,
    ingestDocumentsToIndex,
    runKbIngest,
    runKbAnswer,
    queryByVector,
    queryByLexical,
    queryByLexicalPlan,
  } = rt;

app.post('/v1/kb/search', async (c) => {
  const started = performance.now();
  const body = (await c.req.json().catch(() => ({}))) as KbSearchBody;
  const domain = body.domain?.trim();
  const query = body.query?.trim();
  if (!domain) return c.json({ error: 'domain is required' }, 400);
  if (!query) return c.json({ error: 'query is required' }, 400);
  const tenant = c.get('tenant');
  const repo = makeRepository(c.env);
  const index = await getKbDomainIndex(c.env, repo, tenant, domain);
  if (!index) return c.json({ error: 'domain index not found' }, 404);
  const queryBody: QueryBody = {};
  if (body.top_k !== undefined) queryBody.top_k = body.top_k;
  if (body.mode !== undefined) queryBody.mode = body.mode;
  if (body.min_score !== undefined) queryBody.min_score = body.min_score;
  if (body.semantic_model !== undefined) queryBody.semantic_model = body.semantic_model;
  if (body.rerank !== undefined) queryBody.rerank = body.rerank;
  if (body.rerank_model !== undefined) queryBody.rerank_model = body.rerank_model;
  if (body.mmr !== undefined) queryBody.mmr = body.mmr;
  if (body.query_rewrite !== undefined) queryBody.query_rewrite = body.query_rewrite;
  if (body.query_decompose !== undefined) queryBody.query_decompose = body.query_decompose;
  const result = await runTextQuery(contextWithIndex(c, index.id), query, queryBody);
  return c.json(
    {
      project: tenant,
      domain,
      index_id: index.id,
      ...result.payload,
    },
    200,
    withTimingHeaders(result.timing, result.cache, started),
  );
});

app.post('/v1/kb/query', async (c) => {
  const started = performance.now();
  const body = (await c.req.json().catch(() => ({}))) as KbQueryBody;
  const domain = body.domain?.trim();
  const question = (body.question ?? body.query)?.trim();
  if (!domain) return c.json({ error: 'domain is required' }, 400);
  if (!question) return c.json({ error: 'question is required' }, 400);
  try {
    const result = await runKbAnswer(c, body, started);
    return c.json(result.payload, 200, withTimingHeaders(result.timing, result.cache, started));
  } catch (error) {
    if (error instanceof Error && error.message === 'domain index not found') {
      return c.json({ error: 'domain index not found' }, 404);
    }
    throw error;
  }
});

app.post('/v1/kb/query/stream', async (c) => {
  const started = performance.now();
  const body = (await c.req.json().catch(() => ({}))) as KbQueryBody;
  const domain = body.domain?.trim();
  const question = (body.question ?? body.query)?.trim();
  if (!domain) return c.json({ error: 'domain is required' }, 400);
  if (!question) return c.json({ error: 'question is required' }, 400);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        sseEvent('started', {
          project: c.get('tenant'),
          domain,
          question,
        }),
      );
      try {
        const result = await runKbAnswer(c, body, started);
        withTimingHeaders(result.timing, result.cache, started);
        for (const stage of timingStages(result.timing, result.payload)) {
          controller.enqueue(sseEvent('stage', stage));
        }
        controller.enqueue(sseEvent('answer', result.payload));
      } catch (error) {
        controller.enqueue(
          sseEvent('error', {
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
});

app.post('/v1/kb/sessions', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as KbSessionBody;
  const domain = body.domain?.trim();
  if (!domain) return c.json({ error: 'domain is required' }, 400);
  const id = body.id?.trim() || undefined;
  const metadataRepo = makeMetadataRepository(c.env);
  const session = await metadataRepo.createSession(c.get('tenant'), domain, id);
  return c.json(session, 201);
});

app.get('/v1/kb/sessions', async (c) => {
  const domain = c.req.query('domain')?.trim() || undefined;
  const limit = Number(c.req.query('limit') ?? 50);
  const metadataRepo = makeMetadataRepository(c.env);
  const sessions = await metadataRepo.listSessions(c.get('tenant'), domain, limit);
  return c.json({ project: c.get('tenant'), domain: domain ?? null, sessions });
});

app.get('/v1/kb/sessions/:id', async (c) => {
  const metadataRepo = makeMetadataRepository(c.env);
  const session = await metadataRepo.getSession(c.get('tenant'), c.req.param('id'));
  if (!session) return c.json({ error: 'session not found' }, 404);
  return c.json(session);
});

app.post('/v1/kb/sessions/:id/messages', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as KbSessionBody;
  const entries = Array.isArray(body.entries) ? body.entries.filter((entry) => entry && typeof entry === 'object') : [];
  if (entries.length === 0) return c.json({ error: 'entries array is required' }, 400);
  const metadataRepo = makeMetadataRepository(c.env);
  try {
    const session = await metadataRepo.appendSessionHistory(c.get('tenant'), c.req.param('id'), entries);
    return c.json(session);
  } catch (error) {
    if (error instanceof Error && error.message === 'session not found') {
      return c.json({ error: 'session not found' }, 404);
    }
    throw error;
  }
});

app.get('/v1/kb/query/traces', async (c) => {
  const tenant = c.get('tenant');
  const domain = c.req.query('domain')?.trim() || undefined;
  const limit = clampTopK(c.req.query('limit') ?? 20);
  const metadataRepo = makeMetadataRepository(c.env);
  const traces = await metadataRepo.listQueryTraces(tenant, domain, limit);
  return c.json({ project: tenant, domain: domain ?? null, traces });
});

app.get('/v1/kb/query/traces/export', async (c) => {
  const tenant = c.get('tenant');
  const domain = c.req.query('domain')?.trim() || undefined;
  const limit = clampTopK(c.req.query('limit') ?? 50);
  const metadataRepo = makeMetadataRepository(c.env);
  const traces = await metadataRepo.listQueryTraces(tenant, domain, limit);
  return c.json({
    project: tenant,
    domain: domain ?? null,
    exported_at: new Date().toISOString(),
    summary: traceExportSummary(traces),
    traces,
  });
});

app.post('/v1/kb/query/traces/compare', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    trace_ids?: string[];
    baseline_trace_id?: string;
    candidate_trace_id?: string;
  };
  const traceIds = Array.isArray(body.trace_ids)
    ? body.trace_ids.map((id) => String(id).trim()).filter(Boolean)
    : [body.baseline_trace_id, body.candidate_trace_id].map((id) => String(id ?? '').trim()).filter(Boolean);
  if (traceIds.length !== 2) return c.json({ error: 'exactly two trace ids are required' }, 400);
  const [baselineId, candidateId] = traceIds as [string, string];
  const tenant = c.get('tenant');
  const metadataRepo = makeMetadataRepository(c.env);
  const baseline = await metadataRepo.getQueryTrace(tenant, baselineId);
  const candidate = await metadataRepo.getQueryTrace(tenant, candidateId);
  if (!baseline || !candidate) return c.json({ error: 'trace not found' }, 404);
  return c.json({
    project: tenant,
    comparison: compareTraces(baseline, candidate),
    traces: [baseline, candidate],
  });
});

app.get('/v1/kb/query/trace/:id/drilldown', async (c) => {
  const tenant = c.get('tenant');
  const metadataRepo = makeMetadataRepository(c.env);
  const trace = await metadataRepo.getQueryTrace(tenant, c.req.param('id'));
  if (!trace) return c.json({ error: 'trace not found' }, 404);
  return c.json({
    project: tenant,
    trace_id: trace.id,
    quality: answerQualityDrilldown(trace),
    trace,
  });
});

app.get('/v1/kb/query/trace/:id', async (c) => {
  const tenant = c.get('tenant');
  const metadataRepo = makeMetadataRepository(c.env);
  const trace = await metadataRepo.getQueryTrace(tenant, c.req.param('id'));
  if (!trace) return c.json({ error: 'trace not found' }, 404);
  return c.json(trace);
});
}
