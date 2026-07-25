---
title: Product overview
description: What knowledgebase is, the wedge, the surfaces, and what is real today.
---

# Product overview

> See [`STATUS.md`](../../STATUS.md) for the live deploy state. This page is the
> durable product framing; it changes only when the product thesis changes.

## Thesis

**Private Agent Search** — Exa-style cited search over project-scoped private
corpora. Users create domains, infer/confirm schemas, ingest files, and expose
`/search` and `/query` APIs for agents. The wedge is intentionally narrower
than "generic RAG":

- Exa searches the open web; this searches your private/specialized corpus.
- Agents get ranked cited evidence directly, not only a chat response.
- Schemas make extraction and filtering explicit when the corpus has domain
  shape. Schema inference can start from representative uploaded files before
  ingestion.
- Every useful response points back to `(file_id, page, excerpt)`.

The project mantra is **"cited or it didn't happen"**: uncited answers are
wrong answers, enforced as a data invariant across every retrieval path
(hybrid, structured D1, GraphRAG-sketch, Self-RAG retry, vision-LLM tables).

## What it is not

- A web-scale search engine.
- A complete enterprise knowledge platform.
- A connector-first sync product.
- A generic document-chat app.
- A guaranteed parser for every arbitrary file on day one.

## Surfaces

| Surface | Path | Stack | Deploy target |
| --- | --- | --- | --- |
| RAG Worker (fleet `RAG_SERVICE`) | `cloudflare/worker/` | Hono Worker, Workers AI, Vectorize, D1, R2, Queues, Workflows | `https://knowledgebase.sarthakagrawal927.workers.dev` |
| Worker testing UI | Worker `/` and `/ui` | Inline HTML in Worker | same Worker |
| Dashboard app | `app/` | Vite + React (static) → Cloudflare Pages | `https://search.sassmaker.com` |
| Demo domains | `domains/sec/`, `domains/legal/` | YAML schema + config + eval sets | ingested into the Worker |

The Worker `/v1/*` API is the canonical agent integration surface. The
Cloudflare Access-protected dashboard is the canonical human operator surface;
its same-origin Pages Function keeps the Worker service key out of the browser.
The Worker testing UI remains a low-level fallback. There is no separate public
marketing surface. The detailed route inventory lives in
[`cloudflare/worker/README.md`](../../cloudflare/worker/README.md) — do not
duplicate it here.

## What is real today

- Project-scoped corpora: each project has its own schemas, files, entities,
  sessions, traces, and indexed chunks.
- Bring-your-own corpus: upload representative files, infer a durable schema
  draft, confirm it, queue or inline ingest, inspect run progress. See
  [`bring-your-own-corpus.md`](bring-your-own-corpus.md).
- Bring-your-own schema: schemas are user-defined, versioned, and can be
  inferred before confirmation.
- Schema-driven ingestion: files and records produce structured entities,
  provenance spans, relationships, and searchable chunks.
- Source input: manual upload, schema-inference sample files, structured
  records/text (`/v1/kb/ingest/record`, `/v1/kb/ingest/text`), EDGAR imports,
  and URL fetches — all through the Worker.
- Agent search API: `POST /v1/kb/search` (ranked cited evidence, no synthesis)
  and `POST /v1/kb/query` (cited answers + traces). SSE lifecycle via
  `/v1/kb/query/stream`. Retired FastAPI paths are authenticated compatibility
  aliases. See [`agent-tool-contract.md`](agent-tool-contract.md).
- Eval hooks: Worker routes persist search/query/parse eval reports and expose
  summary/history.
- Corpus status: `GET /v1/kb/projects/{project}/status` reports per-domain
  readiness.
- Operator visibility: the dashboard exposes tenant-scoped Data views for
  files, chunks, jobs, entities, and relationships plus cross-domain Query
  History with citations and quality drilldown.

## Empirical headline

On solid retrieval, `groq-llama-3.1-8b` beats `gemini-2.5-pro` by 24 pass-rate
points on the SEC eval — **contingent on retrieval quality**. With
reranker+RRF off, the 8b model commits to wrong sources and the result flips.
The right framing is not "8b wins"; it is "no fixed model wins; the right synth
depends on whether your context is solid enough that decisiveness pays off."

The full cross-domain × cross-model matrix and methodology live in
[`knowledge/archive/notes-python-era.md`](../knowledge/archive/notes-python-era.md)
§4.7. The durable lesson is in
[`knowledge/learnings.md`](../knowledge/learnings.md).

## Fleet role

`knowledgebase` is the **only** fleet RAG service codebase. The sibling
`../rag-service` repo was retired on 2026-06-21; do not recreate it. Fleet
consumers (SaaS Maker, Linkchat, Starboard) integrate through
`RAG_SERVICE_URL` / service bindings and `RAG_SERVICE_KEY`, not by embedding a
runtime. See [`operations/highsignal-integration.md`](../operations/highsignal-integration.md).
