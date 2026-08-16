import { Hono } from 'hono';
import { requireServiceKey, type Variables } from './auth';
import { type AppOptions, type KbIngestRunBody, type QueueCapableApp } from './app-types';
import { forwardLegacyRoute, legacyRouteTarget } from './app-utils';
import { classifyIngestFailure, INGEST_QUEUE_MAX_ATTEMPTS, KbIngestWorkflow } from './ingest';
import { createRuntime } from './runtime';
import { registerCatalogRoutes } from './routes/catalog';
import { registerEntityRoutes } from './routes/entities';
import { registerEvalRoutes } from './routes/evals';
import { registerIndexRoutes } from './routes/indexes';
import { registerIngestRoutes } from './routes/ingest';
import { registerSearchRoutes } from './routes/search';
import { registerSystemRoutes } from './routes/system';
import type { Env, KbIngestQueueMessage } from './types';

export { KbIngestWorkflow };

export function createApp(options: AppOptions = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  const rt = createRuntime(options);

  registerSystemRoutes(app, rt);

  app.all('*', async (c, next) => {
    const target = legacyRouteTarget(new URL(c.req.url).pathname);
    if (!target) return next();
    return forwardLegacyRoute(app, c, target);
  });

  app.use('/v1/*', requireServiceKey);

  registerCatalogRoutes(app, rt);
  registerIngestRoutes(app, rt);
  registerEntityRoutes(app, rt);
  registerSearchRoutes(app, rt);
  registerIndexRoutes(app, rt);
  registerEvalRoutes(app, rt);

  (app as QueueCapableApp).processIngestQueue = async (batch: MessageBatch<KbIngestQueueMessage>, env: Env) => {
    for (const message of batch.messages) {
      const body = message.body;
      if (!body || body.kind !== 'kb_ingest' || !body.project || !body.domain) {
        message.ack();
        continue;
      }
      const messageStarted = Date.now();
      if (message.attempts > INGEST_QUEUE_MAX_ATTEMPTS) {
        console.error('knowledgebase ingest queue poison input dropped', {
          message_id: message.id,
          project: body.project,
          domain: body.domain,
          attempts: message.attempts,
          run_id: body.run_id ?? null,
        });
        message.ack();
        continue;
      }
      try {
        const ingestBody: KbIngestRunBody = {
          domain: body.domain,
        };
        if (body.run_id !== undefined) ingestBody.run_id = body.run_id;
        if (body.file_ids !== undefined) ingestBody.file_ids = body.file_ids;
        if (body.markdown_conversion !== undefined) ingestBody.markdown_conversion = body.markdown_conversion;
        if (body.vision_ocr_model !== undefined) ingestBody.vision_ocr_model = body.vision_ocr_model;
        if (body.chunking !== undefined) ingestBody.chunking = body.chunking;
        await rt.runKbIngest(env, body.project, ingestBody, 'worker-queue');
        console.log('knowledgebase ingest queue succeeded', {
          message_id: message.id,
          project: body.project,
          domain: body.domain,
          attempts: message.attempts,
          duration_ms: Date.now() - messageStarted,
        });
        message.ack();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('knowledgebase ingest queue failed', {
          message_id: message.id,
          project: body.project,
          domain: body.domain,
          attempts: message.attempts,
          run_id: body.run_id ?? null,
          duration_ms: Date.now() - messageStarted,
          error: errorMessage,
          failure_classification: classifyIngestFailure(errorMessage),
        });
        message.retry({ delaySeconds: Math.min(300, 10 * Math.max(1, message.attempts)) });
      }
    }
  };

  return app;
}

export function createWorker(options: AppOptions = {}) {
  const app = createApp(options) as QueueCapableApp;
  return {
    fetch: app.fetch,
    queue: (batch: MessageBatch<KbIngestQueueMessage>, env: Env): Promise<void> => app.processIngestQueue(batch, env),
  };
}

export default createWorker();
