# Knowledgebase Cloudflare Design

`knowledgebase` owns the fleet `RAG_SERVICE` as a Cloudflare Worker. The current
product runtime is TypeScript/Node on Cloudflare: Hono routes, D1 metadata,
Vectorize retrieval, R2 raw/parse artifacts, Queues/Workflows ingestion,
embeddings + synthesis through the fleet `free-ai` gateway
(`gemini-embedding-001` at 1536 dims, `gemini-2.5-flash`) with Workers AI as the
fallback and for optional neural rerank/OCR, and a Worker-hosted `/ui` testing
surface.

## Runtime

```mermaid
flowchart LR
    User[Agent or user] --> Worker[Cloudflare Worker]
    Worker --> D1[(D1 metadata<br/>schemas/files/entities/jobs/traces/evals)]
    Worker --> R2[(R2 raw files<br/>parse artifacts)]
    Worker --> Vectorize[(Vectorize indexes)]
    Worker --> FreeAI[(free-ai gateway<br/>embeddings + synthesis)]
    Worker --> AI[(Workers AI<br/>fallback + rerank/OCR)]
    Worker --> Queue[Queues + Workflows]
    Worker --> Analytics[Analytics Engine]
```

## Ingestion

- `/v1/kb/files/upload` stores raw bytes in R2, records file/job state in D1,
  and queues Worker-native ingestion.
- `/v1/kb/ingest/record` and `/v1/kb/ingest/text` cover direct structured and
  text inputs without a local Python service.
- URL and EDGAR imports run through Worker fetch into R2/D1.
- Parser coverage includes text, JSON/NDJSON, CSV, HTML, digital PDF text/table
  rows, XLSX, DOCX, PPTX, Markdown Conversion fallback, and opt-in vision OCR.

## Retrieval

The old Qdrant BM42 path is replaced by a Cloudflare-native hybrid path:

- D1 exact structured routes and relationship graph expansion.
- Vectorize dense search (embeddings via the `free-ai` gateway).
- In-Worker BM25 sparse lexical scoring over D1 chunks (fuzzy token matching;
  `sparseLexicalScore`), not a D1 `LIKE` query and not Qdrant BM42.
- RRF fusion, MMR, deterministic rewrite/decompose fanout.
- Keyword-overlap rerank by default; optional Workers AI neural rerank.
- Extractive cited answers by default; opt-in `free-ai`/Workers AI cited
  synthesis.

## Testing Surface

The Worker serves `/ui` for upload, schema, session, answer, source-set, queued
run progress, trace export/comparison, retrieval eval, answer eval, parse eval,
and query controls.

## Remaining Non-Cloudflare Surface

`cloudflare/full-port-gaps.json` is the executable blocker inventory. At the
time of writing, Python retirement is complete: the old Python FastAPI server,
Python UI, Docker Compose runtime, parser/query/eval package, package metadata,
and root pytest suite have been removed. The remaining blockers are the
scanned-PDF OCR parity decision and retiring the sibling `rag-service` folder
after parity is proven.
