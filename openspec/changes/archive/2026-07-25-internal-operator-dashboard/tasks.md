## 1. Internal Access Boundary

- [x] 1.1 Add Cloudflare Access JWT validation and verified session handling to Pages Functions
- [x] 1.2 Add a restricted same-origin `/api/v1/*` proxy that injects the server-side Worker service key
- [x] 1.3 Replace browser service-key configuration with the internal access guard and identity-focused settings

## 2. Operator Data APIs

- [x] 2.1 Add a tenant-scoped stored-chunk list method and Worker route
- [x] 2.2 Add focused Worker regression tests for chunk filtering, limits, and tenant isolation
- [x] 2.3 Extend the dashboard API client for same-origin proxying and bounded all-domain data reads

## 3. Operator Experience

- [x] 3.1 Make the dashboard navigation and overview the canonical operator home
- [x] 3.2 Build the Data screen with record tabs, filters, pagination, provenance, and failure states
- [x] 3.3 Expand Traces into Query History with all-domain filters, pagination, citations, export, and drilldown
- [x] 3.4 Preserve `/traces` compatibility while linking new query results to `/history`

## 4. Documentation and Verification

- [x] 4.1 Document the Access, Pages variable, secret, local-preview, deployment, and rollback requirements
- [x] 4.2 Update active product/status documentation for the canonical internal dashboard
- [x] 4.3 Run strict OpenSpec validation, focused Worker tests, dashboard checks/build, docs checks, and diff checks
