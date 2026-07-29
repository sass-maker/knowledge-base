# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Fleet operators and agents that need cited retrieval over private, specialized corpora such as research papers, company information, filings, contracts, manuals, and notes.

## Product Purpose

Private Agent Search ingests structured and unstructured source material, retrieves scoped evidence, and returns grounded answers with file, page, and excerpt provenance.

## Positioning

The product’s invariant is “cited or it didn’t happen”: retrieval and answer workflows terminate in inspectable source evidence rather than unsupported model prose.

## Capabilities and Constraints

- The Cloudflare Worker is the only RAG runtime.
- Dashboard access is private and protected by Cloudflare Access.
- Tenant and project scope must remain explicit.
- Production deploys and migrations require human approval.

## Evidence on Hand

Current state lives in `STATUS.md`; historical product truth is archived under `docs/knowledge/archive/`; dashboard implementation lives in `app/`.

## Product Principles

- Preserve citation provenance.
- Keep private corpora private and scoped.
- Fail loudly when evidence or access is missing.
- Separate shipped history from the GitHub work queue.

