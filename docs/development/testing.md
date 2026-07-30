---
title: Testing, evals, and readiness gates
description: Worker tests, parse/query evals, smokes, and the release readiness gates for the knowledgebase RAG service.
---

# Testing, evals, and readiness gates

> Exact script names live in `cloudflare/worker/package.json`. This page is the
> gate taxonomy and when to run each. The operator-facing failure modes live in
> [`operations/runbook.md`](../operations/runbook.md).

## Gate taxonomy

| Gate | What it proves | Network | AI spend | When |
| --- | --- | --- | --- | --- |
| `pnpm check` | typecheck + vitest | no | no | every commit (CI) |
| `pnpm run preflight` | Wrangler bindings, D1 migration parity, legacy-route parity, Python retirement | no | no | before deploy |
| `pnpm run gaps:full-port` | full-port blocker inventory (`cloudflare/full-port-gaps.json`) | no | no | before deploy |
| `pnpm run audit:sibling-rag-service --require-retired` | no second RAG codebase | no | no | before deploy |
| `pnpm run eval:parse:nvda-scanned:dry-run` | local one-case scanned-PDF OCR payload | no | no | before deploy |
| `pnpm run smoke:local-cutover` | boot `wrangler dev`, prove aliases + fingerprint | local only | no | before deploy |
| `pnpm run deploy:dry-run` | bundle + binding validation | no | no | before deploy |
| `pnpm run predeploy:local` | all of the above + consumer audit/build + free-ai audit + release plan | local + sibling repos | no | the local pre-deploy gate |
| `pnpm run readiness` | deployed health + anon `/v1/*` rejection | yes | no | after deploy |
| `pnpm run readiness:auth` | full auth smoke with `RAG_SERVICE_KEY` | yes | minimal | after deploy |
| `pnpm run readiness:embedding-model` | live free-ai embedding catalog proof | yes | no | after embedding release |
| `pnpm run smoke:rag-crud:embedding-model` | mutating live selected-model CRUD | yes | yes | after embedding release |
| `pnpm run readiness:full-port` | health/auth + legacy aliases + fingerprint + live NVDA OCR + preflight + sibling audit + gap matrix | yes | yes (OCR) | the final live gate |
| `pnpm run proof:a-plus` / `proof:s` | deployed readiness + query eval + operator + benchmark + scorecard bundle; S also exercises ingest replay and classified failure | yes | yes | grade evidence |
| `pnpm run scorecard:a-plus` / `scorecard:s` | grades the proof bundle against thresholds | no | no | grade assignment |

## The local pre-deploy gate

```bash
cd cloudflare/worker
pnpm run predeploy:local
```

Wraps: Worker tests/typecheck, binding preflight, Python retirement audit,
no-external-`rag-service` reference guard, Linkchat/Starboard consumer source
audit + local Cloudflare bundle builds, local `../free-ai` embedding catalog +
cost-audited deploy-script audit, upstream free-ai cost/type/test check,
Vectorize embedding binding selectability audit, full-port gap matrix, no-network
NVDA scanned-PDF OCR eval payload dry-run, read-only embedding-model release
plan, local cutover smoke, and `wrangler deploy --dry-run`.

This gate builds sibling fleet products (Karte `cf:build`, Starboard `build:cf`)
and reads repos on disk — it only works in a full local fleet checkout, not
single-repo CI. That is why CI runs only `pnpm run check`.

## Eval harnesses

- **Parse eval** — `scripts/legacy-parse-eval.mjs` builds parse-quality cases
  from the migrated D1 JSON export plus mirrored raw/parse object roots. Dry-run
  (`eval:parse:nvda-scanned:dry-run`) verifies the local one-case payload
  without network or AI. Live (`eval:parse:nvda-scanned:live`) is the
  authenticated deployed one-case gate. Posts to `/v1/kb/evals/parse`.
- **Search eval** — `POST /v1/kb/evals/search` reports hit rate, MRR, latency.
- **Query eval** — `POST /v1/kb/evals/query` scores answer hit rate, citation
  rate, deterministic faithfulness/support coverage, opt-in Workers AI judge
  scores, AI use rate, latency. Reports persist to D1; rollups via
  `/v1/kb/evals/summary`.
- **Benchmark** — `benchmark:rag` emits mode-labeled lexical/semantic/hybrid
  evidence for index, domain search, and domain answer surfaces with cache-hit
  and non-cache latency buckets.

## Scorecard thresholds (initial)

- lexical A+: p95 ≤ 300 ms; A: p95 ≤ 500 ms
- hybrid A+: p95 ≤ 1000 ms; A: p95 ≤ 1500 ms
- semantic A+: p95 ≤ 2000 ms; A: p95 ≤ 3000 ms
- A+ proof: each benchmark report must have repeat ≥ 5 and ≥ 10 measured
  requests; direct query eval evidence must include ≥ 2 evaluated rows
- retrieval quality A+: hit rate ≥ 0.92 plus citation/eval evidence; A: ≥ 0.85

## S-grade blocker

The current S-grade blocker is **not** a Cloudflare runtime gap. It is missing
`KARTE_SESSION_COOKIE` and `STARBOARD_SESSION_COOKIE` for authenticated
product-session smokes. Without them, `smoke:consumer-auth` reports skipped
authenticated flows and S proof correctly remains blocked. See
[`STATUS.md`](../../STATUS.md).

## Cost-guarding

`readiness:full-port` skips Workers AI OCR until the deployed root aliases and
fingerprint prove the current Worker build, and still requires
`RAG_ALLOW_LIVE_OCR=1` or `--allow-live-ocr` before spending OCR. `proof:a-plus`
validates at least two labeled benchmark/eval queries locally before any live
request, and fail-fasts after readiness if the deployed fingerprint/health
checks are stale. Use `--dry-run` to inspect planned proof without network
calls or file writes.
