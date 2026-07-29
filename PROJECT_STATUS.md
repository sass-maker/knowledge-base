# knowledgebase — PROJECT STATUS

> Short live-status view. Detailed historical status log preserved at
> [`docs/knowledge/archive/project-status-2026-06-28.md`](docs/knowledge/archive/project-status-2026-06-28.md).
> Update this file when durable current or shipped product truth changes. Do
> not let deploy-version snapshots accumulate here — put those in the archive.

Last updated: 2026-07-25

## Why / What

Ship and operate **Private Agent Search** as the fleet `RAG_SERVICE` on
Cloudflare. Keep `knowledgebase` the only fleet RAG codebase; keep the
Cloudflare Worker (`cloudflare/worker`) the only runtime; keep cited evidence
the non-negotiable product invariant.

## Dependencies

- Cloudflare Workers, Pages, D1, Vectorize, R2, Access, and the Fleet `free-ai`
  gateway.
- Fleet consumers currently include Karte, Research Papers, and Starboard.

## Timeline

Historical milestones live in
[`docs/knowledge/archive/project-status-2026-06-28.md`](docs/knowledge/archive/project-status-2026-06-28.md).

## Products

- Worker RAG API and operator `/ui`.
- Access-protected dashboard at `https://search.sassmaker.com`.

## Features (shipped)

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

### Deploy fingerprint

The deployed Worker advertises
`knowledgebase-a-plus-evidence-2026-06-23`. `smoke:legacy-routes` and
`readiness:full-port` enforce the fingerprint by default; pass
`--expected-deploy-fingerprint <value>` only when intentionally deploying a
custom `RAG_DEPLOY_FINGERPRINT`. When the fingerprint changes, update this
line and move the old snapshot into the archive.

## Work queue

Open work is tracked only in [GitHub Issues](https://github.com/sass-maker/knowledge-base/issues).
An open issue is a to-do, a linked pull request is in progress, and merge plus
issue closure makes the work done.
