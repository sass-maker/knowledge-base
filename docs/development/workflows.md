---
title: Development workflows
description: Per-package commands, pre-commit hooks, CI, and branching for the knowledgebase monorepo.
---

# Development workflows

> Implementation detail (exact script names, versions) lives in each package's
> `package.json`. This page is the workflow shape and the non-obvious
> constraints.

## Repo shape

Monorepo with **three independently-built packages** and no root
`package.json` / no root workspace. Each package has its own `pnpm-lock.yaml`.
Install per package.

| Package | Path | Stack | Build |
| --- | --- | --- | --- |
| RAG Worker | `cloudflare/worker/` | Hono, Workers AI, Vectorize, D1, R2 | `wrangler` |
| Dashboard app | `app/` | Vite + React (static) | `tsc --noEmit` → `vite build` |
| Landing page | `landing-astro/` | Astro (static) | `astro build` |

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
pnpm preview:cf          # build + local Pages preview
pnpm deploy:cf           # Pages direct upload — ASK before touching prod

# Landing (from landing-astro/)
pnpm install
pnpm build               # astro build
pnpm preview             # astro preview
```

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

- `worker-check` job: `pnpm install --frozen-lockfile` then `pnpm run check`
  (typecheck + vitest) in `cloudflare/worker`. This is the comprehensive logic
  gate that runs in single-repo CI.

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
- **Do not recreate a sibling `rag-service`.** `audit:sibling-rag-service
  --require-retired` is a release gate. See
  [`architecture/decisions.md`](../architecture/decisions.md) A1.
