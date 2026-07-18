---
title: Failed approaches and resolved traps
description: Methodology bugs, ghost features, and resolved traps from the Python era — preserved so they are not re-introduced.
---

# Failed approaches and resolved traps

> Preserved so the same traps are not re-introduced. Full historical detail in
> [`archive/learning-python-era.md`](archive/learning-python-era.md) Part 4 and
> [`archive/grok-findings.md`](archive/grok-findings.md). Each entry: what
> happened, how it surfaced, the fix, and the durable constraint.

## F1 — DuckDB structured-query route was 100% broken in v0–v5

- **What:** `duckdb` was missing from `pyproject.toml`; the
  `from kb.query.duckdb_route import maybe_duckdb_answer` lived outside the
  try/except in `engine.py`, so every aggregate question returned 500 and eval
  logged `query_error`. All v0–v5 numbers were achieved with this route dead.
- **How it surfaced:** after switching to the free-AI gateway with loud error
  logging, `ModuleNotFoundError: No module named 'duckdb'` appeared in API logs
  on every aggregate question.
- **Fix:** add `duckdb>=1.0`, move the import inside the try/except, document
  the retroactive caveat honestly.
- **Durable constraint:** a missing optional dependency must fail loudly and
  locally, not silently fall through to a 500. In the Worker, the structured
  route is D1-native (no optional dep) — but the lesson is: guard imports of
  optional code paths.

## F2 — Most FinancialMetric entities lacked a ticker

- **What:** only 3 of 15 SEC `FinancialMetric` entities had a `ticker`; every
  `WHERE ticker='AAPL'` matched zero rows.
- **How it surfaced:** per-question failure analysis; a judge reason read
  "DuckDB query returned 'None'".
- **Fix:** backfill ticker from the filing filename regex `^([A-Z]{1,5})[_-]`
  at DuckDB-build time, only when the entity's own ticker is missing.
- **Durable constraint:** extraction-time field absence is a data-quality bug,
  not a query bug. The Cloudflare Worker's entity fast path
  (`/v1/kb/entities/search`) is the zero-AI D1 exact-lookup path; if a field is
  missing on entities, no query-time fallback silently rescues it forever —
  fix extraction or backfill explicitly.

## F3 — Metric names are inconsistent across companies

- **What:** Apple revenue → `name='Total Net Sales'`; MSFT/NVDA revenue →
  `name='Revenue'`. Even after the ticker fix, `WHERE ticker='AAPL' AND
  name='Revenue'` matched 0 rows for Apple.
- **Fix:** derived `metric_canonical` column bucketing variations into
  canonical names (`revenue`, `revenue_segment`, `net_income`, …) at query
  time. A lookup table, not re-extraction — cheap, deterministic, auditable.
- **Durable constraint:** a vocabulary table at query time beats re-extraction
  for normalization. Re-extraction is slow, expensive, and non-deterministic.
- **Honest limit:** on the 25-question SEC eval the lift was within the ±4pt
  noise floor; one question flipped ✓→✗ due to LLM nondeterminism. The fix is
  correct behaviorally; the dataset was too small to show the lift.

## F4 — Prometheus `record_query` was a ghost feature

- **What:** `kb_queries_total` showed 0 even though the eval had just run
  dozens of queries. `record_query` was defined in `kb.api.metrics`, never
  called from anywhere.
- **How it surfaced:** defensive `curl /metrics` sweep while waiting for an
  eval.
- **Fix:** wire it in at the end of `answer_query()` in a try/except so a
  metrics failure cannot fail a successful query.
- **Durable constraint:** the Worker emits Analytics Engine data points for
  successful query traces and eval reports via `RAG_ANALYTICS`. If you add a
  metric, wire it in at the call site in the same change — do not ship a
  defined-but-uncalled metric.

## F5 — RAGAS crashed on flash-lite

- **What:** `AttributeError: 'str' object has no attribute 'get'` during RAGAS
  scoring. `gemini-2.5-flash-lite` returned `{"chunks": ["str1", "str2"]}`
  (list of strings) instead of `{"chunks": [{"relevant": true}, ...]}`.
- **Fix:** defensively skip non-dict items in every RAGAS sub-metric.
- **Durable constraint:** never assume a model returns the documented shape.
  See L2.

## F6 — Methodology bug: env-via-`docker compose exec -e` does not reach the API server

- **What:** the first cross-model eval used `docker compose exec -e AI_MODEL=…
  api python -m kb.eval.run …`. The env override sets variables for the
  eval-CLI shell, but the API server is a separate process that loaded its env
  from `.env` at container start. The "Pro synth" run was secretly synth=flash.
- **How it surfaced:** two report files had identical MD5 hashes.
- **Fix:** update `.env` between runs and restart the API container.
- **Durable constraint:** when swapping a model that a long-running server
  reads at startup, restart the server. Detect identical-output hashes as a
  methodology-failure signal. See L3.

## F7 — Judge-confound

- **What:** first Flash run used Flash as both synth and judge. Second Flash
  run used Flash synth + Pro judge. Pass rate moved +12pts with no synth
  change — the judge was the confound.
- **Fix:** hold judge model constant at `gemini-2.5-pro` for every cross-model
  run.
- **Durable constraint:** hold the judge constant when comparing synth models.
  See L3.

## F8 — GraphRAG citation gap (self-caught)

- **What:** the GraphRAG-sketch route's narrative themes shaped the answer but
  its `entity_mentions` were not in the final `Citation` list. The answer was
  technically cited but a theme could draw from entity #14 while the citation
  list cited chunks #2 and #5.
- **How it surfaced:** self-review before shipping.
- **Fix:** backfill `via="graph_route"` citations deduped against retrieval by
  `(file_id, page_start)`.
- **Durable constraint:** every new retrieval route must terminate at a
  retrievable citation triple. See A3 / L7.

## F9 — Cross-process Qdrant collection race (Grok #1)

- **What:** `ensure_collection` used a per-process `asyncio.Lock` + in-memory
  `_ensured` set. Workers run in separate processes, so the lock provided no
  cross-process exclusion. On concurrent first ingest, multiple workers passed
  the existence check, hit create_collection races, and still marked `_ensured`
  on the failure path. Subsequent upsert/scroll/query 404'd against a
  non-existent collection. This was the "4/13 files failed on first concurrent
  ingest" bug.
- **Fix:** Postgres advisory lock for cross-process exclusion +
  `_ensure_and_retry_op` wrapper on every vector op.
- **Durable constraint:** per-process locks do not protect across processes.
  The Cloudflare Worker is single-isolate-per-request so this specific race is
  gone, but the lesson generalizes: do not mark a resource "ensured" on the
  failure path, and wrap idempotent ops with retry-on-not-found.

## F10 — LLM errors swallowed at INFO (Grok #12)

- **What:** extremely broad `except Exception` around every LLM call turned
  auth failures (402), rate limits, context-length errors, and schema
  violations into silent fallbacks that produced empty extractions or default
  "lookup" intents. The job still succeeded (with zero entities) and the query
  returned low-quality answers.
- **Fix:** auth/quota at ERROR level (and re-raise); retryable at WARNING with
  type + first 200 chars.
- **Durable constraint:** see L1 / A11. This is the single highest-leverage
  change of the Python era — it surfaced F1, F2, F3, F4.

## Resolved external review (Grok, 13 findings)

All 13 findings from the initial codebase review are closed (12 fixed in
commits `80ce401`, `0b99f83`, `4b400c9`, `f0b50c0`; 1 acknowledged as
documentation-only). The full review with per-issue file/line/suggestion/status
is preserved in [`archive/grok-findings.md`](archive/grok-findings.md). The
durable ones are F9, F10, and the defensive-parsing pattern (L2).
