import { parseCacheOptions, stableStringify } from './cache';
import { embedTexts } from './embeddings';
import { fetchFreeAiEmbeddingCatalog, findFreeAiEmbeddingModel, freeAiEmbed, freeAiEmbeddingDimensions, freeAiEmbeddingModel } from './free-ai';
import {
  DEFAULT_BASE_EMBEDDING_DIMENSIONS,
  DEFAULT_BASE_EMBEDDING_MODEL,
  DEFAULT_SMALL_EMBEDDING_DIMENSIONS,
  DEFAULT_SMALL_EMBEDDING_MODEL,
  MAX_RECORD_INDEX_TEXT_CHARS,
  WORKER_DEPLOY_FINGERPRINT,
  WORKER_VERSION,
  type ConfiguredVectorizeProfile,
  type CreateIndexBody,
  type EmbeddingCallOptions,
  type FetchLikeApp,
  type QueryBody,
  type ResolvedEmbeddingProfile,
  type SemanticModel,
  type WorkerHealthPayload,
} from './app-types';
import type { Env, IndexRecord, JsonRecord, SearchResult } from './types';
import type { AppContext } from './app-types';

export function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function stringField(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function listField(record: JsonRecord, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

export function clampIndexText(value: string): string {
  if (value.length <= MAX_RECORD_INDEX_TEXT_CHARS) return value;
  const clipped = value
    .slice(0, MAX_RECORD_INDEX_TEXT_CHARS)
    .replace(/\s+\S*$/, '')
    .trimEnd();
  return `${clipped || value.slice(0, MAX_RECORD_INDEX_TEXT_CHARS).trimEnd()}...`;
}

export function structuredRecordIndexText(record: JsonRecord): string {
  const ragText = stringField(record, 'rag_text');
  if (ragText) return clampIndexText(ragText);

  const authorNames = listField(record, 'author_names');
  const topics = listField(record, 'topics');
  const lines = [
    ['Title', stringField(record, 'title')],
    ['Abstract', stringField(record, 'abstract')],
    ['Summary', stringField(record, 'summary')],
    ['Authors', authorNames.length ? authorNames.join(', ') : null],
    ['Primary topic', stringField(record, 'primary_topic')],
    ['Subfield', stringField(record, 'subfield')],
    ['Source', stringField(record, 'source_name')],
    ['Publication year', record.publication_year === undefined || record.publication_year === null ? null : String(record.publication_year)],
    ['Citations', record.citation_count === undefined || record.citation_count === null ? null : String(record.citation_count)],
    ['Topics', topics.length ? topics.join(', ') : null],
    ['URL', stringField(record, 'url')],
    ['PDF link', stringField(record, 'pdf_url')],
    ['OpenAlex URL', stringField(record, 'openalex_url')],
    ['DOI', stringField(record, 'doi')],
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([label, value]) => `${label}: ${value}`);

  return lines.length > 0 ? clampIndexText(lines.join('\n')) : stableStringify(record);
}

export function buildCacheKey(parts: unknown): string {
  return stableStringify(parts);
}

export function vectorNamespace(tenant: string, indexId: string): string {
  return `${tenant}:${indexId}`;
}

export function embeddingModel(env: Env, model: SemanticModel): string {
  if (env.RAG_EMBED_PROVIDER === 'free_ai') return freeAiEmbeddingModel(env, model);
  if (model === 'small') return env.EMBEDDING_MODEL_SMALL || DEFAULT_SMALL_EMBEDDING_MODEL;
  return env.EMBEDDING_MODEL || DEFAULT_BASE_EMBEDDING_MODEL;
}

export function embeddingDimensions(env: Env, model: SemanticModel): number {
  if (env.RAG_EMBED_PROVIDER === 'free_ai') return freeAiEmbeddingDimensions(env, model);
  return model === 'small' ? DEFAULT_SMALL_EMBEDDING_DIMENSIONS : DEFAULT_BASE_EMBEDDING_DIMENSIONS;
}

export function configuredVectorizeProfiles(env: Env): ConfiguredVectorizeProfile[] {
  const profiles: ConfiguredVectorizeProfile[] = [];
  const add = (profile: ConfiguredVectorizeProfile) => {
    if (!Number.isFinite(profile.dimensions) || profile.dimensions <= 0) return;
    if (profiles.some((item) => item.dimensions === profile.dimensions)) return;
    profiles.push(profile);
  };

  add({
    key: 'base',
    semanticModel: 'base',
    dimensions: embeddingDimensions(env, 'base'),
    binding: env.VECTORIZE,
    bindingName: 'VECTORIZE',
    model: embeddingModel(env, 'base'),
  });

  if (env.VECTORIZE_SMALL) {
    add({
      key: 'small',
      semanticModel: 'small',
      dimensions: embeddingDimensions(env, 'small'),
      binding: env.VECTORIZE_SMALL,
      bindingName: 'VECTORIZE_SMALL',
      model: embeddingModel(env, 'small'),
    });
  }

  if (env.VECTORIZE_1024) {
    add({
      key: 'dim_1024',
      semanticModel: 'base',
      dimensions: 1024,
      binding: env.VECTORIZE_1024,
      bindingName: 'VECTORIZE_1024',
    });
  }

  if (env.VECTORIZE_768) {
    add({
      key: 'dim_768',
      semanticModel: 'base',
      dimensions: 768,
      binding: env.VECTORIZE_768,
      bindingName: 'VECTORIZE_768',
    });
  }

  if (env.VECTORIZE_384) {
    add({
      key: 'dim_384',
      semanticModel: 'small',
      dimensions: 384,
      binding: env.VECTORIZE_384,
      bindingName: 'VECTORIZE_384',
    });
  }

  return profiles;
}

export function vectorizeProfileForSemanticModel(env: Env, model: SemanticModel): ConfiguredVectorizeProfile {
  const profile = configuredVectorizeProfiles(env).find((item) => item.key === model);
  if (!profile) throw new Error(`${model} embedding profile is not configured`);
  return profile;
}

export function vectorizeProfileForDimensions(env: Env, dimensions: number): ConfiguredVectorizeProfile | null {
  return configuredVectorizeProfiles(env).find((item) => item.dimensions === dimensions) ?? null;
}

export function explicitSemanticModelFromBody(body: QueryBody): SemanticModel | null {
  if (body.semantic_model === 'small') return 'small';
  if (body.semantic_model === 'base') return 'base';
  return null;
}

export function vectorizeProfileForIndex(env: Env, index: IndexRecord, body: QueryBody = {}): ConfiguredVectorizeProfile {
  const explicit = explicitSemanticModelFromBody(body);
  if (explicit) return vectorizeProfileForSemanticModel(env, explicit);
  const profile = vectorizeProfileForDimensions(env, index.dimensions);
  if (!profile) throw new Error(`embedding dimensions ${index.dimensions} do not match a configured Vectorize binding`);
  return profile;
}

export function embeddingProfileForIndex(env: Env, index: IndexRecord, vectorizeProfile: ConfiguredVectorizeProfile): ResolvedEmbeddingProfile {
  const storedModel = index.embedding_model?.trim();
  const useStoredModel = Boolean(storedModel) && index.dimensions === vectorizeProfile.dimensions;
  if (!useStoredModel && vectorizeProfile.key !== vectorizeProfile.semanticModel) {
    throw new Error(`index ${index.id} is missing a stored embedding model for ${index.dimensions} dimensions`);
  }
  const model = useStoredModel ? storedModel! : embeddingModel(env, vectorizeProfile.semanticModel);
  const provider = useStoredModel ? index.embedding_provider?.trim() || undefined : undefined;
  return {
    semanticModel: vectorizeProfile.semanticModel,
    vectorizeProfile: vectorizeProfile.key,
    vectorizeBinding: vectorizeProfile.bindingName,
    model,
    provider,
    dimensions: useStoredModel ? index.dimensions : vectorizeProfile.dimensions,
  };
}

export function embeddingOptionsForProfile(profile: ResolvedEmbeddingProfile): EmbeddingCallOptions {
  return {
    model: profile.model,
    provider: profile.provider,
    dimensions: profile.dimensions,
  };
}

export function vectorDimensionError(label: string, vector: number[], expectedDimensions: number): string | null {
  if (!vector.every((value) => Number.isFinite(value))) {
    return `${label} must contain only finite numbers`;
  }
  if (vector.length !== expectedDimensions) {
    return `${label} dimensions ${vector.length} do not match expected dimensions ${expectedDimensions}`;
  }
  return null;
}

export function isEmbeddingReadinessError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('embedding model') ||
    error.message.includes('embedding dimensions') ||
    error.message.includes('embedding profile is not configured') ||
    error.message.includes('free-ai model catalog')
  );
}

export async function resolveCreateEmbeddingProfile(env: Env, body: CreateIndexBody): Promise<ResolvedEmbeddingProfile> {
  const requestedModel = body.embedding_model?.trim();
  const requestedProvider = body.embedding_provider?.trim();
  const explicitProfile =
    body.embedding_profile === 'small' || body.semantic_model === 'small'
      ? 'small'
      : body.embedding_profile === 'base' || body.semantic_model === 'base'
        ? 'base'
        : null;

  if (requestedModel && env.RAG_EMBED_PROVIDER !== 'free_ai') {
    throw new Error('embedding_model selection requires RAG_EMBED_PROVIDER=free_ai');
  }

  if (!requestedModel) {
    const semanticModel = explicitProfile ?? 'base';
    if (env.RAG_EMBED_PROVIDER === 'free_ai') {
      const configured = embeddingModel(env, semanticModel);
      const catalog = await fetchFreeAiEmbeddingCatalog(env);
      const selected = findFreeAiEmbeddingModel(catalog, configured);
      if (!selected) {
        throw new Error(`configured ${semanticModel} embedding model is not available in free-ai: ${configured}`);
      }
      if (selected.enabled === false) {
        throw new Error(`configured ${semanticModel} embedding model is disabled in free-ai: ${configured}`);
      }
      const vectorizeProfile = vectorizeProfileForDimensions(env, selected.dimensions);
      if (!vectorizeProfile) {
        throw new Error(`embedding model dimensions ${selected.dimensions} do not match a configured Vectorize binding`);
      }
      if (semanticModel !== vectorizeProfile.semanticModel) {
        throw new Error(`configured ${semanticModel} embedding model ${selected.id} is not compatible with ${semanticModel} profile`);
      }
      return {
        semanticModel,
        vectorizeProfile: vectorizeProfile.key,
        vectorizeBinding: vectorizeProfile.bindingName,
        model: selected.id,
        provider: selected.provider,
        dimensions: selected.dimensions,
      };
    }
    const vectorizeProfile = vectorizeProfileForSemanticModel(env, semanticModel);
    return {
      semanticModel,
      vectorizeProfile: vectorizeProfile.key,
      vectorizeBinding: vectorizeProfile.bindingName,
      model: embeddingModel(env, semanticModel),
      provider: env.RAG_EMBED_PROVIDER === 'free_ai' ? undefined : 'workers_ai',
      dimensions: vectorizeProfile.dimensions,
    };
  }

  const catalog = await fetchFreeAiEmbeddingCatalog(env);
  const selected = findFreeAiEmbeddingModel(catalog, requestedModel);
  if (!selected) {
    throw new Error(`embedding model is not available in free-ai: ${requestedModel}`);
  }
  if (selected.enabled === false) {
    throw new Error(`embedding model is disabled in free-ai: ${requestedModel}`);
  }
  if (requestedProvider && selected.provider !== requestedProvider) {
    throw new Error(`embedding provider mismatch for ${requestedModel}: expected ${selected.provider}`);
  }

  const vectorizeProfile = vectorizeProfileForDimensions(env, selected.dimensions);
  if (!vectorizeProfile) {
    throw new Error(`embedding model dimensions ${selected.dimensions} do not match a configured Vectorize binding`);
  }
  if (explicitProfile && explicitProfile !== vectorizeProfile.semanticModel) {
    throw new Error(`embedding model ${selected.id} is not compatible with ${explicitProfile} profile`);
  }

  return {
    semanticModel: vectorizeProfile.semanticModel,
    vectorizeProfile: vectorizeProfile.key,
    vectorizeBinding: vectorizeProfile.bindingName,
    model: selected.id,
    provider: selected.provider,
    dimensions: selected.dimensions,
  };
}

export function userVectorFilter(filter: unknown): JsonRecord | undefined {
  const record = { ...jsonRecord(filter) };
  delete record.tenant;
  delete record.index_id;
  return Object.keys(record).length > 0 ? record : undefined;
}

export function sharedQueryCacheEnabled(env: Env): boolean {
  return env.RAG_SHARED_QUERY_CACHE_ENABLED === 'true';
}

export function sharedEmbeddingCacheEnabled(env: Env): boolean {
  return env.RAG_SHARED_EMBEDDING_CACHE_ENABLED === 'true';
}

export function vectorMetadata(tenant: string, indexId: string, documentId: string, chunkIndex: number, content: string, metadata: JsonRecord): JsonRecord {
  const full = buildVectorMetadata(tenant, indexId, documentId, chunkIndex, content, metadata);
  if (jsonByteLength(full) <= VECTOR_METADATA_SAFE_BYTES) return full;

  const compact = buildVectorMetadata(tenant, indexId, documentId, chunkIndex, content, compactChunkMetadataForVectorize(metadata));
  if (jsonByteLength(compact) <= VECTOR_METADATA_SAFE_BYTES) return compact;

  return {
    tenant,
    index_id: indexId,
    document_id: documentId,
    chunk_index: chunkIndex,
    metadata_hydrate: true,
  };
}

export const VECTOR_METADATA_SAFE_BYTES = 9_500;

export function buildVectorMetadata(
  tenant: string,
  indexId: string,
  documentId: string,
  chunkIndex: number,
  content: string,
  metadata: JsonRecord,
): JsonRecord {
  return {
    tenant,
    index_id: indexId,
    document_id: documentId,
    chunk_index: chunkIndex,
    chunk_content: content,
    chunk_metadata: JSON.stringify(metadata),
  };
}

export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function compactChunkMetadataForVectorize(metadata: JsonRecord): JsonRecord {
  const compact = { ...metadata };
  if (compact.record && typeof compact.record === 'object' && !Array.isArray(compact.record)) {
    compact.record = compactPaperRecordForVectorize(compact.record as JsonRecord);
  }
  return compact;
}

export function compactPaperRecordForVectorize(record: JsonRecord): JsonRecord {
  const keep = [
    'record_kind',
    'collection',
    'openalex_id',
    'paper_id',
    'type',
    'title',
    'publication_year',
    'publication_date',
    'citation_count',
    'referenced_works_count',
    'language',
    'author_names',
    'primary_topic',
    'primary_topic_id',
    'subfield',
    'field',
    'topics',
    'url',
    'pdf_url',
    'openalex_url',
    'doi',
    'source_name',
    'source_id',
    'is_open_access',
  ];
  const compact: JsonRecord = {};
  for (const key of keep) {
    if (record[key] !== undefined) compact[key] = compactVectorMetadataValue(record[key], key);
  }
  return compact;
}

export function compactVectorMetadataValue(value: unknown, key: string): unknown {
  if (Array.isArray(value)) return value.slice(0, key === 'author_names' ? 12 : 8);
  if (typeof value === 'string' && value.length > 1_000) return `${value.slice(0, 997)}...`;
  return value;
}

export function searchResultFromVectorMetadata(match: { id: string; score: number; metadata?: JsonRecord }): SearchResult | null {
  const metadata = match.metadata ?? {};
  if (metadata.metadata_hydrate === true) return null;
  if (typeof metadata.document_id !== 'string' || typeof metadata.chunk_content !== 'string') return null;
  let parsedMetadata: unknown = {};
  if (typeof metadata.chunk_metadata === 'string') {
    try {
      parsedMetadata = JSON.parse(metadata.chunk_metadata) as unknown;
    } catch {
      parsedMetadata = {};
    }
  }
  return {
    document_id: metadata.document_id,
    chunk_id: match.id,
    chunk_content: metadata.chunk_content,
    score: match.score,
    metadata: jsonRecord(parsedMetadata),
  };
}

export function elapsedMs(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}

export function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(blob: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', blob));
}

export async function deterministicId(prefix: string, value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return `${prefix}_${(await sha256Hex(buffer)).slice(0, 32)}`;
}

export function numberFromRecord(record: JsonRecord, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function latencyP95(summary: JsonRecord): number | null {
  const latency = jsonRecord(summary.latency);
  const value = latency.p95_ms;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function analyticsNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function analyticsString(value: unknown): string {
  return String(value ?? '').slice(0, 256);
}

export function writeAnalyticsPoint(env: Env, point: AnalyticsEngineDataPoint): void {
  if (!env.RAG_ANALYTICS) return;
  try {
    env.RAG_ANALYTICS.writeDataPoint(point);
  } catch (error) {
    console.warn('knowledgebase analytics write failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function writeEvalReportAnalytics(
  env: Env,
  report: { id: string; project: string; domain: string | null; index_id: string | null; kind: string; summary: JsonRecord },
): void {
  writeAnalyticsPoint(env, {
    indexes: [report.project],
    blobs: [
      'eval_report',
      analyticsString(report.project),
      analyticsString(report.kind),
      analyticsString(report.domain),
      analyticsString(report.index_id),
      analyticsString(report.id),
      analyticsString(report.summary.model_judge_enabled === true ? 'model_judge' : 'deterministic'),
    ],
    doubles: [
      analyticsNumber(report.summary.n),
      analyticsNumber(report.summary.hit_rate),
      analyticsNumber(report.summary.mrr),
      analyticsNumber(report.summary.citation_rate),
      analyticsNumber(report.summary.faithfulness_rate),
      analyticsNumber(report.summary.avg_faithfulness_score),
      analyticsNumber(report.summary.avg_unsupported_answer_tokens),
      analyticsNumber(report.summary.ai_use_rate),
      analyticsNumber(report.summary.avg_model_judge_score),
      analyticsNumber(latencyP95(report.summary)),
    ],
  });
}

export function average(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return Math.round((filtered.reduce((sum, value) => sum + value, 0) / filtered.length) * 10_000) / 10_000;
}

export function summarizeEvalReports(reports: Array<{ kind: string; domain: string | null; summary: JsonRecord; created_at: string }>) {
  const byGroup = new Map<string, typeof reports>();
  for (const report of reports) {
    const key = `${report.kind}:${report.domain ?? ''}`;
    const bucket = byGroup.get(key) ?? [];
    bucket.push(report);
    byGroup.set(key, bucket);
  }
  return [...byGroup.values()]
    .map((items) => {
      const sorted = [...items].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const latest = sorted[0];
      return {
        kind: latest?.kind ?? null,
        domain: latest?.domain ?? null,
        report_count: items.length,
        latest_created_at: latest?.created_at ?? null,
        avg_hit_rate: average(items.map((item) => numberFromRecord(item.summary, 'hit_rate'))),
        avg_mrr: average(items.map((item) => numberFromRecord(item.summary, 'mrr'))),
        avg_citation_rate: average(items.map((item) => numberFromRecord(item.summary, 'citation_rate'))),
        avg_faithfulness_rate: average(items.map((item) => numberFromRecord(item.summary, 'faithfulness_rate'))),
        avg_faithfulness_score: average(items.map((item) => numberFromRecord(item.summary, 'avg_faithfulness_score'))),
        avg_unsupported_answer_tokens: average(items.map((item) => numberFromRecord(item.summary, 'avg_unsupported_answer_tokens'))),
        avg_ai_use_rate: average(items.map((item) => numberFromRecord(item.summary, 'ai_use_rate'))),
        avg_model_judge_score: average(items.map((item) => numberFromRecord(item.summary, 'avg_model_judge_score'))),
        avg_p95_ms: average(items.map((item) => latencyP95(item.summary))),
        latest_summary: latest?.summary ?? null,
      };
    })
    .sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.domain ?? '').localeCompare(String(b.domain ?? '')));
}

export function deployFingerprint(env: Env): string {
  return env.RAG_DEPLOY_FINGERPRINT?.trim() || WORKER_DEPLOY_FINGERPRINT;
}

export async function workerHealth(env: Env): Promise<WorkerHealthPayload> {
  const fingerprint = deployFingerprint(env);
  const base = {
    vectorize: Boolean(env.VECTORIZE),
    r2: Boolean(env.RAW_DOCS),
    version: WORKER_VERSION,
    deploy_fingerprint: fingerprint,
  };
  try {
    await env.DB.prepare('SELECT 1 AS ok').first();
  } catch (error) {
    return {
      ok: false,
      d1: false,
      d1_schema: false,
      ...base,
      error: String(error),
    };
  }

  try {
    await env.DB.prepare('SELECT embedding_model, embedding_provider FROM indexes LIMIT 0').first();
    await env.DB.prepare('SELECT embedding_model, embedding_provider FROM kb_domains LIMIT 0').first();
    return {
      ok: true,
      d1: true,
      d1_schema: true,
      ...base,
    };
  } catch (error) {
    if (env.RAG_ALLOW_UNMIGRATED_LOCAL_D1 === 'true') {
      return {
        ok: true,
        d1: true,
        d1_schema: false,
        d1_schema_check_skipped: true,
        ...base,
        error: String(error),
      };
    }
    return {
      ok: false,
      d1: true,
      d1_schema: false,
      ...base,
      error: String(error),
    };
  }
}

export function readyzPayload(health: WorkerHealthPayload): JsonRecord {
  return {
    status: health.ok && health.vectorize && health.r2 ? 'ok' : 'degraded',
    db:
      health.error && !health.d1_schema_check_skipped
        ? { ok: false, schema_ok: health.d1_schema, error: health.error.slice(0, 200) }
        : { ok: health.d1, schema_ok: health.d1_schema, schema_check_skipped: health.d1_schema_check_skipped === true },
    vector: { ok: health.vectorize, backend: 'vectorize' },
    object: { ok: health.r2, backend: 'r2' },
    worker: { version: health.version, deploy_fingerprint: health.deploy_fingerprint },
  };
}

export function prometheusLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function metricsText(health: WorkerHealthPayload): string {
  const lines = [
    '# HELP kb_worker_info Knowledgebase Worker build information.',
    '# TYPE kb_worker_info gauge',
    `kb_worker_info{version="${prometheusLabel(health.version)}",deploy_fingerprint="${prometheusLabel(health.deploy_fingerprint)}"} 1`,
    '# HELP kb_worker_ready Cloudflare Worker dependency readiness.',
    '# TYPE kb_worker_ready gauge',
    `kb_worker_ready ${health.ok && health.vectorize && health.r2 ? 1 : 0}`,
    '# HELP kb_d1_schema_ready D1 schema readiness for required Worker migrations.',
    '# TYPE kb_d1_schema_ready gauge',
    `kb_d1_schema_ready ${health.d1_schema ? 1 : 0}`,
    '# HELP kb_queries_total Total queries served by this Worker isolate.',
    '# TYPE kb_queries_total counter',
    'kb_queries_total 0',
    '# HELP kb_ingest_files_total Total files ingested by this Worker isolate.',
    '# TYPE kb_ingest_files_total counter',
    'kb_ingest_files_total 0',
    '# HELP kb_query_tokens Token usage per query.',
    '# TYPE kb_query_tokens summary',
    'kb_query_tokens_count 0',
    'kb_query_tokens_sum 0',
    '# HELP kb_stage_latency_ms Per-stage latency in ms.',
    '# TYPE kb_stage_latency_ms summary',
    'kb_stage_latency_ms_count{stage="unknown"} 0',
    'kb_stage_latency_ms_sum{stage="unknown"} 0',
  ];
  return `${lines.join('\n')}\n`;
}

export function legacyRouteTarget(pathname: string): string | null {
  if (pathname === '/agent/search') return '/v1/kb/search';
  if (pathname === '/search/eval') return '/v1/kb/evals/search';
  if (pathname === '/search') return '/v1/kb/search';
  if (pathname === '/query/stream') return '/v1/kb/query/stream';
  if (pathname === '/query/traces') return '/v1/kb/query/traces';
  if (pathname.startsWith('/query/trace/')) return `/v1/kb${pathname}`;
  if (pathname === '/query') return '/v1/kb/query';
  if (pathname === '/schemas/infer/files') return '/v1/kb/schemas/infer-upload';
  if (pathname === '/ingest/jobs') return '/v1/kb/jobs';
  if (pathname.startsWith('/ingest/jobs/')) return `/v1/kb/ingest/jobs/${pathname.slice('/ingest/jobs/'.length)}`;
  for (const prefix of ['/projects', '/domains', '/schemas', '/files', '/sources', '/entities', '/ingest']) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return `/v1/kb${pathname}`;
  }
  return null;
}

export async function forwardLegacyRoute(app: FetchLikeApp, c: AppContext, targetPath: string): Promise<Response> {
  const sourceUrl = new URL(c.req.url);
  sourceUrl.pathname = targetPath;
  const method = c.req.raw.method;
  const init: RequestInit = {
    method,
    headers: new Headers(c.req.raw.headers),
  };
  if (method !== 'GET' && method !== 'HEAD') {
    const body = await c.req.arrayBuffer();
    if (body.byteLength > 0) init.body = body;
  }
  return app.fetch(new Request(sourceUrl.toString(), init), c.env);
}

export async function deleteVectorsFromProfile(profile: ConfiguredVectorizeProfile, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  for (let start = 0; start < ids.length; start += 1000) {
    await profile.binding.deleteByIds(ids.slice(start, start + 1000));
  }
}

export async function deleteVectorsFromAllProfiles(env: Env, ids: string[]): Promise<void> {
  const seen = new Set<string>();
  for (const profile of configuredVectorizeProfiles(env)) {
    if (seen.has(profile.bindingName)) continue;
    seen.add(profile.bindingName);
    await deleteVectorsFromProfile(profile, ids);
  }
}

export async function deleteVectorsForIndex(env: Env, index: IndexRecord, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const profiles: ConfiguredVectorizeProfile[] = [];
  const primary = vectorizeProfileForDimensions(env, index.dimensions);
  if (primary) profiles.push(primary);
  if (index.dimensions === embeddingDimensions(env, 'base')) {
    const small = configuredVectorizeProfiles(env).find((profile) => profile.key === 'small');
    if (small) profiles.push(small);
  }
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (seen.has(profile.bindingName)) continue;
    seen.add(profile.bindingName);
    await deleteVectorsFromProfile(profile, ids);
  }
}
