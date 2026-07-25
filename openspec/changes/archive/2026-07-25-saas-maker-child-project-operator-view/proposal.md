## Why

The internal dashboard is authenticated correctly but is bound to the
`default` tenant, so it presents the old `legal` and `sec` showcase corpus
instead of the real projects that use Knowledgebase. Knowledgebase should stay
an independently deployed private service while acting as shared retrieval
infrastructure for SaaS Maker projects.

## What Changes

- Add a dashboard-only project inventory that can enumerate the Worker's
  project scopes without weakening normal service-key tenant isolation.
- Allow the dedicated dashboard credential to select a project scope for
  subsequent API requests; ordinary consumer and proof credentials remain
  fixed to their configured tenant.
- Add a compact project selector to the internal dashboard and reload every
  operator workflow in the selected project scope.
- Hide known demo, smoke, proof, verification, and performance scopes by
  default while retaining an explicit way to inspect them.
- Reframe dashboard copy and repository status around “SaaS Maker
  Knowledgebase,” a private shared service rather than a public standalone
  product.
- Do not delete production D1, R2, or Vectorize data in this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `internal-operator-access`: Permit verified dashboard requests to choose a
  project scope without granting the same authority to consumer credentials.
- `operator-observability`: Add project-level navigation and default filtering
  of non-product scopes across the operator dashboard.

## Impact

- Worker authentication context and one dashboard-only read endpoint.
- Pages proxy forwarding rules for the selected project header.
- React application state, sidebar navigation, API client, and product copy.
- Worker and app tests plus internal operations documentation.
- No new dependency, migration, production deletion, or deployment.
