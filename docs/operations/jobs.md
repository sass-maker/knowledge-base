---
title: Async jobs and scheduled work
description: Queues + Workflows ingestion is the only async path. There are no cron/scheduled jobs in the Worker.
---

# Async jobs and scheduled work

> Code is authoritative for the binding config: see
> `cloudflare/worker/wrangler.jsonc` (`queues`, `workflows`) and
> `cloudflare/worker/src/index.ts` (`KbIngestWorkflow`).

## No scheduled (cron) jobs

The Worker defines **no** `[triggers]` / `scheduled` handler. There is no cron
in `wrangler.jsonc` and no `scheduled(event, env, ctx)` export in
`cloudflare/worker/src/index.ts`. Do not add one without updating this page and
`architecture/decisions.md`.

If a periodic task is ever needed (e.g. embedding-cache eviction, stale-job
sweep, eval rollups), it belongs behind a `[triggers]` entry in
`wrangler.jsonc` and a `scheduled` handler in the Worker, and must be
documented here as a new job with its cadence, failure mode, and cost guard.

## Async ingestion: Queues + Workflows

`/v1/kb/ingest/run` is the only async path. It defaults to **Workflow-backed
Queue dispatch** when `KB_INGEST_WORKFLOW` is bound, falls back to direct
Queue dispatch when only `INGEST_QUEUE` is bound, and uses `async:false` as an
explicit inline/debug override.

- **Queue:** `knowledgebase-ingest`, `max_batch_size: 5`, `max_batch_timeout:
  10`, `max_retries: 3`. Producer binding `INGEST_QUEUE`; consumer defined in
  `wrangler.jsonc`.
- **Workflow:** `knowledgebase-ingest-workflow`, class `KbIngestWorkflow`,
  binding `KB_INGEST_WORKFLOW`.
- **Durable run IDs:** stored in D1 `kb_ingest_jobs.workflow_id`, propagated
  through Workflow instances, Queue messages, and job state. Run-level progress
  via `GET /v1/kb/ingest/runs/:run_id`.

## Resilience contract

Every async path in this Worker satisfies the following contract. The contract
is enforced by focused tests in `cloudflare/worker/tests/app.test.ts`.

| Property | Value | Evidence |
| --- | --- | --- |
| Trigger | `POST /v1/kb/ingest/run` (defaults to async) | `src/index.ts` `/v1/kb/ingest/run` |
| Max batch/page size | `max_batch_size: 5` messages; per-message files bounded by `listFiles` pending set | `wrangler.jsonc` queues.consumers |
| Timeout | Parse: 45s (`INGEST_PARSE_TIMEOUT_MS`); Workflow enqueue step: 1m; Worker CPU limit via platform | `src/index.ts` `withParseTimeout` |
| Retry policy | Queue: `max_retries: 3` (platform); poison-input ack after `INGEST_QUEUE_MAX_ATTEMPTS=5`; per-file retry via `message.retry` with exponential backoff capped at 300s | `src/index.ts` `processIngestQueue` |
| Terminal failure | Job `status='failed'` + `last_error` + `attempts` incremented in D1; `failure_classification` on job detail route | `src/index.ts` `classifyIngestFailure` |
| Idempotency | Chunk IDs are deterministic (`deterministicId('chk', tenant:indexId:external_id:i:content)`); D1 `INSERT OR REPLACE` by chunk ID; Vectorize upsert by vector ID; parse artifact keyed by content hash | `src/index.ts` `ingestDocumentsToIndex` |
| Overlap control | Lease check: `isIngestJobLeaseActive` skips files with `status='running'` + `locked_by != current` + `locked_at` within 5m lease (`INGEST_JOB_LEASE_MS`) | `src/index.ts` `runKbIngest` |
| Observability | Structured `console.log`/`console.error` with `job_id`, `file_id`, `project`, `domain`, `locked_by`, `duration_ms`, `attempts`, `failure_classification`. No tokens, email bodies, or document contents. | `src/index.ts` `runKbIngest`, `processIngestQueue` |
| Replay | `POST /v1/kb/files/:file_id/reprocess` resets file to `pending` and re-queues; `POST /v1/kb/schemas/:domain/reprocess` re-queues all domain files | `src/index.ts` reprocess routes |

## Idempotency constraint

The Queue consumer **must be idempotent** — retries can deliver the same
message multiple times. Parse-artifact and chunk writes are keyed by content
hash; re-ingest of the same content reuses cached parse artifacts (see
`architecture/decisions.md` A6) and does not duplicate chunks. Chunk IDs are
deterministic (`deterministicId`) so `INSERT OR REPLACE` and Vectorize upsert
collapse duplicate deliveries into the same durable rows. The S-grade
ingestion-reliability gate wants first-class idempotent-content-replay,
chunk-preview, replay-route, and failure-classification proof (currently A+;
see `STATUS.md`).

## Failure handling

Per-file failures are bounded so one bad file does not poison the rest of the
ingest run. Attempt increments on per-file failures are recorded in D1 job
state. Classified failures are exposed on `/v1/kb/ingest/jobs/:job_id` and
`/v1/kb/ingest/runs/:run_id`. Poison-input messages (attempts >
`INGEST_QUEUE_MAX_ATTEMPTS`) are acked and logged to prevent infinite retry
loops; the underlying job stays in `failed` state and is replayable via the
reprocess route.

## Other async-ish paths (not jobs)

- **Eval reports** — `POST /v1/kb/evals/{search,parse,query}` run synchronously
  in the request and persist reports to D1. They are not queued.
- **Relationship backfill** — `POST /v1/kb/relationships/backfill` runs
  synchronously to rebuild D1 graph edges from active schemas.
- **Schema reprocess** — `POST /v1/kb/schemas/:domain/reprocess` re-queues
  ingestion for the domain's files under the active schema.
