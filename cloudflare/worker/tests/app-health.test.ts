import type {
  AppHealthClient,
  AppHealthClientOptions,
  EventInput,
} from '@saas-maker/app-health';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
  createKnowledgeBaseAppHealthClient,
  knowledgeBaseAppHealthMiddleware,
} from '../src/app-health';
import { createApp } from '../src/index';
import type { Env } from '../src/types';

function clientSpy() {
  const events: EventInput[] = [];
  const flush = vi.fn(async () => {});
  const client: AppHealthClient = {
    record: (event) => events.push(event),
    log: () => {},
    flush,
    close: async () => {},
    diagnostics: () => ({
      queued: 0,
      sentBatches: 0,
      sentEvents: 0,
      failedBatches: 0,
      retriedBatches: 0,
      droppedInvalid: 0,
      droppedOverflow: 0,
      droppedDelivery: 0,
      lastSendError: null,
    }),
  };
  return { client, events, flush };
}

function executionContext(waits: Promise<unknown>[]): ExecutionContext {
  return {
    waitUntil: (promise) => waits.push(promise),
    passThroughOnException: () => {},
    exports: {} as Cloudflare.Exports,
    props: {},
  };
}

describe('Knowledge Base App Health integration', () => {
  it('stays inert when the private ingest key is missing or blank', () => {
    expect(createKnowledgeBaseAppHealthClient({})).toBeNull();
    expect(createKnowledgeBaseAppHealthClient({ APP_HEALTH_INGEST_KEY: '  ' })).toBeNull();
  });

  it('records only the matched Hono route template and declared response fields', async () => {
    const { client, events, flush } = clientSpy();
    const waits: Promise<unknown>[] = [];
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', knowledgeBaseAppHealthMiddleware(() => client));
    app.get('/v1/kb/files/:file_id', (context) => context.json({ ok: true }, 201));

    const response = await app.request(
      'https://knowledgebase.test/v1/kb/files/private-file?token=secret',
      {
        headers: {
          authorization: 'Bearer private',
          cookie: 'session=private',
        },
      },
      {} as Env,
      executionContext(waits),
    );

    expect(response.status).toBe(201);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      method: 'GET',
      route: '/v1/kb/files/:file_id',
      status_code: 201,
    });
    expect(JSON.stringify(events)).not.toContain('private-file');
    expect(JSON.stringify(events)).not.toContain('secret');
    expect(flush).toHaveBeenCalledOnce();
    expect(waits).toHaveLength(1);
  });

  it('delivers an accepted batch through the published Worker client', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const collector: NonNullable<AppHealthClientOptions['fetch']> = async (input, init) => {
      requests.push({ input, ...(init ? { init } : {}) });
      return new Response(null, { status: 202 });
    };
    const waits: Promise<unknown>[] = [];
    const app = new Hono<{ Bindings: Env }>();
    app.use(
      '*',
      knowledgeBaseAppHealthMiddleware((env) =>
        createKnowledgeBaseAppHealthClient(env, collector),
      ),
    );
    app.get('/v1/kb/files/:file_id', (context) => context.json({ ok: true }));

    const response = await app.request(
      'https://knowledgebase.test/v1/kb/files/private-file',
      undefined,
      {
        APP_HEALTH_INGEST_KEY: 'synthetic-test-key',
        APP_HEALTH_ENVIRONMENT: 'local',
        RAG_DEPLOY_FINGERPRINT: 'knowledgebase-test',
      } as Env,
      executionContext(waits),
    );
    await Promise.all(waits);

    expect(response.status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(String(requests[0]?.input)).toBe('https://ingest.sassmaker.com/v1/ingest');
    const batch = JSON.parse(String(requests[0]?.init?.body)) as {
      environment?: string;
      events: EventInput[];
    };
    expect(batch.environment).toBe('local');
    expect(batch.events).toEqual([
      expect.objectContaining({
        method: 'GET',
        route: '/v1/kb/files/:file_id',
        status_code: 200,
        release: 'knowledgebase-test',
      }),
    ]);
    expect(JSON.stringify(batch)).not.toContain('private-file');
  });

  it('preserves error responses when background delivery fails', async () => {
    const { client, events } = clientSpy();
    client.flush = vi.fn(async () => {
      throw new Error('collector unavailable');
    });
    const waits: Promise<unknown>[] = [];
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', knowledgeBaseAppHealthMiddleware(() => client));
    app.get('/unavailable', (context) => context.json({ error: 'unavailable' }, 503));

    const response = await app.request(
      'https://knowledgebase.test/unavailable',
      undefined,
      {} as Env,
      executionContext(waits),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });
    expect(events[0]).toMatchObject({ route: '/unavailable', status_code: 503 });
    expect((await Promise.allSettled(waits))[0]?.status).toBe('rejected');
  });

  it('mounts monitoring ahead of the real Knowledge Base routes', async () => {
    const { client, events } = clientSpy();
    const waits: Promise<unknown>[] = [];
    const app = createApp({ makeAppHealthClient: () => client });

    const response = await app.request(
      'https://knowledgebase.test/',
      undefined,
      {} as Env,
      executionContext(waits),
    );

    expect(response.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ method: 'GET', route: '/', status_code: 200 });
    await Promise.all(waits);
  });

  it('records the canonical template after a legacy route forward', async () => {
    const { client, events } = clientSpy();
    const app = createApp({ makeAppHealthClient: () => client });

    const response = await app.request(
      'https://knowledgebase.test/query',
      { method: 'POST' },
      {} as Env,
    );

    expect(response.status).toBe(401);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      method: 'POST',
      route: '/v1/kb/query',
      status_code: 401,
    });
  });
});
