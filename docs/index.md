---
title: Knowledgebase docs
description: Private Agent Search — cited RAG over private, specialized corpora. Product, architecture, operations, and durable learnings for the knowledgebase fleet RAG service.
---

# Knowledgebase docs

> Source of truth is the Markdown in this `docs/` tree (plus the code).
> Blume renders it; it does not own it. See
> [`docs/maintenance.md`](maintenance.md) for how to edit this knowledge system.

**Knowledgebase** is the fleet `RAG_SERVICE`: a Cloudflare Worker that does
cited search and grounded answers over private, specialized document
collections. Exa-style search for corpora the open web cannot reach — research
papers, company private information, filings, contracts, manuals, notes — with
explicit schemas and `(file, page, excerpt)` provenance for agents.

- **Live status:** [`STATUS.md`](../STATUS.md)
- **Agent bootloader:** [`AGENTS.md`](../AGENTS.md)
- **Public README:** [`README.md`](../README.md)
- **Worker package README:** [`cloudflare/worker/README.md`](../cloudflare/worker/README.md)

## Start here

| If you want to… | Read |
| --- | --- |
| Understand what this product is and is not | [`product/overview.md`](product/overview.md) |
| See how it works end to end (ingest + query) | [`architecture/how-it-works.md`](architecture/how-it-works.md) |
| See the runtime shape and storage split | [`architecture/overview.md`](architecture/overview.md) |
| Understand the non-obvious architectural choices | [`architecture/decisions.md`](architecture/decisions.md) |
| Run the Worker locally / ship a change | [`development/workflows.md`](development/workflows.md) |
| Run tests, evals, smokes, readiness gates | [`development/testing.md`](development/testing.md) |
| Operate or debug a deployment | [`operations/runbook.md`](operations/runbook.md) |
| Add a new corpus domain | [`product/onboard-new-domain.md`](product/onboard-new-domain.md) |
| Call the API from an agent | [`product/agent-tool-contract.md`](product/agent-tool-contract.md) |

## Full map

### Product

- [`product/overview.md`](product/overview.md) — thesis, wedge, surfaces, what is real today
- [`product/agent-search-direction.md`](product/agent-search-direction.md) — product direction and gap map
- [`product/agent-tool-contract.md`](product/agent-tool-contract.md) — `/v1/kb/query` HTTP contract for agents
- [`product/agent-integration-examples.md`](product/agent-integration-examples.md) — tool schema + wrapper examples
- [`product/bring-your-own-corpus.md`](product/bring-your-own-corpus.md) — self-serve private corpus flow
- [`product/onboard-new-domain.md`](product/onboard-new-domain.md) — adding a third domain
- [`product/demo-walkthrough.md`](product/demo-walkthrough.md) — 5 live demos, in order

### Architecture

- [`architecture/how-it-works.md`](architecture/how-it-works.md) — code-grounded end-to-end walkthrough: components, ingest path, query path
- [`architecture/overview.md`](architecture/overview.md) — runtime, ingestion, retrieval, testing surface
- [`architecture/decisions.md`](architecture/decisions.md) — durable architectural decisions and the why behind each
- [`architecture/cloudflare-full-port.md`](architecture/cloudflare-full-port.md) — what Cloudflare can/cannot fill, with status

### Development

- [`development/workflows.md`](development/workflows.md) — per-package commands, pre-commit, CI, branching
- [`development/testing.md`](development/testing.md) — tests, evals, smokes, readiness/release gates

### Operations

- [`operations/runbook.md`](operations/runbook.md) — worker checks, deployed smoke, parse eval, failure modes
- [`operations/hosting-personal.md`](operations/hosting-personal.md) — personal hosting checklist
- [`operations/highsignal-integration.md`](operations/highsignal-integration.md) — fleet consumer integration notes
- [`operations/jobs.md`](operations/jobs.md) — async ingestion (Queues + Workflows); no scheduled jobs
- [`operations/automation-inventory.md`](operations/automation-inventory.md) — automation inventory and Foundry evidence contract (auth-safe health, sanitized evidence, storage ownership, maintenance-only authority)

### Knowledge

- [`knowledge/learnings.md`](knowledge/learnings.md) — durable lessons that survive the Python→Cloudflare migration
- [`knowledge/failed-approaches.md`](knowledge/failed-approaches.md) — methodology bugs, ghost features, and resolved traps
- [`knowledge/new-things.md`](knowledge/new-things.md) — study queue for non-standard tech in this repo
- [`knowledge/archive/`](knowledge/archive/) — preserved snapshots (Python-era notes, submission brief, external review, status log)

### Meta

- [`maintenance.md`](maintenance.md) — how to edit this docs system, validation, and Blume build

## Conventions

- Markdown in this tree is the source of truth. Code and `wrangler.jsonc` /
  `package.json` / migrations remain authoritative for implementation details.
- One fact, one home. If a fact lives in code, link to the code instead of
  restating it.
- Historical snapshots live under `knowledge/archive/` and are linked from the
  current docs that supersede them. Do not edit archive bodies to "update" them;
  update the current doc and let the archive stay a snapshot.
- Mark unresolved questions explicitly (see `STATUS.md` → "Unresolved
  questions").
