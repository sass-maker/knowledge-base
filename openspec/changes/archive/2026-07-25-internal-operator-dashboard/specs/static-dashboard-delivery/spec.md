## MODIFIED Requirements

### Requirement: Dashboard route parity

The static dashboard SHALL preserve the existing `/`, `/domains`, `/ingest`,
`/query`, `/traces`, `/evals`, and `/settings` routes and SHALL add `/data` and
`/history`, with `/traces` rendering the Query History screen for compatibility.

#### Scenario: Guest opens a deep link

- **WHEN** a browser requests any supported dashboard path directly
- **THEN** the static host returns the application shell and the matching screen renders after operator authentication

#### Scenario: Operator navigates in the shell

- **WHEN** the operator selects a sidebar destination
- **THEN** the URL and rendered screen update without a full document reload

### Requirement: Direct Worker API behavior

The dashboard SHALL send Worker API requests through a same-origin Pages
Function that authenticates the operator with Cloudflare Access and injects the
RAG service key from server-side configuration. The dashboard MUST NOT request,
store, or transmit the service key in browser code.

#### Scenario: Operator opens the dashboard

- **WHEN** the operator has a valid Cloudflare Access session
- **THEN** the dashboard loads the verified identity and uses the same-origin API proxy without asking for Worker credentials

#### Scenario: Operator configures the dashboard

- **WHEN** the Pages runtime has the Access settings, Worker URL, and service key configured
- **THEN** the browser uses the same-origin proxy without receiving or storing the Worker service key

#### Scenario: Operator lacks an Access session

- **WHEN** the operator has no valid Cloudflare Access session
- **THEN** protected dashboard data is not rendered and no Worker request is forwarded
