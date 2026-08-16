import type { Hono } from 'hono';
import { metricsText, readyzPayload, workerHealth } from '../app-utils';
import type { Variables } from '../auth';
import type { AppRuntime } from '../runtime';
import { TESTING_UI_HTML } from '../testing-ui';
import type { Env } from '../types';

type App = Hono<{ Bindings: Env; Variables: Variables }>;

export function registerSystemRoutes(app: App, _rt: AppRuntime): void {
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
