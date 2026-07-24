# static-dashboard-delivery Specification

## Purpose
TBD - created by archiving change migrate-dashboard-to-vite. Update Purpose after archive.
## Requirements
### Requirement: Static dashboard build
The dashboard SHALL build as a static Vite and React artifact without requiring
a Next.js or server runtime.

#### Scenario: Production build
- **WHEN** the dashboard production build runs
- **THEN** it emits a self-contained `dist/` directory suitable for Cloudflare Pages

### Requirement: Dashboard route parity
The static dashboard SHALL preserve the existing `/`, `/domains`, `/ingest`,
`/query`, `/traces`, `/evals`, and `/settings` routes.

#### Scenario: Guest opens a deep link
- **WHEN** a browser requests any supported dashboard path directly
- **THEN** the static host returns the application shell and the matching screen renders

#### Scenario: Operator navigates in the shell
- **WHEN** the operator selects a sidebar destination
- **THEN** the URL and rendered screen update without a full document reload

### Requirement: Direct Worker API behavior
The dashboard SHALL continue sending API requests directly from the browser to
the configured RAG Worker and MUST NOT include the operator service key in the
static build artifact.

#### Scenario: Operator configures the dashboard
- **WHEN** the operator enters a service URL and service key
- **THEN** the values remain browser-local and subsequent API calls use them

### Requirement: Public agent assets
The static dashboard SHALL continue serving its public `llms.txt`,
`llms-full.txt`, `index.md`, robots, and JSON agent-description assets.

#### Scenario: Agent fetches a public asset
- **WHEN** an unauthenticated client requests a published agent asset
- **THEN** the static host returns the checked-in file without loading the dashboard application
