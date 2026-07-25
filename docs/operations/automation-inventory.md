---
title: Automation inventory and Foundry evidence contract
description: Auth-safe health, sanitized API/search evidence, ingestion/index lifecycle, storage ownership, and maintenance-only authority for the Knowledge Base RAG Worker. Consumed by the Foundry coverage audit.
---

# Automation inventory and Foundry evidence contract

> Project-side contract for the **`ai-infrastructure-toolbox-automation`**
> capability. Code is authoritative for behavior (`cloudflare/worker/src/`,
> `cloudflare/worker/wrangler.jsonc`); this page records the sanitized evidence
> and recovery ownership consumed by Foundry. The central capability
> specification moves with the Foundry control plane and is not duplicated
> here.

Knowledge Base is **maintenance-only** Toolbox infrastructure and the only
fleet `RAG_SERVICE`. This inventory exists so fleet automation can verify
auth, ingestion/index, storage, and cited-search health without issuing
private corpus queries, logging retrieved chunks, or expanding product scope.

## Maintenance-only authority

| Action | Allowed without approval | Requires approval |
| --- | --- | --- |
| Read-only health/auth/metadata probes (`/healthz`, `/readyz`, `/metrics`, 401 probes) | yes | — |
| Bounded queue retry within existing policy | yes (already enforced in code) | — |
| Registry-approved idempotent re-ingest via existing routes | yes | — |
| Rotate `RAG_SERVICE_KEYS`, change providers, change spend | no | yes |
| Change rate limits, D1 schema, Vectorize index metadata, or migrations | no | yes |
| Production deploy or `wrangler d1 migrations apply` | no (manual `pnpm deploy`) | yes |
| New public corpus, schema template, or product surface | no | yes |
| Recreate a sibling `rag-service` | no (release gate `audit:sibling-rag-service --require-retired`) | n/a |

Automation MUST record a PR + pending deploy approval when a critical patch
passes checks. It MUST NOT deploy, migrate, rotate credentials, or recreate
the retired sibling RAG service.

## APIs, Worker, and auth

| Surface | Route | Auth | Sanitized evidence |
| --- | --- | --- | --- |
| Health | `GET /v1/healthz`, `GET /healthz` | **public** (before `requireServiceKey`) | `ok`, `d1`, `d1_schema`, `vectorize`, `r2`, `version`, `deploy_fingerprint` — no corpus query |
| Readiness | `GET /readyz` | **public** | `status: ok\|degraded`, db/vector/object sub-status, worker version + fingerprint |
| Metrics | `GET /metrics` | **public** | Prometheus-format gauges: `kb_worker_info`, `kb_worker_ready`, `kb_d1_schema_ready`, isolate counters — no corpus content |
| Testing UI | `GET /`, `GET /ui` | **public** (operator HTML) | no private data |
| Legacy route aliases | `app.all('*')` → `/v1/kb/*` | public for unauthenticated 401 probe; `requireServiceKey` after | 401 without key, redirected to `/v1/kb/*` |
| Projects | `GET/POST /v1/kb/projects`, `GET /v1/kb/projects/:project/status` | `RAG_SERVICE_KEYS` (X-RAG-Key or Bearer) | project name, domain count, corpus status — no document contents |
| Indexes | `GET/POST /v1/indexes`, `DELETE /v1/indexes/:id`, `POST /v1/indexes/:id/ingest[-vectors]`, `GET /v1/indexes/:id/documents`, `POST /v1/indexes/:id/query[-vector\|-benchmark]` | service key | index metadata, doc counts, vector counts — no chunk text in list views |
| Embedding models | `GET /v1/embedding-models` | service key | model id, provider, dimensions, enabled flag |
| Domains | `GET/POST /v1/kb/domains` | service key | domain name, embedding model — no corpus text |
| Schemas | `GET/POST /v1/kb/schemas`, `GET /v1/kb/schemas/:domain/active`, `POST /v1/kb/schemas/:domain/reprocess`, `POST /v1/kb/schemas/infer[-upload]`, `GET/POST /v1/kb/schemas/drafts[/:draft_id/(apply\|discard)]` | service key | schema spec, draft status — no source document bodies |
| Files | `GET/POST /v1/kb/files`, `GET /v1/kb/files/:file_id`, `POST /v1/kb/files/:file_id/reprocess`, `DELETE /v1/kb/files/:file_id`, `POST /v1/kb/files/upload` | service key | file metadata, status, last_error (truncated 500 chars) — no chunk text |
| Stored chunks | `GET /v1/kb/chunks` | service key | bounded tenant-scoped excerpts with file and page provenance; private corpus content, operator-only |
| Status / jobs | `GET /v1/kb/status`, `GET /v1/kb/jobs`, `GET /v1/kb/ingest/jobs/:job_id`, `GET /v1/kb/ingest/runs/:run_id` | service key | job status, stage, attempts, `failure_classification` — no document contents |
| Sources | `GET /v1/kb/sources`, `POST /v1/kb/sources/import`, `GET/POST /v1/kb/source-sets[/:id/actions]` | service key | source metadata, action receipts — no corpus text |
| Ingest | `POST /v1/kb/ingest/record`, `POST /v1/kb/ingest/text`, `POST /v1/kb/ingest/run` | service key | job id, enqueued count, queue backlog, workflow instance id — no source text in durable evidence |
| Parse artifacts | `GET /v1/kb/parse-artifacts/:hash` | service key | parse output keyed by content hash (operator-only) |
| Entities / relationships | `GET/POST /v1/kb/entities[/:id/(lineage\|relationships\|search)]`, `GET/POST /v1/kb/relationships[/backfill]` | service key | entity metadata, relationship edges — no chunk text |
| Search / query | `POST /v1/kb/search`, `POST /v1/kb/query`, `POST /v1/kb/query/stream` | service key | cited `(file_id, page, excerpt)` per "cited or it didn't happen"; **durable evidence (job/trace routes) excludes retrieved chunk text** |
| Sessions | `GET/POST /v1/kb/sessions[/:id[/messages]]` | service key | session metadata, message metadata — no source chunks in trace exports |
| Traces / evals | `GET /v1/kb/query/traces[/export\|/compare\|/:id[/drilldown]]`, `POST /v1/kb/evals/(search\|parse\|query)`, `GET /v1/kb/evals/(reports\|summary\|reports/:id)` | service key | trace metadata, eval metrics (hit/citation rates, latency p95s) — no prompt or chunk text in eval reports |

**Fail-closed auth:** `app.use('/v1/*', requireServiceKey)` runs after the
public health routes. Invalid/missing key → `401`. `RAG_SERVICE_KEYS` is a
JSON map of `{key: tenant}`; `RAG_SERVICE_KEYS_APPEND` and
`RAG_SERVICE_PROOF_KEYS` extend it. Constant-time comparison.

**Cited-or-it-didn't-happen invariant:** every retrieval/answer route
terminates at a retrievable `(file_id, page, excerpt)` triple. The stored-chunk
route makes that evidence inspectable to an authenticated operator. Foundry
evidence snapshots must still exclude prompts, retrieved chunks, and corpus
content.

## Background and index lifecycle

Authoritative config: `cloudflare/worker/wrangler.jsonc` (`queues`,
`workflows`) and `cloudflare/worker/src/index.ts` (`KbIngestWorkflow`,
`processIngestQueue`). See also [`operations/jobs.md`](jobs.md).

**No scheduled (cron) jobs.** The Worker defines no `[triggers]` / `scheduled`
handler. The only async path is ingestion via Queues + Workflows.

| Job | Trigger | Bounds | Timeout | Concurrency | Retries | Idempotency / dedup | Failure state | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ingest queue consumer | `POST /v1/kb/ingest/run` (default async) | `max_batch_size: 5`, `max_batch_timeout: 10` | parse 45s (`INGEST_PARSE_TIMEOUT_MS`); Workflow enqueue step 1m | 1 consumer | queue `max_retries: 3`; poison-input ack after `INGEST_QUEUE_MAX_ATTEMPTS: 5`; per-file `message.retry` exponential backoff capped at 300s | chunk IDs deterministic (`deterministicId('chk', tenant:indexId:external_id:i:content)`); D1 `INSERT OR REPLACE` by chunk ID; Vectorize upsert by vector ID; parse artifact keyed by content hash; `idempotency_key` + `idempotent_replay` on ingest routes | job `status='failed'` + `last_error` + `attempts` in D1; `failure_classification` on job detail route | `cloudflare/worker/src/index.ts` `processIngestQueue`, `runKbIngest` |
| Ingest workflow | same trigger, Workflow-backed | 1 enqueue step | 1m step timeout | 1 instance per run | Workflow step retries | durable run id in `kb_ingest_jobs.workflow_id` | workflow instance status | `KbIngestWorkflow` |
| Overlap control | per-file lease | `INGEST_JOB_LEASE_MS: 5m` | n/a | per locked_by | n/a | `isIngestJobLeaseActive` skips files with `status='running'` + `locked_by != current` + `locked_at` within 5m | skipped → `reason: 'lease_active'` | `runKbIngest` |
| Failure classification | every ingest failure | n/a | n/a | n/a | n/a | n/a | `classifyIngestFailure` → `{category, retryable, message (≤500 chars)}`: `embedding_readiness`, `missing_source_object` (not retryable), `parse_empty` (not retryable), `parse_timeout`, `validation` (not retryable), `unknown` | `classifyIngestFailure` |
| Replay | `POST /v1/kb/files/:file_id/reprocess`, `POST /v1/kb/schemas/:domain/reprocess`, `POST /v1/kb/source-sets/:id/actions` (`requeue_all\|requeue_failed\|requeue_pending`) | bounded by pending file set | n/a | n/a | re-queue | idempotent re-ingest by content hash | resets file to `pending` and re-queues | reprocess routes |
| Query cache | `RAG_SHARED_QUERY_CACHE_ENABLED`, `RAG_SHARED_EMBEDDING_CACHE_ENABLED` | `RAG_CACHE_TTL_SECONDS: 300`, `RAG_CACHE_MAX_ENTRIES: 1000` | n/a | per-isolate | n/a | lexical precheck before embedding/Vectorize | cache miss → cold path | `src/cache.ts` |
| CI gate | GitHub Actions | push/PR | job-level | 1 | n/a | n/a | red CI | `cloudflare/worker/.github/workflows/*` |
| Deploy | manual `pnpm deploy` (`wrangler deploy`) | manual | job-level | 1 | n/a | n/a | blocked deploy | operator |

**Freshness:** the deployed corpus is **opt-in**. There is no scheduled
freshness window because corpora do not auto-refresh. `corpusStatus` reports
per-domain `state` (`no_schema`, `schema_ready`, `schema_draft`,
`files_staged`, `ready`, `ingesting`, `failed`). The Foundry snapshot treats
"freshness" as **on-demand by explicit ingestion run** — a domain in
`ready` with no recent ingest job is not stale, it is *stable*. A domain in
`ingesting` with no recent job progress is *stale* and MUST be reported.

## Storage ownership and recovery

| Store | Binding | Owner | Authoritative source | Backup / export / reconstruction | Migration guard | Last verification |
| --- | --- | --- | --- | --- | --- | --- |
| D1 `rag-db` | `DB` | this Worker | migrations `0001`–`0007` (`cloudflare/worker/migrations/`) | Cloudflare D1 dashboard export; metadata reconstructable from R2 raw docs + re-ingest | `pnpm check` + `pnpm run audit:d1-migrations` gate; `wrangler d1 migrations apply` is manual and requires approval | `/v1/healthz` `d1_schema: true` |
| R2 `rag-raw-docs` | `RAW_DOCS` | this Worker | uploaded source files | R2 is the authoritative source for raw documents; re-ingest from R2 rebuilds D1 metadata + Vectorize vectors | n/a (source of truth) | `/v1/healthz` `r2: true` |
| Vectorize `rag-gemini-1536` | `VECTORIZE` | this Worker | derived from R2 + D1 | **reconstructable**: re-ingest from R2 raw docs via `POST /v1/kb/files/:file_id/reprocess` or `POST /v1/kb/schemas/:domain/reprocess` | `pnpm run audit:vectorize-embedding-bindings` + `audit:vectorize-metadata-indexes` | `/v1/healthz` `vectorize: true` |
| Vectorize `rag-embedding-384/768/1024` | `VECTORIZE_384/768/1024` | this Worker | derived from R2 + D1 | same reconstruction path | same audit gates | `/readyz` `vector.ok` |
| Workers AI | `AI` | this Worker | Cloudflare | n/a (managed service) | n/a | `/v1/healthz` via embedding smoke |
| Free AI gateway | `FREE_AI` service binding | this Worker (consumer) | `free-ai` repo | n/a (delegated to free-ai) | `pnpm run audit:free-ai-embedding-contract` | `/v1/embedding-models` live |
| Analytics Engine `knowledgebase_rag_events` | `RAG_ANALYTICS` | this Worker | per-query events | ephemeral; not a source of truth | n/a | n/a |
| Service keys | `RAG_SERVICE_KEYS` secret | operator | wrangler secret | `wrangler secret put`; never commit | pre-push secret scan | `readiness:auth` |
| Demo corpora | `domains/sec/`, `domains/legal/` | operator (opt-in) | explicit ingestion run | re-run ingestion from source files | n/a | `smoke:rag-crud:embedding-model` |

**Private data exclusion:** durable evidence (job/trace/eval routes, logs)
stores **no prompts, retrieved chunks, source document text, or authorization
headers**. `last_error` is truncated to 500 chars. Foundry snapshots MUST
NOT copy corpus content, retrieved chunks, or any credential-shaped value.

## Deploy path

- **Target:** Cloudflare Worker `knowledgebase`,
  `https://knowledgebase.sarthakagrawal927.workers.dev` + custom domain
  `search.sassmaker.com`.
- **Trigger:** manual `pnpm deploy` (`wrangler deploy`). `main` is releasable
  and green but is **not** an automatic production trigger.
- **Pre-deploy gate:** `pnpm run predeploy:local` (the full local pre-deploy
  gate).
- **Deploy fingerprint:** `WORKER_DEPLOY_FINGERPRINT =
  'knowledgebase-a-plus-evidence-2026-06-23'`; enforced by
  `smoke:legacy-routes` and `readiness:full-port`.
- **Post-deploy smoke:** `curl /v1/healthz`; `pnpm run readiness:auth` with a
  service key; `pnpm run smoke:legacy-routes --require-complete`.
- **Never** run `wrangler deploy` or `wrangler d1 migrations apply` from an
  agent session.

## Foundry evidence contract

The Foundry coverage audit (`pnpm fleet:ai-infra-audit` in `saas-maker`)
reads this inventory and the live routes below to emit a sanitized snapshot.
The snapshot contains **only**: route name, HTTP status, dependency
readiness (D1/R2/Vectorize), deploy fingerprint, job lifecycle bounds,
ingest failure classification counts, corpus state, storage ownership, and
recovery owner. It contains **no** prompts, retrieved chunks, source
document text, corpus content, service keys, or any credential-shaped
string.

| Contract field | Source | Freshness window |
| --- | --- | --- |
| `auth_safe_health` | `GET /v1/healthz` (public, no corpus query) + 401 probe on `/v1/indexes` | per-request |
| `structured_api_evidence` | `GET /v1/kb/jobs` + `GET /v1/kb/status` (failure_classification, no chunk text) | per-request |
| `provider_cost_and_degradation` | n/a (KB has no direct provider spend; embedding/synth delegated to `free-ai` and reported there) | n/a |
| `background_and_index_lifecycle` | this page + `GET /v1/kb/ingest/runs/:run_id` (workflow status) | per-request |
| `storage_ownership_and_recovery` | this page table + `/readyz` dependency flags | per-deploy |
| `maintenance_only_authority` | this page table | per-deploy |

## Accepted exceptions and blockers

- **S-grade proof** is blocked on `KARTE_SESSION_COOKIE` /
  `STARBOARD_SESSION_COOKIE` for authenticated consumer smokes. Not an
  automation gap; documented in `STATUS.md`.
- **AI Gateway cache** is implemented but not enabled (Wrangler OAuth blocked
  gateway creation at the time). Revisit when unblocked.
- **Semantic p99 < 300 ms on completely unique cold misses** is deferred;
  query/embedding caches cover hot/repeated questions, not first-seen misses.
- **Public multi-user hosting** is deferred until auth, per-project
  authorization, upload limits, rate limits, job cancellation, backup drills,
  and log redaction land.
- **`/api/ai` vs `/api-ai.json` mismatch** in `app/public/` is a known docs
  issue (see `STATUS.md` Unresolved questions); not an automation gap.
