# STATUS — knowledgebase

> Short live-status view. Detailed historical status log preserved at
> [`docs/knowledge/archive/project-status-2026-06-28.md`](docs/knowledge/archive/project-status-2026-06-28.md).
> Update this file when the objective, active work, blockers, or next steps
> change. Do not let deploy-version snapshots accumulate here — put those in
> the archive.

Last updated: 2026-07-25

## Objective

Ship and operate **Private Agent Search** as the fleet `RAG_SERVICE` on
Cloudflare. Keep `knowledgebase` the only fleet RAG codebase; keep the
Cloudflare Worker (`cloudflare/worker`) the only runtime; keep cited evidence
the non-negotiable product invariant.

## Current state

- **Runtime:** Cloudflare Worker is the only RAG runtime. Python FastAPI
  service, Python UI, Docker Compose, and the sibling `../rag-service` repo
  are retired. `audit:sibling-rag-service --require-retired` stays green.
- **Embedding-model/catalog release:** live. `free-ai` gateway returns 6
  enabled embedding models; all advertised dimensions (384/768/1024/1536) have
  Vectorize bindings + `tenant`/`index_id` metadata indexes; D1 migrations
  `0005`/`0006`/`0007` applied; `release-status:embedding-model`,
  `readiness:embedding-model`, `smoke:rag-crud:embedding-model`, and
  `readiness:full-port` (with `RAG_ALLOW_LIVE_OCR=1`) report `ok: true`.
- **Performance cache release:** live. `RAG_SHARED_QUERY_CACHE_ENABLED=true`,
  `RAG_SHARED_EMBEDDING_CACHE_ENABLED=true`; semantic queries use a strong
  lexical precheck before embedding/Vectorize.
- **A+ evidence release:** deployed. Live Starboard-domain proof passed
  overall A+ (readiness, scoped query eval, lexical `kb-search`, semantic
  `kb-query`, ingestion, observability, hosted UI). Final benchmark p95s:
  lexical 99.46 ms, semantic 550.73 ms; query eval hit/citation rates 1.0.
- **Frontend surfaces:** Vite + React dashboard deployed on Cloudflare Pages at
  `search.sassmaker.com`; Worker `/ui` operator testing surface. The former
  OpenNext Worker remains available on its `workers.dev` hostname as a rollback
  target, but no longer owns the production custom domain. Home, operator
  configuration, navigation, and direct `/domains` deep-link smoke passed after
  the 2026-07-25 cutover. The internal dashboard is now protected by Cloudflare
  Access with a single-email allow policy on the custom, Pages, and preview
  hostnames; its server-side proxy uses a dedicated tenant-scoped Worker
  credential. Live Data, Query History, and cited-query verification passed.
- **Deployed corpus is live.** The `legal` and `sec` domains contain queryable
  files, entities, relationships, and recorded traces, but they are evaluation
  fixtures rather than SaaS Maker project data.
- **SaaS Maker project operator view:** live. The Access-protected dashboard
  discovers project scopes through a dashboard-only Worker route, selects
  Research Papers by default, switches independently to Starboard, and hides
  demo/test/proof scopes unless the operator enables them. Deployed from
  `777c39e`: Worker version `ec4b9572-9942-4009-9716-3d723106acca`; Pages
  deployment `07c5c2b9-7c37-4e08-8213-4efbacd708ab`.
- **Consumer boundary:** Karte remains an active Knowledgebase consumer for
  indexed profile memory. High Signal integration is cancelled: its current
  public-evidence workflow already has product-owned Git + D1 retrieval and
  does not need private-corpus search.
- **Owned release history:** the Access-protected dashboard now includes a
  same-origin `/changelog` with verified editorial milestones. Planned work
  remains in GitHub Issues; Source points to the canonical organization repo.

## Active work

- Docs consolidation (this branch): unify scattered root-level and `docs/`
  markdown into one canonical knowledge system with Blume as the presentation
  layer only. See `docs/index.md`.

## Blockers

- **S-grade proof:** missing `KARTE_SESSION_COOKIE` and
  `STARBOARD_SESSION_COOKIE` for authenticated product-session smokes. This
  is not a Cloudflare runtime gap. Without them `smoke:consumer-auth` reports
  skipped authenticated flows and `proof:s` correctly stays blocked.
- **AI Gateway cache:** implemented but not enabled (Wrangler OAuth blocked
  gateway creation at the time). Revisit when unblocked.
- **Semantic p99 < 300 ms on completely unique cold misses:** query-result and
  normalized embedding caches cover hot/repeated questions across isolates, not
  first-seen misses.

## Next steps

1. Complete live S-grade consumer proof once session cookies are available:
   `KARTE_SESSION_COOKIE=<cookie> STARBOARD_SESSION_COOKIE=<cookie> pnpm run
   smoke:consumer-auth -- --require-authenticated`, then re-run `proof:s`.
2. Add first-class ingest idempotency / failure-classification proof so the
   ingestion category can move from A+ to S without relying on route presence.
3. Keep post-cutover regression gates current whenever Worker routes,
   parser/OCR behavior, or fleet RAG consumers change: `pnpm run check`,
   `pnpm run gaps:full-port -- --json`, `pnpm run audit:sibling-rag-service
   -- --json`, deployed `smoke:legacy-routes --require-complete`.
4. Richer eval trend views per project/kind/filter on top of persisted Worker
   eval reports.
5. Framework-specific agent integration examples + an HTTP contract
   compatibility test around the stable `/v1/kb/query` contract.

## Deferred (durable)

- Public multi-user hosting (until auth, per-project authorization, upload
  limits, rate limits, job cancellation, backup drills, log redaction).
- Connector marketplace (manual/private corpus search remains the wedge).
- Per-project service-key rotation UI.
- Queue/workflow ingestion at scale on Worker.
- Exact Qdrant BM42 model equivalence on Worker (Cloudflare Vectorize is not
  BM42; the Cloudflare-native replacement is the accepted parity — see
  `docs/architecture/decisions.md` A4).
- Project templates (research papers, company knowledge, notes, manuals,
  contracts, docs-site snapshots).

## Deploy fingerprint

The deployed Worker advertises
`knowledgebase-a-plus-evidence-2026-06-23`. `smoke:legacy-routes` and
`readiness:full-port` enforce the fingerprint by default; pass
`--expected-deploy-fingerprint <value>` only when intentionally deploying a
custom `RAG_DEPLOY_FINGERPRINT`. When the fingerprint changes, update this
line and move the old snapshot into the archive.
