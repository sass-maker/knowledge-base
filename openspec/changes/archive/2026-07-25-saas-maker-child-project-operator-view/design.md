## Context

Knowledgebase remains a standalone repository, Worker, storage boundary, and
internal Pages dashboard. Its product role is narrower: it is private shared
retrieval infrastructure for SaaS Maker projects.

The Worker currently maps every service key to exactly one tenant. The
dedicated dashboard key is mapped to `default`, and every metadata route uses
that tenant, so the operator cannot inspect other projects. Production D1
already contains real project scopes alongside showcase, smoke, proof, and
performance scopes.

The Pages Function verifies Cloudflare Access and injects the dashboard key.
That server-side boundary is the appropriate place for a human operator to
select a project without exposing credentials to browser code.

## Goals / Non-Goals

**Goals:**

- Preserve independent repository and deployment ownership.
- Let the verified internal operator discover and switch between real project
  scopes.
- Keep consumer service keys strictly tenant-scoped.
- Hide non-product scopes by default without destroying evidence or test data.
- Make the dashboard's SaaS Maker support role explicit.

**Non-Goals:**

- Merge Knowledgebase into Fleet Ops or the retired SaaS Maker runtime.
- Delete or migrate production D1, R2, or Vectorize records.
- Connect projects that do not yet use Knowledgebase.
- Add public accounts, invitations, or multi-user authorization.
- Replace service-key authentication for product runtimes.

## Decisions

### Distinguish dashboard credentials in Worker authentication

`requireServiceKey` will preserve the source of a matching key in the request
context. Only a key from `RAG_SERVICE_DASHBOARD_KEYS` receives dashboard
authority. A dashboard request may supply `X-KB-Project`; the middleware
validates the project identifier and uses it as the request tenant. Consumer,
append, and proof keys stay fixed to their configured tenant and reject a
project override.

This reuses the already isolated dashboard secret rather than creating another
credential. Treating every service key as an operator key was rejected because
it would break tenant isolation.

### Add a dashboard-only project inventory

`GET /v1/kb/operator/projects` will list all known metadata projects with their
existing domain and file counts. It returns `403` unless the authenticated
credential came from `RAG_SERVICE_DASHBOARD_KEYS`.

The existing `/v1/kb/projects` route remains tenant-scoped for product
consumers. Broadening that stable route was rejected because existing callers
rely on its isolation contract.

### Carry selected project through the Pages proxy

The browser sends only the non-secret `X-KB-Project` identifier to same-origin
`/api/v1/*`. The Access-verified Pages Function forwards that header with the
server-side dashboard key. It does not accept an upstream URL or credential
from the browser.

### Keep project state in one React provider

An operator-project provider loads the inventory after Access verification,
chooses the first visible product project, and exposes selection plus a
“show internal scopes” preference. The API client reads the current project
for every request. The routed page remounts on selection so existing page-local
fetch effects reload without a broad state-management rewrite.

Known non-product names and prefixes are classified in one helper. They remain
available behind an explicit toggle; no data is deleted. Known opaque project
identifiers may receive display labels while the raw identifier stays visible.

### Preserve the existing product UI register

The sidebar gains one compact native select and a small internal-scope toggle.
The existing dense dark operations layout, controls, typography, and navigation
remain. Copy changes identify the surface as “SaaS Maker Knowledgebase” and
describe the selected child project.

## Risks / Trade-offs

- **Dashboard key compromise broadens read/write reach** → The key remains only
  in the Access-verified Pages Function, and broad authority is limited to the
  dedicated dashboard key source.
- **Project names are not a formal product registry** → The selector reflects
  actual Knowledgebase scopes; fixture classification is centralized and raw
  identifiers remain visible.
- **A selected project disappears** → The provider falls back to the next
  visible project and shows a clear empty state when none exist.
- **Page-local requests race during switching** → The routed page remounts
  under a project-specific key, discarding the old screen state.

## Migration Plan

1. Deploy the Worker with credential-source authorization and the operator
   inventory route.
2. Deploy the Pages dashboard with project selection and header forwarding.
3. Verify the operator sees real project scopes while fixture scopes are hidden
   by default.
4. Verify a consumer key cannot enumerate projects or override its tenant.
5. Roll back Pages first, then Worker if project switching fails; tenant-scoped
   consumer behavior remains compatible throughout.

## Open Questions

- Permanent deletion of the `default/legal` and `default/sec` showcase corpus
  remains a separate explicitly authorized production cleanup.
- Project display names can later come from a maintained SaaS Maker catalog if
  opaque identifiers become common.
