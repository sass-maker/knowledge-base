---
title: Architectural decisions
description: Durable architectural decisions for the knowledgebase RAG service and the why behind each. Survives the Python→Cloudflare migration.
---

# Architectural decisions

> Durable choices and the why behind each. Historical decision-by-decision
> narrative (Python era) is preserved in
> [`knowledge/archive/learning-python-era.md`](../knowledge/archive/learning-python-era.md)
> Part 4 and
> [`knowledge/archive/notes-python-era.md`](../knowledge/archive/notes-python-era.md).
> This page keeps the choices that still constrain the Cloudflare Worker.

## A1 — Cloudflare-only runtime, no sibling service

**Decision:** All fleet RAG runtime lives in `cloudflare/worker` (Hono Worker,
Workers AI, Vectorize, D1, R2, Queues, Workflows). The old Python FastAPI
service and the sibling `../rag-service` repo are retired.

**Why:** One deployable, one auth model, one cost surface. Two RAG codebases
drifted; the retirement gate (`audit:sibling-rag-service --require-retired`)
exists precisely to keep a second one from reappearing.

**Constraint:** Do not recreate a separate `rag-service` Worker. New product
additions must land in the Worker/D1 repository and `/v1/kb/*` aliases before
being considered product-complete. See
[`cloudflare-full-port.md`](cloudflare-full-port.md).

## A2 — D1 for metadata, Vectorize for vectors, R2 for bytes

**Decision:** Split storage. D1 holds projects/domains/schemas/files/entities/
mentions/relationships/provenance/sessions/jobs/traces/evals. Vectorize holds
dense embeddings. R2 holds raw files and parse artifacts.

**Why:** Each Cloudflare primitive does one job well. D1 gives SQL + JSONB-like
metadata + `SKIP LOCKED`-style job claiming semantics. Vectorize gives dense
search with metadata filters. R2 gives idempotent blob storage keyed by content
hash. Joining them in the Worker is cheap; replacing any one is bounded.

**Constraint:** Cloudflare has no native managed Postgres and Vectorize is not
Qdrant BM42. The accepted replacement is the Cloudflare-native hybrid stack in
A4 — do not port in a foreign DB or sparse-vector engine.

## A3 — "Cited or it didn't happen" is a data invariant, not a prompt hope

**Decision:** Every retrieval path converges on the same `(file_id, page,
excerpt)` triple. Citations are produced structurally (chunk metadata, entity
mentions, provenance spans) and verified deterministically before the answer
ships. The synthesizer never sees text without a backing citation it can cite.

**Why:** The hardest product line is "uncited answers are wrong answers."
Treating it as an enforced invariant rather than a prompt-level hope is what
makes it hold across new routes. When the GraphRAG-sketch route was added, its
themes shaped the answer but its `entity_mentions` were initially missing from
the citation list — caught in self-review, fixed by backfilling
`via="graph_route"` citations deduped against retrieval by `(file_id,
page_start)`.

**Constraint:** Any new retrieval/answer route must terminate at a retrievable
citation triple. Span-cite picks the best sentence inside the chunk by dense
cosine; confidence is downgraded proportionally to per-claim verify pass rate.

## A4 — Cloudflare-native hybrid retrieval replaces Qdrant BM42

**Decision:** The hybrid path is D1 exact structured routes + D1 relationship
graph expansion + Vectorize dense search + an in-Worker BM25 sparse lexical
scorer over D1 chunks + RRF fusion + local MMR + deterministic
rewrite/decompose fanout + optional Workers AI neural rerank. Extractive cited
answers by default; opt-in Workers AI cited synthesis via
`answer_mode: "workers_ai"`.

**Why:** Cloudflare Vectorize does dense search and metadata filtering but not
sparse vectors. Building the sparse side over D1 chunks keeps everything
Cloudflare-native and lets the structured/graph fast paths short-circuit
embedding entirely for exact-term and entity-filter queries.

**How the sparse side actually works:** `queryByLexical` loads the index's
chunk rows from D1 (`listChunksForIndex`, capped at `MAX_LEXICAL_CHUNKS` = 5000,
cached per tenant/index) and scores them inside the isolate with
`sparseLexicalScore` — genuine BM25 (`k1 = 1.2`, `b = 0.75`, IDF +
length-normalized TF, scoring version `bm25_fuzzy_sparse_v3`) over fuzzy-matched
tokens (stems, trigrams, bounded edit-distance). It is BM25, not a D1
`LOWER(content) LIKE` query; the `searchLexicalChunks` LIKE method on the
repository is not on the live path.

**Constraint:** This is functional retrieval parity, not the exact BM42 model.
Do not claim BM42 equivalence. Semantic p99 on completely unique cold misses
still pays embedding + Vectorize latency; the query-result and normalized
embedding caches cover hot/repeated questions across isolates, not first-seen
misses.

## A5 — Per-domain pipeline tuning, not global defaults

**Decision:** Diversity-vs-precision knobs (MMR, hybrid alpha, query
rewriting/decomposition, CRAG) are per-domain. The SEC and Legal demos flipped
the sign on MMR (regressed SEC citation F1 by 0.13, lifted Legal by 0.09).

**Why:** A global retrieval default is the wrong shape. 10-K boilerplate
questions want the same chunks ranked high; license-text questions want spread
across clauses. Same code, opposite signs.

**Constraint:** Do not introduce a global retrieval default that overrides
per-domain config without measuring both demo domains.

## A6 — Parse once, re-extract many

**Decision:** Parse artifacts are cached at the element boundary (bbox, page,
element type), keyed on `sha256(file_bytes)`, stored in R2 with a D1
`kb_parse_artifacts` map. Schema edits create a new ingest job keyed on
`(file_id, schema_id)`; the parse-cache hit makes re-extract substantially
cheaper than re-parsing.

**Why:** Re-running schema-driven ingestion must not redo the expensive parsing
work (OCR, layout detection). Caching chunked text loses provenance; caching
LLM extraction is useless (schema changes invalidate it); caching only raw
bytes does nothing for the expensive part.

**Constraint:** The cache is at the element boundary, not the chunk or
extraction boundary. Any new parser must emit elements with page + bbox
metadata or citations break.

## A7 — TypeScript-native parsing, opt-in vision OCR

**Decision:** The Worker parses text/JSON/NDJSON/CSV, HTML, digital PDF text
with coordinate-derived table rows, XLSX, DOCX, and PPTX in TypeScript. Workers
AI Markdown Conversion covers scanned/unsupported rich files in auto/forced
modes. Direct Workers AI vision OCR is opt-in via `RAG_VISION_OCR_MODEL` and
runs for PDFs whose local text extraction is weak, not only for textless PDFs.

**Why:** Workers cannot host the old Python OCR/parser stack. Reinventing
Unstructured would eat the differentiation for 0% gain; the interesting layer
is schema-driven extraction above the parser.

**Constraint:** Vision OCR is not enabled by default — LLaVA took ~71.8 s for
the scanned PDF and still missed target paragraphs. The packaged NVDA gate
tries `@cf/meta/llama-3.2-11b-vision-instruct` first, then
`@cf/meta/llama-4-scout-17b-16e-instruct`. Cloudflare requires an account-level
Meta license acceptance before the first Llama 3.2 Vision call (see
[`operations/runbook.md`](../operations/runbook.md)).

## A8 — Queues + Workflows for async ingestion, inline as explicit override

**Decision:** `/v1/kb/ingest/run` defaults to Workflow-backed Queue dispatch
when bound, falls back to direct Queue dispatch, and uses `async:false` as an
explicit inline/debug override. Durable run IDs live in D1 `workflow_id` and
propagate through Workflow instances, Queue messages, and job state.

**Why:** Upload should return fast; parsing/embedding is slow and batchable.
Durable run IDs make retry and progress observable. The Queue consumer must be
idempotent because retries can deliver the same message multiple times.

**Constraint:** Do not make inline the default path for production traffic. See
[`operations/jobs.md`](../operations/jobs.md).

## A9 — Service-key auth with tenant isolation and append-only cutover keys

**Decision:** `Authorization: Bearer <key>` or `X-RAG-Key`. `RAG_SERVICE_KEYS`
maps keys to tenant names. `RAG_SERVICE_KEYS_APPEND` allows temporary cutover
keys without overwriting the primary map; `RAG_SERVICE_DASHBOARD_KEYS` isolates
the internal operator credential; `RAG_SERVICE_PROOF_KEYS` is for short-lived
proof/eval runs.

**Why:** Fleet consumers share one Worker; tenant isolation is enforced at the
index/chunk/metadata level. Append-only keys let verification happen without
disrupting consumer cutover keys.

**Constraint:** Never commit real keys. Fleet-level verification lives in
SaaS Maker: `pnpm fleet:secret-audit -- --project knowledgebase --fail-on-missing`.

## A10 — Two demo domains is the test of domain-agnosticism

**Decision:** SEC (EDGAR filings) + Legal (SPDX licenses) ship side-by-side on
the same code with zero shared schema code. 9 distinct entity types across the
two schemas.

**Why:** One domain proves capability; two proves the system is actually
domain-agnostic. The cross-domain eval confirmed it empirically — Legal × Flash
even beat SEC × Flash (F1 0.787 vs 0.618).

**Constraint:** Do not bake domain-specific defaults into core code. Domain
shape lives in `domains/<name>/config.yaml` and `domains/<name>/schema.yaml`;
core code reads schema-declared pipeline roles (`graph_route`, `tabular`,
`tabular_identifier`).

## A11 — Loud error logging and defensive LLM parsing are non-optional

**Decision:** Model/gateway errors surface loudly with type + a bounded detail
slice; auth/quota errors propagate so callers fail loudly rather than silently
degrading. Model output is never fed to a bare parse — it goes through a
coercing helper that tolerates fenced/prose-wrapped JSON and returns a
null/empty result on total failure instead of throwing. In the Worker this is
`parseJudgeJson` in [`src/index.ts`](../../cloudflare/worker/src/index.ts): it
tries `JSON.parse`, falls back to the first `{…}` match, and returns `null` when
neither parses. The free-ai/Workers-AI error paths slice the upstream body
(`detail.slice(0, 200)`) into the thrown error (see
[`src/free-ai.ts`](../../cloudflare/worker/src/free-ai.ts)).

**Why:** Five production bugs (DuckDB missing dep, missing tickers, inconsistent
metric names, ghost Prometheus counter, RAGAS shape) were surfaced during the
Python era by loud logging or by watching live logs during a real eval. Silent
green tests tell you the code doesn't crash, not that the system works — the
principle carried over to the Worker.

**Constraint:** Do not wrap an LLM/gateway call in a silent catch. Do not
`JSON.parse` raw model output without a coercing fallback. See
[`knowledge/learnings.md`](../knowledge/learnings.md) and
[`knowledge/failed-approaches.md`](../knowledge/failed-approaches.md).

## A12 — Scorecard gates prevent "missing proof" masquerading as excellence

**Decision:** `scorecard:a-plus` / `scorecard:s` grade reliability, deploy
readiness, retrieval performance/quality, ingestion reliability, observability,
and ease-of-use from readiness reports, operator reports, and benchmarks.
`proof:a-plus` / `proof:s` generate the deployed proof bundle and fail-fast
after readiness if the deployed fingerprint/health checks are stale before
spending eval or benchmark requests.

**Why:** Without a gate, narrow, under-sampled, cached-only, or wrong-account
proof can masquerade as across-the-board evidence. The scorecard can require a
target domain, specific benchmark modes/surfaces, minimum repeat/sample counts,
and the expected deploy fingerprint so stale production reports fail inside the
gate.

**Constraint:** Do not claim a grade without running the proof command. The
current S-grade blocker is not a Cloudflare gap — it is missing
`KARTE_SESSION_COOKIE` / `STARBOARD_SESSION_COOKIE` for authenticated consumer
smokes. See [`STATUS.md`](../../STATUS.md).
