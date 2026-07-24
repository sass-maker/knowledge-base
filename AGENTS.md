# AGENTS.md — knowledgebase

> Concise agent bootloader. Depth lives in `docs/` (see
> [`docs/index.md`](docs/index.md)). Live state in [`STATUS.md`](STATUS.md).

## Shared fleet standard

Also read and follow the shared fleet-level agent standard at `../AGENTS.md`.
Treat this repository as owned product code: protect production stability,
keep changes scoped, verify work, and record durable follow-up tasks when
something remains incomplete or blocked.

## What this is

**Private Agent Search** — the fleet `RAG_SERVICE`. A Cloudflare Worker does
cited search + grounded answers over private, specialized corpora (research
papers, company private information, filings, contracts, manuals, notes) with
explicit schemas and `(file_id, page, excerpt)` provenance for agents. Mantra:
**"cited or it didn't happen."**

`knowledgebase` is the **only** fleet RAG codebase. The sibling `../rag-service`
repo is retired; do not recreate it.

## Repo shape

Monorepo, **three independently-built packages**, no root `package.json`, no
root workspace. Each package has its own `pnpm-lock.yaml` — install per package.

| Package | Path | Stack |
| --- | --- | --- |
| RAG Worker (the product) | `cloudflare/worker/` | Hono, Workers AI, Vectorize, D1, R2, Queues, Workflows |
| Dashboard app | `app/` | Vite + React (static) → Cloudflare Pages |
| Landing page | `landing-astro/` | Astro (static) → Cloudflare Pages |

Retired reference: `src/kb/` (Python), root `migrations/` (legacy Postgres),
`data/` (local corpus, gitignored). Active D1 migrations:
`cloudflare/worker/migrations/`. Demo domains: `domains/sec/`, `domains/legal/`.

## Essential commands

```bash
# Worker (from cloudflare/worker/)
pnpm install
pnpm dev                 # wrangler dev --local
pnpm check               # typecheck + vitest run  ← the CI gate
pnpm test                # vitest run
pnpm typecheck           # tsc --noEmit
pnpm run predeploy:local # the full local pre-deploy gate (asks for sibling repos)
pnpm deploy              # wrangler deploy — ASK before touching prod

# App (from app/)            pnpm install / pnpm dev / pnpm build / pnpm typecheck
# Landing (from landing-astro/)  pnpm install / pnpm build / pnpm preview

# Docs (from repo root)
pnpm install --frozen-lockfile
pnpm run docs:check      # markdown link + frontmatter validation
pnpm run docs:build      # Blume build (presentation layer only)
```

Root `Makefile` wraps common Worker gates (`make worker-check`,
`make worker-preflight`, `make worker-gaps`, `make worker-predeploy-local`).

## Critical constraints

- **Never commit secrets.** `RAG_SERVICE_KEYS`, `.env`, SSH keys, cloud
  credentials, kube configs, production configs are off-limits.
- **Never deploy, run migrations, push, release, or open PRs without explicit
  approval.** Make changes locally on a branch and leave them for review.
- **Do not recreate a sibling `rag-service`.** `audit:sibling-rag-service
  --require-retired` is a release gate.
- **Do not deploy or run migrations against prod without explicit approval.**
- **Cited or it didn't happen.** Any new retrieval/answer route must terminate
  at a retrievable `(file_id, page, excerpt)` triple. See
  [`docs/architecture/decisions.md`](docs/architecture/decisions.md) A3.
- **Per-process locks do not protect across processes; do not mark a resource
  "ensured" on the failure path.** See
  [`docs/knowledge/failed-approaches.md`](docs/knowledge/failed-approaches.md).
- **Loud error logging + defensive LLM JSON parsing are non-optional.** See
  [`docs/architecture/decisions.md`](docs/architecture/decisions.md) A11.

## Documentation navigation

- **Live status:** [`STATUS.md`](STATUS.md)
- **Docs home:** [`docs/index.md`](docs/index.md)
- **Product:** [`docs/product/overview.md`](docs/product/overview.md)
- **Architecture + decisions:** [`docs/architecture/overview.md`](docs/architecture/overview.md) · [`docs/architecture/decisions.md`](docs/architecture/decisions.md)
- **Dev + testing:** [`docs/development/workflows.md`](docs/development/workflows.md) · [`docs/development/testing.md`](docs/development/testing.md)
- **Operations:** [`docs/operations/runbook.md`](docs/operations/runbook.md) · [`docs/operations/jobs.md`](docs/operations/jobs.md)
- **Learnings + failed approaches:** [`docs/knowledge/learnings.md`](docs/knowledge/learnings.md) · [`docs/knowledge/failed-approaches.md`](docs/knowledge/failed-approaches.md)
- **Worker package README:** [`cloudflare/worker/README.md`](cloudflare/worker/README.md) (route inventory, deploy/release gates)
- **Public README:** [`README.md`](README.md)

## Documentation-maintenance rules

1. Markdown in `docs/` is the source of truth. Blume only renders it.
2. One fact, one home. If a fact lives in code, link to the code.
3. `docs/knowledge/archive/` holds snapshots — do not rewrite their bodies;
   update the current doc that supersedes them.
4. Prefer `git mv` when reorganizing to preserve rename history.
5. Run `pnpm run docs:check` before committing doc changes. CI enforces it.
6. Full maintenance guide: [`docs/maintenance.md`](docs/maintenance.md).
