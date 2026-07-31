# public-landing-discovery Specification

## Purpose
TBD - created by archiving change recover-public-landing. Update Purpose after archive.
## Requirements
### Requirement: Independent public landing

Knowledge Base SHALL provide a public landing package that builds and deploys
independently from the Access-protected operator dashboard and the RAG Worker.

#### Scenario: Guest opens the public product

- **WHEN** a guest visits `knowledgebase.sassmaker.com`
- **THEN** the landing explains the product without requiring authentication or
  loading private dashboard code

#### Scenario: Public package is inspected

- **WHEN** the built output is audited
- **THEN** it contains no private collections, corpus text, citations, operator
  routes, service credentials, or Worker proxy

### Requirement: Complete agent discovery

The public landing SHALL expose `/llms.txt`, `/llms-full.txt`, `/api/ai`,
`/index.md`, `robots.txt`, and `sitemap.xml` from the same canonical public
route registry.

#### Scenario: Crawler discovers public routes

- **WHEN** a crawler reads the sitemap
- **THEN** every listed URL is a same-origin HTML route with a same-origin
  Markdown counterpart

#### Scenario: Agent reads the catalog

- **WHEN** an agent requests `/api/ai`
- **THEN** every catalog entry resolves to a public HTML route and its Markdown
  representation

### Requirement: Honest release evidence

The source change SHALL NOT claim a production visibility improvement until the
public landing is deployed and re-audited at its canonical origin.

#### Scenario: Local verification passes

- **WHEN** the source package builds and local discovery checks pass
- **THEN** the result is recorded as source-ready and production remains
  unchanged
