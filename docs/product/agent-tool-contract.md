# Agent Tool Contract

Agents should call the Cloudflare Worker RAG service when they need evidence
from a private or specialized corpus.

## Endpoint

Use `POST /v1/kb/query` for cited answers and ranked evidence. Use
`POST /v1/kb/query/stream` only when the client needs SSE lifecycle events;
the stream emits `started`, `stage`, and final `answer` or `error` events.
Legacy `/query`, `/query/stream`, `/search`, `/agent/search`, and
`/search/eval` paths still work as authenticated compatibility aliases, but new
clients should use `/v1/kb/*`.

Authentication:

```http
Authorization: Bearer <RAG_SERVICE_KEY>
```

## Request

```json
{
  "domain": "research-papers",
  "question": "What evidence supports using retrieval reranking?",
  "top_k": 8,
  "mode": "hybrid",
  "answer_mode": "extractive"
}
```

`/v1/kb/query` reads only `domain` and `question` (alias `query`) plus optional
retrieval knobs. The project/tenant is **not** taken from the request body — it
is bound to the authenticated service key, so a per-tenant key already scopes
every call. Use `mode: "hybrid"` when quality matters. Use `mode: "lexical"` for
latency-critical exact-term workflows.

## Response Contract

The agent should preserve returned citations. A cited answer is only useful when
the final response can point back to filename/page/excerpt evidence.

The stable response includes `answer`, `trace_id`, `confidence`, ranked `data`,
and `citations`. Each citation retains `file_id`, `filename`, `page_start`,
`page_end`, `excerpt`, and score metadata. The dependency-free
[`KnowledgebaseClient`](../../cloudflare/worker/src/client.ts) and its
[`/v1/kb/query` compatibility test](../../cloudflare/worker/tests/client.test.ts)
are the executable consumer contract.

If the Worker returns no relevant evidence, do not answer from memory. Ask for a
narrower query, a different domain, or more uploaded documents.

## Versioned catalog and decisions

The index APIs also support source-grounded public catalogs. They use the same
tenant-bound authentication. A public source's visibility describes its evidence;
it does not grant unauthenticated API access or cross-tenant permission.

`POST /v1/indexes/:id/ingest` accepts `{documents:[{external_id,content,metadata}]}`.
The optional evidence envelope in metadata uses `schema_version:1`, `repo_id`
(or another product's stable subject ID), `source_url`, `source_revision`,
`source_path`, `source_excerpt`, and `visibility:"public"|"private"`. Keep
source facts, model inferences, and human validation explicitly distinct.
`source_excerpt`, when supplied, must occur exactly in the document content.

An external ID identifies the current snapshot. Replaying identical content and
metadata returns `idempotent:true`; a changed snapshot publishes new document and
chunk IDs after embedding succeeds. D1 publication is atomic and concurrent
writers cannot overwrite the same previous snapshot. Older documents remain
retrievable for historical citations and are excluded from current search.
Storage growth remains guarded; an idempotent replay needs no new vectors.

`GET /v1/indexes/:id/documents/by-external-id?external_id=...` and
`GET /v1/documents/:id` return `{document,chunks}`. Catalog citation `file_id`
is the source snapshot's document ID, retrievable through the latter route;
chunks retain page 1, source filename/path, and exact excerpt evidence.

`POST /v1/indexes/:id/enrich` takes `document_ids` (1–10), `subject_id`, optional
`source_revision`, and optional `classification:{categories:[...]}` (1–32).
It returns version 1 with `profile:{purpose,capabilities,use_when,avoid_when,
compatibility,scenarios}`, per-fact evidence references, explicitly unvalidated
inferences, validation flags, and engine metadata. Purpose is a string; other
profile fields are string arrays. Optional taxonomy returns an allowed category,
subcategories, keywords, and its inference validation status. Source quotation
validation does not constitute human confirmation of a model's summary.
The same enrichment call returns `needs:[{title,desired_outcome,constraints,
evidence}]` (0–6), limited to explicitly quoted unmet/planned requests.
Dependencies and language keywords do not imply missing functionality;
non-goals are excluded. These extractions remain model-derived until reviewed.
The consumer publishes this result as a separate derived profile document;
enrichment itself has no hidden indexing side effect.

`POST /v1/indexes/:id/decide` takes `question`, `context_document_ids` (1–3),
`candidates:[{id,document_ids:[...]}]` (1–20; up to 3 documents each), optional
`explicit_gaps:[{document_id,chunk_id,excerpt}]`, and `engine:"free_ai"|"jev"`.
Gap evidence must quote a context chunk exactly. Without an explicit gap, the
available positive verdict is `reference`. Integration requires selecting a
documented gap and candidate capability evidence. Invalid source IDs/quotations
or unsupported positive decisions fail rather than fabricate evidence.

`POST /v1/indexes/:id/compare` takes the same input and freezes the same source
state and fixed choice questions for both engines. It returns `comparison_id`,
`input_hash`, `engines:{free_ai,jev}`, and verdict agreement when both succeeded.
Each engine reports `status`, `requested_model`, actual `resolved_model` and
`provider` (null when the upstream omits them), `latency_ms`, `usage`, `raw`, and
a validated result or explicit error. Results contain `abstained` and candidate
items with `integration|reference|reject`, source-derived reason/benefit text,
and project/candidate evidence. Agreement is not a measure of usefulness.
Items retain input candidate order, not a relevance ranking. A bounded packing
pass keeps every candidate while reducing quoted options/excerpt lengths to fit
24 KB; `coverage` reports the limits, packed bytes, and truncation. Gap quotes
remain intact. Both engines receive the identical packed state and questions.
`GET /v1/indexes/:id/decisions/:decision_id` retrieves the frozen run and raw
engine outputs. No model fallback disguises disabled or failed comparisons.

Free AI uses gateway model `auto` and project ID `knowledge-base`. Jev uses the
[official fixed-question contract](https://developers.cloudflare.com/ai/models/typesafe/jev/)
through the existing AI binding and is disabled unless `RAG_JEV_ENABLED=true`.
Jev is paid; enabling it requires explicit owner approval. No production
configuration enables it as part of this change.
Requests have a 30-second model deadline; cancellation of native AI work after
the request deadline depends on the binding's cancellation support.

`POST /v1/embeddings` supports bounded batches of 1–100 strings with
`model:"@cf/baai/bge-base-en-v1.5"`, `dimensions:768`; it returns
`{data:number[][],model,dimensions}` through the existing budgeted gateway.
Hybrid/lexical retrieval searches the whole corpus using FTS, enforces the same
metadata filter as semantic retrieval, and keys caches by durable index revision.
Before the FTS migration exists, lexical queries retain a corpus-wide SQL path.
Result metadata identifies `score_kind` (`cosine`, `lexical_bm25`, `rrf`,
`keyword_reranked`, or `neural_reranked`); `semantic_score` preserves the raw
cosine value when available. Use `/query-vector` for strict cosine retrieval.
Catalog vectors promote scalar `kind`, `repo_id`, `user_id`, `subject_id`,
`category`, and `visibility` (strings up to 256 characters) for filter indexes.
Cutover requires approved Vectorize metadata indexes for pushed-down fields;
existing vectors need republishing before those source filters can match them.

Migration `0011_catalog_snapshots_fts_decisions.sql` prepares snapshot uniqueness,
FTS, durable revisions, and decision storage. It must be approved and applied
before publishing catalog snapshots or running saved decisions; this source
change does not apply migrations or lift the Vectorize storage-growth guard.

## Curl Example

```bash
export RAG_BASE_URL="${RAG_BASE_URL:-https://knowledgebase.sarthakagrawal927.workers.dev}"
export RAG_SERVICE_KEY="<service-key>"

curl -s -X POST "$RAG_BASE_URL/v1/kb/query" \
  -H "Authorization: Bearer $RAG_SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "domain": "research-papers",
    "question": "retrieval reranking evidence",
    "top_k": 5,
    "mode": "hybrid"
  }' | jq '{answer, citations, confidence}'
```
