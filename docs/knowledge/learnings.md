---
title: Durable learnings
description: Lessons that survive the Python→Cloudflare migration. Distilled from the archived session notes.
---

# Durable learnings

> Distilled from
> [`archive/learning-python-era.md`](archive/learning-python-era.md) Part 8,
> [`archive/notes-python-era.md`](archive/notes-python-era.md), and
> [`archive/grok-findings.md`](archive/grok-findings.md). These are the lessons
> that still constrain the Cloudflare Worker, not the historical narrative.

## L1 — Logging is leverage

Every production bug caught in the Python era (DuckDB missing dep, missing
tickers, inconsistent metric names, ghost Prometheus counter, RAGAS shape) was
made visible by either loud LLM-error logging or by watching live logs during a
real eval. Silent green tests tell you the code doesn't crash, not that the
system works.

**Applied in the Worker:** swallowed LLM errors log at WARNING/ERROR with type
+ first 200 chars; auth/quota re-raise. See
[`architecture/decisions.md`](../architecture/decisions.md) A11.

## L2 — Defensive parsing is non-optional in LLM pipelines

Three separate bugs in one session were "the model returned a string where a
dict was expected" or "the model returned `{}` where a structured payload was
expected." `_coerce_json`-style helpers (strip fences, search for the first
`{...}`, return `{}` on total failure) belong on every `json.loads` of model
output.

**Applied in the Worker:** every chat-json path coerces; callers never see a
raw `JSONDecodeError`. See A11.

## L3 — Methodology bugs are eval bugs

The first three cross-model eval runs were dead because `docker compose exec -e`
does not propagate env to the API server process. A judge-confound moved scores
12 points. Document the methodology before you run, not after; hold the judge
model constant; detect identical-report-MD5 as a methodology-failure signal.

**Applied now:** the Worker scorecard gates require minimum repeat/sample
counts, expected deploy fingerprints, and labeled query validation before any
live request, so under-sampled or stale proof cannot masquerade as evidence.
See [`development/testing.md`](../development/testing.md).

## L4 — Bigger model is not always better for RAG synthesis

A frontier synth model facing weak context hedges correctly and tanks pass
rate. With strong retrieval, the cheap decisive model wins: `groq-llama-3.1-8b`
beat `gemini-2.5-pro` by 24 pass-rate points on SEC. This is contingent on
retrieval quality — with reranker+RRF off, the 8b model commits to wrong
sources and the result flips.

**Production implication:** per-domain synth config (or per-question routing)
is necessary. A "pick one model" policy is wrong; the right model depends on
what kind of grounding the answer needs. See
[`product/overview.md`](../product/overview.md) "Empirical headline".

## L5 — End-to-end testing finds bugs no unit test will

The DuckDB `ImportError`, the missing tickers, and the inconsistent metric
names are all things you cannot unit-test, only e2e-test. Synthetic evals are
the cheapest e2e you can build. The parse-eval, search-eval, and query-eval
harnesses exist for this reason.

## L6 — Two demo domains is the test of domain-agnosticism

One domain proves capability; two proves the system is actually
domain-agnostic. SEC + Legal on the same code, with opposite MMR signs, is the
evidence. A global retrieval default is the wrong shape — diversity-vs-precision
is a per-domain choice. See A5.

## L7 — Cited stays cited across new routes

When a new retrieval route is added, its evidence must terminate at a
retrievable `(file_id, page, excerpt)` triple. The GraphRAG-sketch route
initially shaped answers with entity themes that were not in the citation list
— caught in self-review, fixed by backfilling `via="graph_route"` citations
deduped by `(file_id, page_start)`. See A3.

## L8 — Wrap, don't reinvent, the parser layer

Unstructured solved 10 years of layout detection, OCR routing, and table
extraction. The interesting layer is what goes above: schema-driven extraction
with per-field provenance, entity resolution, retrieval-quality decisions.
Reinventing the parser would eat 80% of the effort for 0% of the
differentiation. In the Cloudflare port this became "use Workers AI Markdown
Conversion + vision OCR instead of porting Unstructured." See A7.
