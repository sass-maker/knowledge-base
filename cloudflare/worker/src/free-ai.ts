import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

import type { Env } from './types';

// OpenAI-compatible client for an explicitly configured free-provider endpoint.
// gemini-embedding-001 is Matryoshka-trained; the endpoint forwards `dimensions`
// to its output_dimensionality, so we request 1536 (fits Vectorize's 1536-dim
// ceiling) and validate the response length. Gemini's free tier sustains bursts
// where voyage's ~3 rpm does not.
const DEFAULT_EMBED_MODEL = 'gemini-embedding-001';
const DEFAULT_EMBED_PROVIDER = 'gemini';
const DEFAULT_SYNTH_MODEL = 'gemini-2.5-flash';
const DEFAULT_DIMENSIONS = 1536;
const EMBED_BATCH_SIZE = 100;
type SemanticProfile = 'base' | 'small';

export interface FreeAiEmbeddingModel {
  id: string;
  provider: string;
  dimensions: number;
  enabled?: boolean | undefined;
  priority?: number | undefined;
  supports_dimensions?: boolean | undefined;
  aliases?: string[];
}

const FREE_AI_EMBEDDING_MODELS: FreeAiEmbeddingModel[] = [
  {
    id: 'gemini-embedding-001',
    provider: 'gemini',
    dimensions: 1536,
    supports_dimensions: true,
    aliases: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-004'],
  },
  { id: 'voyage-3.5-lite', provider: 'voyage_ai', dimensions: 1024 },
  { id: 'voyage-3-lite', provider: 'voyage_ai', dimensions: 1024 },
  { id: '@cf/baai/bge-large-en-v1.5', provider: 'workers_ai', dimensions: 1024 },
  { id: '@cf/baai/bge-base-en-v1.5', provider: 'workers_ai', dimensions: 768 },
  { id: '@cf/baai/bge-small-en-v1.5', provider: 'workers_ai', dimensions: 384 },
];

export interface FreeAiChatBody {
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
  response_format?: unknown;
}

export function freeAiSynthEnabled(env: Env): boolean {
  return env.RAG_SYNTH_PROVIDER === 'free_ai';
}

export function freeAiSynthModel(env: Env): string {
  return env.FREE_AI_SYNTH_MODEL?.trim() || DEFAULT_SYNTH_MODEL;
}

function baseUrl(env: Env): string {
  const configured = env.FREE_AI_BASE_URL?.trim();
  if (!configured) throw new Error('FREE_AI_BASE_URL is not configured');
  return configured.replace(/\/+$/, '');
}

function catalogModel(model: string): FreeAiEmbeddingModel | null {
  const normalized = model.trim();
  return FREE_AI_EMBEDDING_MODELS.find((item) => item.id === normalized || item.aliases?.includes(normalized)) ?? null;
}

function configuredModel(env: Env, profile: SemanticProfile): string {
  if (profile === 'small') return env.FREE_AI_EMBED_MODEL_SMALL?.trim() || '@cf/baai/bge-small-en-v1.5';
  return env.FREE_AI_EMBED_MODEL?.trim() || DEFAULT_EMBED_MODEL;
}

function configuredProvider(env: Env, profile: SemanticProfile, model: string): string {
  const explicit = profile === 'small' ? env.FREE_AI_EMBED_PROVIDER_SMALL?.trim() : env.FREE_AI_EMBED_PROVIDER?.trim();
  if (explicit && model === configuredModel(env, profile)) return explicit;
  return catalogModel(model)?.provider || explicit || DEFAULT_EMBED_PROVIDER;
}

function configuredDimensions(env: Env, profile: SemanticProfile, model: string): number {
  const raw = profile === 'small' ? env.FREE_AI_EMBED_DIMENSIONS_SMALL : env.FREE_AI_EMBED_DIMENSIONS;
  const configured = Number(raw);
  if (model === configuredModel(env, profile) && Number.isFinite(configured) && configured > 0) {
    return Math.trunc(configured);
  }
  return catalogModel(model)?.dimensions ?? DEFAULT_DIMENSIONS;
}

function supportsDimensionOverride(model: string): boolean {
  return catalogModel(model)?.supports_dimensions === true;
}

export function freeAiEmbeddingModel(env: Env, profile: SemanticProfile): string {
  return configuredModel(env, profile);
}

export function freeAiEmbeddingDimensions(env: Env, profile: SemanticProfile): number {
  return configuredDimensions(env, profile, configuredModel(env, profile));
}

export function freeAiEmbeddingCatalog(
  env: Env,
): Array<FreeAiEmbeddingModel & { configured_profile: SemanticProfile | null; compatible_profile: string | null }> {
  const baseModel = configuredModel(env, 'base');
  const smallModel = configuredModel(env, 'small');
  const baseDimensions = freeAiEmbeddingDimensions(env, 'base');
  const smallDimensions = freeAiEmbeddingDimensions(env, 'small');
  return FREE_AI_EMBEDDING_MODELS.map((item) => ({
    ...item,
    configured_profile: item.id === baseModel ? 'base' : item.id === smallModel ? 'small' : null,
    compatible_profile: item.dimensions === baseDimensions ? 'base' : item.dimensions === smallDimensions ? 'small' : null,
  }));
}

function authHeaders(env: Env): Record<string, string> {
  const key = env.FREE_AI_API_KEY?.trim();
  if (!key) throw new Error('FREE_AI_API_KEY is not configured');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function optionalAuthHeaders(env: Env): Record<string, string> {
  const key = env.FREE_AI_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}`, Accept: 'application/json' } : { Accept: 'application/json' };
}

function directFetch(env: Env, url: string, init: RequestInit): Promise<Response> {
  return env.AI_HTTP?.fetch(url, init) ?? fetch(url, init);
}

function parseFreeAiModelRows(payload: unknown): FreeAiEmbeddingModel[] {
  const rows = payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : null;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as {
      id?: unknown;
      type?: unknown;
      provider?: unknown;
      dimensions?: unknown;
      enabled?: unknown;
      priority?: unknown;
      supports_dimensions?: unknown;
      aliases?: unknown;
    };
    if (item.type !== 'embedding') return [];
    if (typeof item.id !== 'string' || typeof item.provider !== 'string') return [];
    if (typeof item.dimensions !== 'number' || !Number.isFinite(item.dimensions) || item.dimensions <= 0) return [];
    return [
      {
        id: item.id,
        provider: item.provider,
        dimensions: Math.trunc(item.dimensions),
        enabled: item.enabled !== false,
        priority: typeof item.priority === 'number' && Number.isFinite(item.priority) ? item.priority : undefined,
        supports_dimensions: item.supports_dimensions === true,
        aliases: Array.isArray(item.aliases) ? item.aliases.filter((alias): alias is string => typeof alias === 'string') : [],
      },
    ];
  });
}

export async function fetchFreeAiEmbeddingCatalog(env: Env): Promise<FreeAiEmbeddingModel[]> {
  const res = await directFetch(env, `${baseUrl(env)}/models`, {
    method: 'GET',
    headers: optionalAuthHeaders(env),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`free-ai model catalog failed ${res.status}: ${detail.slice(0, 200)}`);
  }
  const dynamic = parseFreeAiModelRows(await res.json());
  if (dynamic.length === 0) {
    throw new Error('free-ai model catalog returned no embedding models');
  }
  return dynamic;
}

export function findFreeAiEmbeddingModel(catalog: FreeAiEmbeddingModel[], model: string): FreeAiEmbeddingModel | null {
  const normalized = model.trim();
  return catalog.find((item) => item.id === normalized || item.aliases?.includes(normalized)) ?? null;
}

// Free upstream providers (Gemini/Voyage) rate-limit under burst. Retry 429/503
// with bounded backoff (honoring Retry-After) so transient limits don't fail
// ingest or queries outright.
const RETRY_STATUSES = new Set([429, 503]);
const MAX_RETRIES = 2;

async function directFetchRetry(env: Env, url: string, init: RequestInit): Promise<Response> {
  let res = await directFetch(env, url, init);
  for (let attempt = 0; attempt < MAX_RETRIES && RETRY_STATUSES.has(res.status); attempt += 1) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 4000) : 400 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    res = await directFetch(env, url, init);
  }
  return res;
}

function extractVector(row: unknown): number[] | null {
  if (Array.isArray(row) && row.every((value) => typeof value === 'number')) {
    return row as number[];
  }
  if (row && typeof row === 'object') {
    const embedding = (row as { embedding?: unknown }).embedding;
    if (Array.isArray(embedding) && embedding.every((value) => typeof value === 'number')) {
      return embedding as number[];
    }
  }
  return null;
}

// Drop-in replacement for embedTexts. The model is explicit and the response
// dimension is validated so a provider cannot silently corrupt the index.
export async function freeAiEmbed(
  env: Env,
  texts: string[],
  options: { model?: string; provider?: string | undefined; dimensions?: number | undefined } = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const profile: SemanticProfile = options.model === configuredModel(env, 'small') ? 'small' : 'base';
  const model = options.model?.trim() || configuredModel(env, profile);
  const dimensions =
    options.dimensions && Number.isFinite(options.dimensions) && options.dimensions > 0
      ? Math.trunc(options.dimensions)
      : configuredDimensions(env, profile, model);
  const url = `${baseUrl(env)}/embeddings`;
  const vectors: number[][] = [];

  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
    const res = await directFetchRetry(env, url, {
      method: 'POST',
      headers: {
        ...authHeaders(env),
      },
      body: JSON.stringify({
        model,
        input: batch,
        ...(supportsDimensionOverride(model) ? { dimensions } : {}),
        encoding_format: 'float',
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`free-ai embeddings failed ${res.status}: ${detail.slice(0, 200)}`);
    }
    const payload = (await res.json()) as { data?: unknown };
    const rows = Array.isArray(payload.data) ? payload.data : [];
    if (rows.length !== batch.length) {
      throw new Error(`free-ai embeddings count mismatch: got ${rows.length} for ${batch.length} inputs`);
    }
    // Preserve input order when the provider returns OpenAI-style index fields.
    const ordered = rows
      .map((row, i) => ({ row, index: typeof (row as { index?: number }).index === 'number' ? (row as { index: number }).index : i }))
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.row);
    for (const row of ordered) {
      const vector = extractVector(row);
      if (!vector || vector.length !== dimensions) {
        throw new Error(`free-ai embedding dimension mismatch: expected ${dimensions}, got ${vector ? vector.length : 'none'}`);
      }
      vectors.push(vector);
    }
  }
  return vectors;
}

// Returns a Workers-AI-shaped { response } object so existing aiTextResponse()
// parsing works unchanged for both providers.
export async function freeAiChatRaw(env: Env, model: string, body: FreeAiChatBody): Promise<{ response: string }> {
  const key = env.FREE_AI_API_KEY?.trim();
  if (!key) throw new Error('FREE_AI_API_KEY is not configured');
  const provider = createOpenAICompatible({
    name: 'knowledgebase-direct',
    baseURL: baseUrl(env),
    apiKey: key,
    ...(env.AI_HTTP ? { fetch: env.AI_HTTP.fetch.bind(env.AI_HTTP) as typeof fetch } : {}),
  });
  const result = await generateText({
    model: provider.chatModel(model),
    messages: body.messages as Array<
      { role: 'system' | 'user' | 'assistant'; content: string }
    >,
    ...(typeof body.max_tokens === 'number' ? { maxOutputTokens: body.max_tokens } : {}),
    ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
    maxRetries: 0,
  });
  return { response: result.text };
}
