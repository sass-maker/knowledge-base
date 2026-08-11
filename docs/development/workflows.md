---
title: Development workflows
description: Per-package commands, pre-commit hooks, CI, and branching for the knowledgebase monorepo.
---

# Development workflows

> Implementation detail (exact script names, versions) lives in each package's
> `package.json`. This page is the workflow shape and the non-obvious
> constraints.

## Repo shape

Monorepo with **two independently-built product packages** plus separate root
docs tooling and no root workspace. Each package has its own `pnpm-lock.yaml`.
Install per package.

| Package | Path | Stack | Build |
| --- | --- | --- | --- |
| RAG Worker | `cloudflare/worker/` | Hono, Workers AI, Vectorize, D1, R2 | `wrangler` |
| Dashboard app | `app/` | Vite + React (static) | `tsc --noEmit` → `vite build` |

Legacy Python artifacts (`src/kb/`, `migrations/01_*..07_*`, Docker Compose)
are retired reference material. The active D1 migrations live in
`cloudflare/worker/migrations/`; the root `migrations/` folder is the legacy
Postgres set kept for migration-tooling reference.

## Per-package commands

```bash
# Worker (from cloudflare/worker/)
pnpm install
pnpm dev                 # wrangler dev --local
pnpm check               # typecheck + vitest run  (the CI gate)
pnpm test                # vitest run
pnpm typecheck           # tsc --noEmit
pnpm deploy              # wrangler deploy — ASK before touching prod

# App (from app/)
pnpm install
pnpm dev                 # vite
pnpm build               # typecheck + static dist build
pnpm typecheck           # tsc --noEmit
pnpm check               # typecheck + lint
pnpm preview:cf          # build + full Pages Functions preview (uses ignored .dev.vars)
pnpm deploy:cf           # Pages direct upload — ASK before touching prod
```

`pnpm dev` serves only the Vite shell; authenticated `/api` calls require the
Pages Functions runtime. See
[`operations/dashboard-access.md`](../operations/dashboard-access.md) for the
ignored local bindings and production Access configuration.

The root `Makefile` wraps the most common Worker gates (`make worker-check`,
`make worker-preflight`, `make worker-gaps`, `make worker-predeploy-local`,
etc.) so you can run them from the repo root.

## Pre-commit hooks

Two hook systems run on `git commit`; both pass:

- `.husky/pre-commit` — `uv run ruff format --check` + `ruff check` on staged
  Python (inert now that the Python runtime is retired, but kept for the
  legacy `src/kb/` reference tree if it ever reappears).
- `.pre-commit-config.yaml` — pre-commit framework hooks: trailing whitespace
  (excludes `.md`), end-of-file fixer, YAML/TOML/JSON validators,
  large-file guard (`--maxkb=512`), merge-conflict / debug-statement /
  private-key detectors, ruff + ruff-format on `src/` and `tests/`, and
  `validate-pyproject`.

Install pre-commit once with `uv tool install pre-commit && pre-commit install`.
The husky hook is committed; pre-commit is the cross-language orchestrator.

## CI

`.github/workflows/ci.yml` runs on push to `main` and on PRs:

- `quality` job: installs each independent package from its own frozen lockfile,
  then runs root `pnpm quality`. The aggregate gate covers check-only formatting,
  docs, dashboard lint/type/build/scoped coverage, Worker type/coverage, landing
  build and agent surfaces, unused code, complexity, duplication, dependency
  advisories, cycles, suppressions, and repository hygiene.

Run the same gate locally after installing all four dependency roots:

```bash
pnpm install --frozen-lockfile
pnpm --dir app install --frozen-lockfile
pnpm --dir cloudflare/worker install --frozen-lockfile
pnpm --dir landing-astro install --frozen-lockfile
pnpm quality
```

Measured legacy debt is held to explicit no-regression baselines in
`scripts/check-code-health.mjs`. Lower a baseline after cleanup; never refresh
one automatically. Remaining debt belongs in GitHub issue #33.

The local full-fleet `predeploy:local` gate (which builds sibling fleet
products and reads repos on disk) only works in a full local fleet checkout,
not single-repo CI. Run `pnpm run predeploy` locally before shipping. See
[`testing.md`](testing.md).

`.github/workflows/eval.yml` runs on PRs touching `cloudflare/**` or
`domains/**`: `eval:parse:legacy:dry-run`, `preflight --json`,
`gaps:full-port --json`. It is a dry-run gate; it does not spend AI calls.

`.github/workflows/docs.yml` validates this docs tree (link check + Blume
build). See [`maintenance.md`](../maintenance.md).

## Branching

- `main` is the deployable trunk.
- Feature work branches off `main` (e.g. `docs/knowledge-system-consolidation`).
- Do not push, deploy, release, run migrations, or open PRs without explicit
  approval — see `AGENTS.md` constraints.
- Keep diffs small and reviewable. Preserve unrelated in-progress work.

## Non-obvious constraints

- **No root workspace.** `pnpm install` must be run inside each package.
  Adding a root `package.json` would break the per-package lockfile model.
- **`cloudflare/worker/wrangler.jsonc` is the binding source of truth.** If
  bindings drift from the expected Cloudflare services, `pnpm run preflight`
  fails. Fix the config, not the preflight.
- **Do not commit secrets.** `RAG_SERVICE_KEYS`, `.env`, SSH keys, cloud
  credentials, kube configs, and production configs are off-limits. The
  pre-commit `detect-private-key` hook guards PEM-style keys; it is not a
  substitute for judgment.
- **Dashboard credentials are server-side.** Never expose `RAG_SERVICE_KEY`
  through a `VITE_*` variable or browser storage. The Pages Function owns the
  Worker credential; Cloudflare Access owns human identity.
- **Do not recreate a sibling `rag-service`.** `audit:sibling-rag-service
  --require-retired` is a release gate. See
  [`architecture/decisions.md`](../architecture/decisions.md) A1.
