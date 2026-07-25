## Why

The operator dashboard is the canonical human surface for Knowledgebase, but it
currently asks operators to paste a shared service key into the browser and
only exposes partial corpus and query state. Internal operators need identity-
based access and complete, scannable inspection surfaces before the dashboard
can replace ad hoc API calls.

## What Changes

- **BREAKING**: replace browser-local Worker URL and service-key configuration
  with Cloudflare Access identity and a same-origin server-side API proxy.
- Make the dashboard the unambiguous operator home and surface the signed-in
  operator in the shell.
- Add a first-class Data screen for files, extracted chunks, ingestion jobs,
  entities, and relationships with domain filters, search, status/type filters,
  pagination, empty states, and visible failures.
- Replace the Traces destination with a first-class Query History screen that
  supports all-domain inspection, filtering, citations, answer details, export,
  and quality drilldown while retaining `/traces` as a compatibility route.
- Add an authenticated read endpoint for stored chunks so operators can inspect
  the exact indexed excerpts and their `(file_id, page, excerpt)` provenance.

## Capabilities

### New Capabilities

- `internal-operator-access`: Verified Cloudflare Access identity and a
  same-origin dashboard-to-Worker proxy that keeps the service key server-side.
- `operator-observability`: First-class corpus data and query-history inspection
  workflows for internal operators.

### Modified Capabilities

- `static-dashboard-delivery`: Replace direct browser-to-Worker configuration
  with the authenticated Pages Function boundary and add the new dashboard
  routes.

## Impact

- Dashboard: routing, navigation, auth guard, settings, API client, overview,
  new Data screen, and expanded Query History screen.
- Cloudflare Pages: Functions runtime, Access JWT configuration, and a
  server-side `RAG_SERVICE_KEY` secret.
- Worker: one service-key-protected chunk-list route and metadata repository
  read method.
- Dependency: add `jose` to the dashboard package for Cloudflare-recommended
  JWT signature, issuer, audience, and expiry validation.
- Deployment is intentionally out of scope for this local change; Pages
  secrets and the Access application must be configured before release.
