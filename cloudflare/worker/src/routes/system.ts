import type { Hono } from 'hono';
import type { Variables } from '../auth';
import type { Env } from '../types';
import type { AppRuntime } from '../runtime';
import { TESTING_UI_HTML } from '../testing-ui';
import { metricsText, readyzPayload, workerHealth } from '../app-utils';

type App = Hono<{ Bindings: Env; Variables: Variables }>;

export function registerSystemRoutes(app: App, rt: AppRuntime): void {
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

  app.get('/v1/healthz', async (c) => {
    const health = await workerHealth(c.env);
    return c.json(health, health.ok ? 200 : 503);
  });

  app.get('/healthz', async (c) => {
    const health = await workerHealth(c.env);
    return c.json(health, health.ok ? 200 : 503);
  });

  app.get('/readyz', async (c) => {
    const health = await workerHealth(c.env);
    return c.json(readyzPayload(health), health.ok && health.vectorize && health.r2 ? 200 : 503);
  });

  app.get('/metrics', async (c) => {
    const health = await workerHealth(c.env);
    return c.text(metricsText(health), 200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    });
  });

  app.get('/', (c) => c.html(TESTING_UI_HTML));
  app.get('/ui', (c) => c.html(TESTING_UI_HTML));
}
