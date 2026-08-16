import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import {
  INGEST_JOB_LEASE_MS,
  INGEST_PARSE_TIMEOUT_MS,
  INGEST_QUEUE_MAX_ATTEMPTS,
  type EdgarFilingCandidate,
  type EdgarSubmissionsResponse,
  type EdgarTickerRow,
  type SourceImportBody,
} from './app-types';
import { jsonRecord } from './app-utils';
import type { Env, JsonRecord, KbIngestQueueMessage } from './types';
import type { FileRecord, IngestJobRecord } from './kb-metadata-repository';
import { safeObjectKeySegment } from './kb-metadata-repository';

export class KbIngestWorkflow extends WorkflowEntrypoint<Env, KbIngestQueueMessage> {
  async run(event: Readonly<WorkflowEvent<KbIngestQueueMessage>>, step: WorkflowStep): Promise<JsonRecord> {
    const payload = await step.do('validate ingest payload', async () => {
      const body = event.payload;
      if (!body || body.kind !== 'kb_ingest' || !body.project || !body.domain) {
        throw new Error('invalid knowledgebase ingest payload');
      }
      return {
        kind: 'kb_ingest' as const,
        project: body.project,
        domain: body.domain,
        ...(body.run_id ? { run_id: body.run_id } : {}),
        ...(body.file_ids ? { file_ids: body.file_ids } : {}),
        ...(body.markdown_conversion ? { markdown_conversion: body.markdown_conversion } : {}),
        ...(body.vision_ocr_model ? { vision_ocr_model: body.vision_ocr_model } : {}),
        ...(body.chunking ? { chunking: body.chunking } : {}),
      };
    });

    await step.do(
      'enqueue ingest queue message',
      {
        retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
        timeout: '1 minute',
      },
      async () => {
        if (!this.env.INGEST_QUEUE) throw new Error('INGEST_QUEUE is not configured');
        const response = await this.env.INGEST_QUEUE.send(payload);
        return {
          run_id: payload.run_id ?? null,
          backlog_count: response.metadata.metrics.backlogCount,
          backlog_bytes: response.metadata.metrics.backlogBytes,
        };
      },
    );

    return {
      run_id: payload.run_id ?? null,
      project: payload.project,
      domain: payload.domain,
      queued: true,
    };
  }
}

export function summarizeIngestRun(runId: string, jobs: IngestJobRecord[]): JsonRecord {
  const by_status: Record<string, number> = {};
  const by_stage: Record<string, number> = {};
  for (const job of jobs) {
    by_status[job.status] = (by_status[job.status] ?? 0) + 1;
    by_stage[job.stage] = (by_stage[job.stage] ?? 0) + 1;
  }
  const total = jobs.length;
  const succeeded = by_status.succeeded ?? 0;
  const failed = by_status.failed ?? 0;
  const completed = succeeded + failed;
  const active = total - completed;
  const state = total === 0 ? 'not_found' : active > 0 ? 'running' : failed > 0 ? 'failed' : 'succeeded';
  return {
    run_id: runId,
    state,
    total_jobs: total,
    completed_jobs: completed,
    succeeded_jobs: succeeded,
    failed_jobs: failed,
    active_jobs: active,
    progress: total > 0 ? completed / total : 0,
    by_status,
    by_stage,
    failure_classification: failed > 0 ? classifyIngestFailure(jobs.find((job) => job.status === 'failed')?.last_error ?? null) : null,
    replayable: jobs.length > 0,
    done: total > 0 && active === 0,
  };
}

export function classifyIngestFailure(error: unknown): JsonRecord {
  const message = String(error instanceof Error ? error.message : (error ?? '')).trim();
  const lower = message.toLowerCase();
  let category = 'unknown';
  let retryable = true;
  if (!message) {
    category = 'none';
    retryable = false;
  } else if (lower.includes('embedding') || lower.includes('vectorize') || lower.includes('free-ai')) {
    category = 'embedding_readiness';
  } else if (lower.includes('r2 object not found') || lower.includes('not found')) {
    category = 'missing_source_object';
    retryable = false;
  } else if (lower.includes('no parseable text') || lower.includes('empty file') || lower.includes('text must be non-empty')) {
    category = 'parse_empty';
    retryable = false;
  } else if (lower.includes('parse timed out') || lower.includes('parse timeout')) {
    category = 'parse_timeout';
  } else if (
    lower.includes('schema') ||
    lower.includes('domain is required') ||
    lower.includes('document content is required') ||
    lower.includes('data must contain at least one record')
  ) {
    category = 'validation';
    retryable = false;
  }
  return {
    category,
    retryable,
    message: message.slice(0, 500),
  };
}

export function isIngestJobLeaseActive(job: IngestJobRecord, now: number, leaseMs: number, lockedBy: string): boolean {
  if (job.status !== 'running' || !job.locked_by || job.locked_by === lockedBy) return false;
  if (!job.locked_at) return false;
  const lockedAt = Date.parse(job.locked_at);
  if (!Number.isFinite(lockedAt)) return false;
  return now - lockedAt < leaseMs;
}

export function withParseTimeout<T>(promise: Promise<T>, timeoutMs: number, filename: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`parse timed out after ${timeoutMs}ms for ${filename}`)), timeoutMs)),
  ]);
}

export function chunkPreviewFromChunks(chunks: Array<{ id?: string; content?: string; chunkIndex?: number; chunk_index?: number }>, limit = 3): JsonRecord[] {
  return chunks.slice(0, limit).map((chunk, index) => ({
    chunk_id: chunk.id ?? null,
    chunk_index: typeof chunk.chunkIndex === 'number' ? chunk.chunkIndex : typeof chunk.chunk_index === 'number' ? chunk.chunk_index : index,
    text_preview: String(chunk.content ?? '').slice(0, 240),
  }));
}

export function chunkPreviewFromFileResults(files: JsonRecord[], limit = 3): JsonRecord[] {
  return files.flatMap((file) => (Array.isArray(file.chunk_preview) ? file.chunk_preview.map(jsonRecord) : [])).slice(0, limit);
}

export function ingestSafetyEvidence(input: {
  idempotencyKey?: string | undefined;
  contentHash?: string | undefined;
  chunkPreview?: JsonRecord[] | undefined;
  replayRoute?: string | null;
  failure?: unknown;
  idempotentReplay?: boolean;
}): JsonRecord {
  return {
    idempotency_key: input.idempotencyKey || input.contentHash || null,
    content_hash: input.contentHash ?? null,
    idempotent: true,
    idempotent_replay: input.idempotentReplay === true,
    chunk_preview: input.chunkPreview ?? [],
    replayable: Boolean(input.replayRoute),
    replay_route: input.replayRoute ?? null,
    failure_classification: input.failure === undefined ? null : classifyIngestFailure(input.failure),
  };
}

export function sourceSetId(domain: string): string {
  return `domain:${domain}`;
}

export function sourceSetDomain(id: string): string | null {
  return id.startsWith('domain:') ? id.slice('domain:'.length).trim() : null;
}

export function summarizeSourceSets(files: FileRecord[]): JsonRecord[] {
  const grouped = new Map<string, FileRecord[]>();
  for (const file of files) {
    const rows = grouped.get(file.domain) ?? [];
    rows.push(file);
    grouped.set(file.domain, rows);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, rows]) => {
      const by_status: Record<string, number> = {};
      const by_mime: Record<string, number> = {};
      let bytes = 0;
      for (const file of rows) {
        by_status[file.status] = (by_status[file.status] ?? 0) + 1;
        by_mime[file.mime || 'unknown'] = (by_mime[file.mime || 'unknown'] ?? 0) + 1;
        bytes += file.bytes;
      }
      const failed = by_status.failed ?? 0;
      const pending = by_status.pending ?? 0;
      const indexing = by_status.indexing ?? 0;
      const lastUpdated =
        rows
          .map((file) => file.updated_at)
          .sort()
          .at(-1) ?? null;
      return {
        id: sourceSetId(domain),
        domain,
        file_count: rows.length,
        bytes,
        by_status,
        by_mime,
        failed_files: failed,
        pending_files: pending,
        active_files: indexing,
        attention_files: failed + pending + indexing,
        last_updated_at: lastUpdated,
      };
    });
}

export function filesForSourceSetAction(files: FileRecord[], action: string): FileRecord[] {
  if (action.endsWith('_failed')) return files.filter((file) => file.status === 'failed');
  if (action.endsWith('_pending')) return files.filter((file) => file.status === 'pending');
  if (action.endsWith('_ready')) return files.filter((file) => file.status === 'ready');
  return files;
}

export function recordFromDocumentMetadata(metadata: JsonRecord): JsonRecord | null {
  const record = metadata.record;
  return record && typeof record === 'object' && !Array.isArray(record) ? (record as JsonRecord) : null;
}

export function parseArtifactKey(domain: string, contentHash: string): string {
  return `parse/${safeObjectKeySegment(domain)}/${contentHash}.json`;
}

export function virtualInputFilename(prefix: string, title: string, extension: string, contentHash: string): string {
  const safeTitle = safeObjectKeySegment(title || 'untitled') || 'untitled';
  return `${prefix}-${safeTitle}-${contentHash.slice(0, 8)}.${extension}`;
}

export function filenameForImportedUrl(rawUrl: string, contentType: string | null): string {
  try {
    const parsed = new URL(rawUrl);
    const pathname = decodeURIComponent(parsed.pathname);
    const last = pathname.split('/').filter(Boolean).pop() || parsed.hostname || 'document';
    if (last.includes('.')) return safeObjectKeySegment(last);
    if (contentType?.includes('html')) return `${safeObjectKeySegment(last)}.html`;
    if (contentType?.includes('pdf')) return `${safeObjectKeySegment(last)}.pdf`;
    if (contentType?.includes('json')) return `${safeObjectKeySegment(last)}.json`;
    return `${safeObjectKeySegment(last)}.txt`;
  } catch {
    return contentType?.includes('html') ? 'document.html' : 'document.txt';
  }
}

export function secUserAgent(env: Env, config?: SourceImportBody['config']): string {
  return config?.user_agent?.trim() || env.RAG_SEC_USER_AGENT?.trim() || 'knowledgebase-rag-service contact@example.invalid';
}

export function secHeaders(userAgent: string): HeadersInit {
  return {
    'User-Agent': userAgent,
    Accept: 'application/json,text/html,application/xhtml+xml,text/plain,*/*',
  };
}

export function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

export function normalizeCik(value: string | number): string {
  return String(value).replace(/\D/g, '').padStart(10, '0').slice(-10);
}

export function cikArchiveSegment(cik: string): string {
  return String(Number(cik));
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? '')) : [];
}

export function edgarRecentValue(recent: Record<string, unknown[]>, key: string, index: number): string {
  const value = recent[key]?.[index];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

export function filingWithinDays(filingDate: string, days: number): boolean {
  if (!Number.isFinite(days) || days <= 0) return true;
  const timestamp = Date.parse(`${filingDate}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return false;
  return timestamp >= Date.now() - days * 24 * 60 * 60 * 1000;
}

export async function fetchJson<T>(url: string, userAgent: string): Promise<T> {
  const response = await fetch(url, { headers: secHeaders(userAgent) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function secTickerLookup(userAgent: string): Promise<Map<string, EdgarTickerRow>> {
  const raw = await fetchJson<Record<string, EdgarTickerRow>>('https://www.sec.gov/files/company_tickers.json', userAgent);
  const out = new Map<string, EdgarTickerRow>();
  for (const row of Object.values(raw)) {
    if (row?.ticker) out.set(normalizeTicker(row.ticker), row);
  }
  return out;
}

export async function edgarCandidatesForCompany(input: {
  ticker: string | null;
  cik: string;
  userAgent: string;
  forms: Set<string>;
  days: number;
  perTickerPerForm: number;
  remaining: number;
}): Promise<EdgarFilingCandidate[]> {
  const submissions = await fetchJson<EdgarSubmissionsResponse>(`https://data.sec.gov/submissions/CIK${input.cik}.json`, input.userAgent);
  const recent = submissions.filings?.recent ?? {};
  const forms = asStringArray(recent.form);
  const seenPerForm = new Map<string, number>();
  const out: EdgarFilingCandidate[] = [];
  for (let i = 0; i < forms.length && out.length < input.remaining; i += 1) {
    const form = forms[i]?.trim();
    if (!form || !input.forms.has(form)) continue;
    if ((seenPerForm.get(form) ?? 0) >= input.perTickerPerForm) continue;
    const filingDate = edgarRecentValue(recent, 'filingDate', i);
    if (!filingWithinDays(filingDate, input.days)) continue;
    const accession = edgarRecentValue(recent, 'accessionNumber', i);
    const primaryDocument = edgarRecentValue(recent, 'primaryDocument', i);
    if (!accession || !primaryDocument) continue;
    const accessionNoDashes = accession.replace(/-/g, '');
    const url = `https://www.sec.gov/Archives/edgar/data/${cikArchiveSegment(input.cik)}/${accessionNoDashes}/${primaryDocument}`;
    out.push({
      ticker: input.ticker,
      cik: input.cik,
      cikNumber: cikArchiveSegment(input.cik),
      companyName: submissions.name ?? null,
      accession,
      accessionNoDashes,
      form,
      filingDate,
      primaryDocument,
      url,
      filename: `${input.ticker ?? input.cik}_${form}_${filingDate}_${accessionNoDashes}_${primaryDocument}`.replace(/[^A-Za-z0-9_.-]+/g, '_'),
    });
    seenPerForm.set(form, (seenPerForm.get(form) ?? 0) + 1);
  }
  return out;
}

export { INGEST_QUEUE_MAX_ATTEMPTS };
