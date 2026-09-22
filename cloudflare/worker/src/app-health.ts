import {
  createAppHealthClient,
  type AppHealthClient,
  type AppHealthClientOptions,
} from '@saas-maker/app-health';
import { honoMiddleware } from '@saas-maker/app-health/hono';
import type { Variables } from './auth';
import type { Env } from './types';

const APP_HEALTH_INGEST_ENDPOINT = 'https://ingest.sassmaker.com/v1/ingest';

export type AppHealthClientFactory = (env: Env) => AppHealthClient | null;

type AppHealthBindings = Pick<
  Env,
  | 'APP_HEALTH_ENVIRONMENT'
  | 'APP_HEALTH_INGEST_KEY'
  | 'RAG_DEPLOY_FINGERPRINT'
>;

/** Create one bounded client per request, or stay inert until a private key exists. */
export function createKnowledgeBaseAppHealthClient(
  env: AppHealthBindings,
  fetchOverride?: AppHealthClientOptions['fetch'],
): AppHealthClient | null {
  const key = env.APP_HEALTH_INGEST_KEY?.trim();
  if (!key) return null;
  const environment = env.APP_HEALTH_ENVIRONMENT?.trim();
  const release = env.RAG_DEPLOY_FINGERPRINT?.trim();

  return createAppHealthClient({
    key,
    endpoint: APP_HEALTH_INGEST_ENDPOINT,
    runtime: 'worker',
    disableTimer: true,
    maxQueueSize: 1,
    maxRetries: 1,
    requestTimeoutMs: 1_500,
    ...(environment ? { environment } : {}),
    ...(release ? { release } : {}),
    ...(fetchOverride ? { fetch: fetchOverride } : {}),
  });
}

export function knowledgeBaseAppHealthMiddleware(
  makeClient: AppHealthClientFactory = createKnowledgeBaseAppHealthClient,
) {
  return honoMiddleware<{ Bindings: Env; Variables: Variables }>({
    client: (context) => makeClient(context.env),
  });
}
