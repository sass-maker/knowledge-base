// API client for the Knowledgebase internal operator dashboard.
//
// Browser requests stay same-origin under /api. A Cloudflare Pages Function
// validates the operator's Access identity and adds Worker service-key auth
// server-side, so the service key never enters browser storage or JavaScript.
//
// Response shapes are mapped from the actual Worker API responses:
// - GET /v1/kb/status → { data: CorpusStatusRecord[] }
// - GET /v1/kb/domains → { data: DomainRecord[] }
// - GET /v1/kb/files → { data: FileRecord[] }
// - GET /v1/kb/jobs → { project, domain, jobs: IngestJobRecord[] }
// - GET /v1/kb/query/traces → { project, domain, traces: QueryTraceRecord[] }
// - GET /v1/kb/evals/reports → { project, kind, domain, reports: EvalReportRecord[] }
// - POST /v1/kb/search → { project, domain, index_id, data: SearchResult[] }
// - POST /v1/kb/query → KbAnswerPayload
// - POST /v1/kb/files/upload → FileRecord (201)
// - POST /v1/kb/ingest/text → { file_id, ... } (200/201)
// - POST /v1/kb/ingest/run → { run_id, ... } (202)

const API_BASE = "/api";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const isFormData = init.body instanceof FormData;
  const headers = new Headers(init.headers);
  if (!isFormData && init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

async function requestWithHeaders<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ body: T; headers: Headers }> {
  const isFormData = init.body instanceof FormData;
  const headers = new Headers(init.headers);
  if (!isFormData && init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return { body: body as T, headers: res.headers };
}

function extractLatencyMs(headers: Headers): number {
  const timingHeader = headers.get("X-RAG-Timing");
  if (timingHeader) {
    try {
      const timing = JSON.parse(timingHeader) as Record<string, unknown>;
      if (typeof timing.total_ms === "number") return Math.round(timing.total_ms);
    } catch {
      // Ignore malformed optional timing metadata; the response body remains usable.
    }
  }
  return 0;
}

// ── Types (mapped from Worker response shapes) ────────────────

export interface Domain {
  name: string;
  description: string;
  embedding_model: string | null;
  embedding_provider: string | null;
  created_at: string;
}

export interface DomainList {
  domains: Domain[];
}

export interface OperatorSession {
  operator: {
    email: string;
    subject: string;
    expiresAt: number | null;
  };
}

export interface CorpusStatusEntry {
  domain: string;
  has_schema: number;
  draft_count: number;
  file_count: number;
  ready_files: number;
  failed_files: number;
  staged_files: number;
  active_files: number;
  active_jobs: number;
  failed_jobs: number;
  state: string;
}

export interface KbStatus {
  domains: number;
  files: number;
  jobs: number;
  schemas: number;
  schema_drafts: number;
  entities: number;
  relationships: number;
  traces: number;
  eval_reports: number;
  recent_traces: number;
  recent_eval_reports: number;
}

export interface Job {
  id: string;
  domain: string;
  file_id: string;
  status: string;
  stage: string;
  created_at: string;
  updated_at: string;
  error: string | null;
  failure_classification?: string | null;
  replay_route?: string | null;
}

export interface JobList {
  jobs: Job[];
}

export interface FileEntry {
  id: string;
  domain: string;
  filename: string;
  mime: string | null;
  content_hash: string;
  size: number;
  status: string;
  created_at: string;
  updated_at: string;
  error: string | null;
}

export interface FileList {
  files: FileEntry[];
}

export interface ChunkEntry {
  id: string;
  domain: string;
  file_id: string;
  vector_id: string;
  page_start: number;
  page_end: number;
  text: string;
  content_hash: string | null;
  metadata: Record<string, unknown>;
}

export interface SearchResults {
  results: Array<{
    chunk_id: string;
    document: string;
    content: string;
    score: number;
    metadata: Record<string, unknown>;
  }>;
  mode: string;
  latency_ms: number;
}

export interface QueryResult {
  answer: string;
  citations: Array<{
    chunk_id: string;
    document: string;
    content: string;
    score: number;
    span?: string;
  }>;
  mode: string;
  latency_ms: number;
  confidence: number | null;
  trace_id: string | null;
}

export interface Trace {
  id: string;
  domain: string;
  question: string;
  answer: string | null;
  mode: string;
  latency_ms: number;
  created_at: string;
  citations: Array<{
    chunk_id: string;
    document: string;
    content: string;
    score: number;
    file_id: string | null;
    page_start: number;
    page_end: number;
  }>;
  confidence: Record<string, unknown> | null;
}

export interface TraceList {
  traces: Trace[];
}

export interface EvalReport {
  id: string;
  domain: string;
  kind: string;
  hit_rate: number | null;
  citation_rate: number | null;
  avg_latency_ms: number | null;
  created_at: string;
}

export interface EvalReportList {
  reports: EvalReport[];
}

export interface EmbeddingModel {
  id: string;
  provider: string;
  dimensions: number;
  selectable: boolean;
  vectorize_binding?: string;
  compatible_profile?: string;
}

export interface EmbeddingModelList {
  catalog_source: string;
  catalog_error?: string | null;
  free_ai_models?: EmbeddingModel[];
}

export interface SchemaRecord {
  id: string;
  domain: string;
  name: string;
  version: number;
  is_active: number;
  spec: Record<string, unknown>;
  created_at: string;
}

export interface SchemaDraft {
  id: string;
  domain: string;
  name: string;
  status: string;
  source: string;
  sample_count: number;
  spec: Record<string, unknown>;
  created_at: string;
}

export interface EntityRecord {
  id: string;
  domain: string;
  type: string;
  identity_key: string;
  display_name: string | null;
  field_values?: Record<string, unknown>;
  created_at?: string;
}

export interface RelationshipRecord {
  id: string;
  domain: string;
  rel_type: string;
  src_id: string;
  dst_id: string;
  source_display_name?: string | null;
  target_display_name?: string | null;
  evidence_file?: string | null;
  evidence_page?: number | null;
}

export interface SourceImportResult {
  source: string;
  files: FileEntry[];
  jobs: Job[];
  errors: Array<{ url?: string; ticker?: string; cik?: string; error: string }>;
}

export interface TraceDrilldown {
  trace_id: string;
  quality: Record<string, unknown>;
  trace: RawQueryTraceRecord;
}

export interface TraceExport {
  exported_at: string;
  summary: Record<string, unknown>;
  traces: RawQueryTraceRecord[];
}

// ── Raw Worker response shapes ─────────────────────────────────

interface RawDomainRecord {
  project: string;
  name: string;
  description: string;
  embedding_model: string | null;
  embedding_provider: string | null;
  created_at: string;
  updated_at: string;
}

interface RawFileRecord {
  id: string;
  project: string;
  domain: string;
  filename: string;
  mime: string | null;
  bytes: number;
  content_hash: string;
  status: string;
  last_error: string | null;
  uploaded_at: string;
  updated_at: string;
}

interface RawJobRecord {
  id: string;
  project: string;
  domain: string;
  file_id: string;
  stage: string;
  status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface RawSearchResult {
  document_id: string;
  chunk_id: string;
  chunk_content: string;
  score: number;
  metadata: Record<string, unknown>;
}

interface RawCitationRecord {
  index: number;
  document_id: string;
  chunk_id: string;
  file_id: string | null;
  filename: string | null;
  page_start: number;
  page_end: number;
  excerpt: string;
  span_terms?: string[];
  score: number;
  metadata: Record<string, unknown>;
}

interface RawQueryTraceRecord {
  id: string;
  project: string;
  domain: string;
  question: string;
  answer: string | null;
  citations: RawCitationRecord[];
  confidence: Record<string, unknown> | null;
  filters?: Record<string, unknown> | null;
  latency_ms: number | null;
  created_at: string;
}

interface RawEvalReportRecord {
  id: string;
  project: string;
  domain: string | null;
  kind: string;
  summary: Record<string, unknown>;
  rows: Record<string, unknown>[];
  created_at: string;
}

interface RawKbAnswerPayload {
  answer: string;
  citations: RawCitationRecord[];
  confidence: Record<string, unknown> | null;
  trace_id: string;
  answer_mode: string;
  route: string;
  question: string;
  data: RawSearchResult[];
}

interface RawSchemaRecord {
  id: string;
  project: string;
  domain: string;
  name: string;
  version: number;
  spec: Record<string, unknown>;
  is_active: number;
  created_at: string;
}

interface RawSchemaDraft {
  id: string;
  project: string;
  domain: string;
  name: string;
  spec: Record<string, unknown>;
  source: string;
  sample_count: number;
  status: string;
  created_at: string;
}

interface RawEntityRecord {
  id: string;
  project: string;
  domain: string;
  type: string;
  identity_key: string;
  display_name: string | null;
  field_values?: Record<string, unknown>;
  created_at?: string;
}

interface RawRelationshipRecord {
  id: string;
  project: string;
  domain: string;
  rel_type: string;
  src_id: string;
  dst_id: string;
  source_display_name?: string | null;
  target_display_name?: string | null;
  evidence_file?: string | null;
  evidence_page?: number | null;
}

interface RawChunkRecord {
  id: string;
  project: string;
  domain: string;
  file_id: string;
  vector_id: string;
  page_start: number;
  page_end: number;
  text: string;
  content_hash: string | null;
  metadata: Record<string, unknown>;
}

function toJob(j: RawJobRecord): Job {
  return {
    id: j.id,
    domain: j.domain,
    file_id: j.file_id,
    status: j.status,
    stage: j.stage,
    created_at: j.created_at,
    updated_at: j.updated_at,
    error: j.last_error,
  };
}

function toFile(f: RawFileRecord): FileEntry {
  return {
    id: f.id,
    domain: f.domain,
    filename: f.filename,
    mime: f.mime,
    content_hash: f.content_hash,
    size: f.bytes,
    status: f.status,
    created_at: f.uploaded_at,
    updated_at: f.updated_at,
    error: f.last_error,
  };
}

function traceMode(t: RawQueryTraceRecord): string {
  const confidenceRoute = t.confidence?.route;
  if (typeof confidenceRoute === "string" && confidenceRoute) return confidenceRoute;
  const filterRoute = t.filters?.route;
  if (typeof filterRoute === "string" && filterRoute) return filterRoute;
  return "recorded";
}

function toTrace(t: RawQueryTraceRecord): Trace {
  return {
    id: t.id,
    domain: t.domain,
    question: t.question,
    answer: t.answer,
    mode: traceMode(t),
    latency_ms: t.latency_ms ?? 0,
    created_at: t.created_at,
    confidence: t.confidence,
    citations: (t.citations ?? []).map((c) => ({
      chunk_id: c.chunk_id,
      document: c.filename ?? c.document_id,
      content: c.excerpt,
      score: c.score,
      file_id: c.file_id,
      page_start: c.page_start,
      page_end: c.page_end,
    })),
  };
}

// ── API methods ────────────────────────────────────────────────

export const api = {
  getSession: (): Promise<OperatorSession> =>
    request<OperatorSession>("/session"),

  getStatus: async (): Promise<KbStatus> => {
    const [res, schemas, drafts, entities, relationships, traces, reports] =
      await Promise.all([
        request<{ data: CorpusStatusEntry[] }>("/v1/kb/status"),
        request<{ data: RawSchemaRecord[] }>("/v1/kb/schemas"),
        request<{ data: RawSchemaDraft[] }>("/v1/kb/schemas/drafts?status=pending"),
        request<{ entities: RawEntityRecord[] }>("/v1/kb/entities?limit=500"),
        request<{ relationships: RawRelationshipRecord[] }>("/v1/kb/relationships?limit=500"),
        request<{ traces: RawQueryTraceRecord[] }>("/v1/kb/query/traces?limit=50"),
        request<{ reports: RawEvalReportRecord[] }>("/v1/kb/evals/reports?limit=50"),
      ]);
    const entries = res.data ?? [];
    const recentTraces = traces.traces?.length ?? 0;
    const recentReports = reports.reports?.length ?? 0;
    return {
      domains: entries.length,
      files: entries.reduce((sum, e) => sum + e.file_count, 0),
      jobs: entries.reduce((sum, e) => sum + e.active_jobs + e.failed_jobs, 0),
      schemas: schemas.data?.filter((s) => s.is_active === 1).length ?? 0,
      schema_drafts: drafts.data?.length ?? 0,
      entities: entities.entities?.length ?? 0,
      relationships: relationships.relationships?.length ?? 0,
      traces: recentTraces,
      eval_reports: recentReports,
      recent_traces: recentTraces,
      recent_eval_reports: recentReports,
    };
  },

  getDomains: async (): Promise<DomainList> => {
    const res = await request<{ data: RawDomainRecord[] }>(
      "/v1/kb/domains",
    );
    return {
      domains: (res.data ?? []).map((d) => ({
        name: d.name,
        description: d.description,
        embedding_model: d.embedding_model,
        embedding_provider: d.embedding_provider,
        created_at: d.created_at,
      })),
    };
  },

  createDomain: (data: {
    name: string;
    description?: string;
    embedding_model?: string;
  }) =>
    request<Domain>("/v1/kb/domains", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getFiles: async (domain?: string): Promise<FileList> => {
    const query = domain ? `?domain=${encodeURIComponent(domain)}` : "";
    const res = await request<{ data: RawFileRecord[] }>(
      `/v1/kb/files${query}`,
    );
    return {
      files: (res.data ?? []).map(toFile),
    };
  },

  getJobs: async (domain?: string): Promise<JobList> => {
    const params = new URLSearchParams({ limit: "500" });
    if (domain) params.set("domain", domain);
    const res = await request<{ jobs: RawJobRecord[] }>(
      `/v1/kb/jobs?${params}`,
    );
    return {
      jobs: (res.jobs ?? []).map(toJob),
    };
  },

  getTraces: async (domain?: string): Promise<TraceList> => {
    const params = new URLSearchParams({ limit: "50" });
    if (domain) params.set("domain", domain);
    const res = await request<{ traces: RawQueryTraceRecord[] }>(
      `/v1/kb/query/traces?${params}`,
    );
    return {
      traces: (res.traces ?? []).map(toTrace),
    };
  },

  exportTraces: (domain?: string): Promise<TraceExport> => {
    const params = new URLSearchParams({ limit: "50" });
    if (domain) params.set("domain", domain);
    return request<TraceExport>(`/v1/kb/query/traces/export?${params}`);
  },

  getTraceDrilldown: (id: string): Promise<TraceDrilldown> =>
    request<TraceDrilldown>(`/v1/kb/query/trace/${encodeURIComponent(id)}/drilldown`),

  getEvalReports: async (domain: string): Promise<EvalReportList> => {
    const res = await request<{ reports: RawEvalReportRecord[] }>(
      `/v1/kb/evals/reports?domain=${encodeURIComponent(domain)}`,
    );
    return {
      reports: (res.reports ?? []).map((r) => ({
        id: r.id,
        domain: r.domain ?? "",
        kind: r.kind,
        hit_rate:
          (r.summary?.hit_rate as number | undefined) ?? null,
        citation_rate:
          (r.summary?.citation_rate as number | undefined) ?? null,
        avg_latency_ms:
          (r.summary?.avg_latency_ms as number | undefined) ?? null,
        created_at: r.created_at,
      })),
    };
  },

  getEmbeddingModels: () =>
    request<EmbeddingModelList>("/v1/embedding-models"),

  getSchemas: async (domain?: string): Promise<SchemaRecord[]> => {
    const res = await request<{ data: RawSchemaRecord[] }>("/v1/kb/schemas");
    return (res.data ?? [])
      .filter((s) => !domain || s.domain === domain)
      .map((s) => ({
        id: s.id,
        domain: s.domain,
        name: s.name,
        version: s.version,
        is_active: s.is_active,
        spec: s.spec,
        created_at: s.created_at,
      }));
  },

  getSchemaDrafts: async (domain: string, status = "pending"): Promise<SchemaDraft[]> => {
    const res = await request<{ data: RawSchemaDraft[] }>(
      `/v1/kb/schemas/drafts?domain=${encodeURIComponent(domain)}&status=${encodeURIComponent(status)}`,
    );
    return (res.data ?? []).map((d) => ({
      id: d.id,
      domain: d.domain,
      name: d.name,
      status: d.status,
      source: d.source,
      sample_count: d.sample_count,
      spec: d.spec,
      created_at: d.created_at,
    }));
  },

  inferSchema: (data: {
    domain: string;
    input?: unknown;
    records?: Record<string, unknown>[];
    sample_texts?: string[];
    name?: string;
    save_draft?: boolean;
  }) => request<{ draft_id: string | null; spec: Record<string, unknown>; sample_count: number }>(
    "/v1/kb/schemas/infer",
    { method: "POST", body: JSON.stringify(data) },
  ),

  applySchemaDraft: (draftId: string) =>
    request<{ schema: RawSchemaRecord }>(
      `/v1/kb/schemas/drafts/${encodeURIComponent(draftId)}/apply`,
      { method: "POST" },
    ),

  discardSchemaDraft: (draftId: string) =>
    request<RawSchemaDraft>(
      `/v1/kb/schemas/drafts/${encodeURIComponent(draftId)}/discard`,
      { method: "POST" },
    ),

  reprocessDomainSchema: (domain: string) =>
    request<{ enqueued: number; jobs: RawJobRecord[] }>(
      `/v1/kb/schemas/${encodeURIComponent(domain)}/reprocess`,
      { method: "POST", body: JSON.stringify({}) },
    ),

  reprocessFile: (fileId: string) =>
    request<{ file_id: string; job: RawJobRecord }>(
      `/v1/kb/files/${encodeURIComponent(fileId)}/reprocess`,
      { method: "POST" },
    ),

  getJob: async (jobId: string): Promise<Job> => {
    const j = await request<RawJobRecord & {
      failure_classification?: { category?: string } | null;
      replay?: { route?: string };
    }>(`/v1/kb/ingest/jobs/${encodeURIComponent(jobId)}`);
    return {
      ...toJob(j),
      failure_classification: j.failure_classification?.category ?? null,
      replay_route: j.replay?.route ?? null,
    };
  },

  importSource: async (data: {
    domain: string;
    source: "url" | "edgar";
    auto_ingest?: boolean;
    config: {
      urls?: string[];
      tickers?: string[];
      ciks?: string[];
      forms?: string[];
      days?: number;
      per_ticker_per_form?: number;
      limit_total?: number;
    };
  }): Promise<SourceImportResult> => {
    const res = await request<{
      source: string;
      files?: RawFileRecord[];
      jobs?: RawJobRecord[];
      errors?: SourceImportResult["errors"];
    }>("/v1/kb/sources/import", { method: "POST", body: JSON.stringify(data) });
    return {
      source: res.source,
      files: (res.files ?? []).map(toFile),
      jobs: (res.jobs ?? []).map(toJob),
      errors: res.errors ?? [],
    };
  },

  getEntities: async (domain?: string): Promise<EntityRecord[]> => {
    const params = new URLSearchParams({ limit: "500" });
    if (domain) params.set("domain", domain);
    const res = await request<{ entities: RawEntityRecord[] }>(
      `/v1/kb/entities?${params}`,
    );
    return res.entities ?? [];
  },

  getRelationships: async (domain?: string): Promise<RelationshipRecord[]> => {
    const params = new URLSearchParams({ limit: "500" });
    if (domain) params.set("domain", domain);
    const res = await request<{ relationships: RawRelationshipRecord[] }>(
      `/v1/kb/relationships?${params}`,
    );
    return res.relationships ?? [];
  },

  getChunks: async (domain?: string, fileId?: string): Promise<ChunkEntry[]> => {
    const params = new URLSearchParams({ limit: "500" });
    if (domain) params.set("domain", domain);
    if (fileId) params.set("file_id", fileId);
    const res = await request<{ chunks: RawChunkRecord[] }>(
      `/v1/kb/chunks?${params}`,
    );
    return res.chunks ?? [];
  },

  backfillRelationships: (domain: string) =>
    request<unknown>("/v1/kb/relationships/backfill", {
      method: "POST",
      body: JSON.stringify({ domain }),
    }),

  search: async (data: {
    domain: string;
    query: string;
    mode?: string;
    top_k?: number;
    rerank?: boolean;
    rerank_model?: string;
    mmr?: boolean;
  }): Promise<SearchResults> => {
    const { body: res, headers } = await requestWithHeaders<{
      project: string;
      domain: string;
      index_id: string;
      data: RawSearchResult[];
    }>("/v1/kb/search", { method: "POST", body: JSON.stringify(data) });
    return {
      results: (res.data ?? []).map((r) => ({
        chunk_id: r.chunk_id,
        document: r.document_id,
        content: r.chunk_content,
        score: r.score,
        metadata: r.metadata,
      })),
      mode: data.mode ?? "auto",
      latency_ms: extractLatencyMs(headers),
    };
  },

  query: async (data: {
    domain: string;
    question: string;
    mode?: string;
    top_k?: number;
    answer_mode?: string;
    answer_model?: string;
    rerank?: boolean;
    rerank_model?: string;
    mmr?: boolean;
    query_rewrite?: boolean;
    query_decompose?: boolean;
    scope?: string;
  }): Promise<QueryResult> => {
    const { body: res, headers } = await requestWithHeaders<RawKbAnswerPayload>(
      "/v1/kb/query",
      { method: "POST", body: JSON.stringify(data) },
    );
    const confidence = res.confidence as Record<string, unknown> | null;
    const confidenceScore =
      typeof confidence?.score === "number"
        ? confidence.score
        : typeof confidence?.value === "number"
          ? confidence.value
          : null;
    return {
      answer: res.answer,
      citations: (res.citations ?? []).map((c) => ({
        chunk_id: c.chunk_id,
        document: c.filename ?? c.document_id,
        content: c.excerpt,
        score: c.score,
        span: c.span_terms?.join(" "),
      })),
      mode: res.answer_mode ?? res.route ?? "extractive",
      latency_ms: extractLatencyMs(headers),
      confidence: confidenceScore,
      trace_id: res.trace_id ?? null,
    };
  },

  uploadFile: async (domain: string, file: File, opts?: {
    embedding_model?: string;
    markdown_conversion?: string;
  }): Promise<{ file_id: string }> => {
    const form = new FormData();
    form.set("domain", domain);
    form.set("file", file);
    if (opts?.embedding_model) form.set("embedding_model", opts.embedding_model);
    if (opts?.markdown_conversion) form.set("markdown_conversion", opts.markdown_conversion);
    const res = await request<RawFileRecord>("/v1/kb/files/upload", {
      method: "POST",
      body: form,
    });
    return { file_id: res.id };
  },

  ingestText: (data: {
    domain: string;
    text: string;
    title?: string;
    type?: string;
  }) => request<unknown>("/v1/kb/ingest/text", {
    method: "POST",
    body: JSON.stringify(data),
  }),

  ingestRun: (data: {
    domain: string;
    async?: boolean;
    markdown_conversion?: string;
  }) => request<{ run_id?: string }>("/v1/kb/ingest/run", {
    method: "POST",
    body: JSON.stringify(data),
  }),

  runAnswerEval: (data: {
    domain: string;
    cases: Array<{ id: string; query: string; expected_text?: string }>;
    mode?: string;
    answer_mode?: string;
    ai_judge?: boolean;
  }) => request<unknown>("/v1/kb/evals/query", {
    method: "POST",
    body: JSON.stringify(data),
  }),

  runSearchEval: (data: {
    domain: string;
    cases: Array<{
      id: string;
      query: string;
      expected_ids?: string[];
      expected_text?: string;
    }>;
    mode?: string;
    top_k?: number;
  }) => request<unknown>("/v1/kb/evals/search", {
    method: "POST",
    body: JSON.stringify(data),
  }),
};
