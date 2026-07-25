## Context

The Vite dashboard is a static Cloudflare Pages application. It currently sends
requests directly to the RAG Worker and stores an operator-provided service key
in browser `localStorage`. That is appropriate for low-level testing but is the
wrong trust boundary for the canonical internal application. The Worker must
continue supporting service keys because fleet agents and service integrations
use that contract.

The existing dashboard already has domain, ingestion, query, eval, and trace
screens. The new work should preserve that visual system and route behavior
while making data and history inspection first-class.

## Goals / Non-Goals

**Goals:**

- Authenticate human operators with Cloudflare Access.
- Keep the Worker service key out of browser storage, JavaScript, and network
  requests visible to the operator.
- Provide dense, searchable inspection of corpus records and query history.
- Preserve the Worker's service-key API for non-human consumers.
- Preserve citation provenance through the new chunk inspection route.

**Non-Goals:**

- Configure or deploy the live Cloudflare Access application or Pages secrets.
- Replace service-key authentication for agent or backend integrations.
- Build public multi-user accounts, roles, invitations, or tenant switching.
- Add mutation controls to the new Data screen.
- Add a new database or migration.

## Decisions

### Use a Pages Function as a backend-for-frontend

Dashboard requests will target same-origin `/api/v1/*`. A catch-all Pages
Function validates the Access token and forwards allowed HTTP requests to the
configured Worker, injecting `Authorization: Bearer <RAG_SERVICE_KEY>` from a
Pages secret. It will not forward cookies, the Access assertion, or hop-by-hop
headers.

This keeps the existing Worker contract stable and avoids exposing the service
key. Direct Worker calls from the browser were rejected because they retain the
shared-secret problem. Adding human auth directly to every Worker route was
rejected because it would mix operator identity with the stable service
contract and still leave cross-origin Access session handling.

### Validate the Access JWT at the function boundary

The function will validate `Cf-Access-Jwt-Assertion` using the Access team's
remote JWK set, expected issuer, and configured application audience. It will
use `jose`, the implementation recommended by Cloudflare, rather than trusting
identity headers or maintaining custom JWT cryptography. A separate
`/api/session` function returns only the verified email and subject needed by
the shell.

For local Pages preview, an explicit `CF_ACCESS_DEV_EMAIL` binding is allowed
only when the request hostname is localhost. It does not bypass the upstream
service-key requirement and is never configured in production.

### Add a read-only stored-chunk route

The Worker will expose `GET /v1/kb/chunks` behind the existing service-key
middleware. It accepts optional `domain` and `file_id` filters plus a bounded
limit, returns newest records first, and includes chunk ID, file ID, page range,
text, and metadata. This is the minimum new API needed for operator data
inspection and preserves `(file_id, page, excerpt)` provenance.

### Use dense tables with local inspection controls

The Data page uses one domain selector and tabs for Files, Chunks, Jobs,
Entities, and Relationships. Each tab provides the filters meaningful to that
record type, client-side pagination over a bounded server result, useful empty
states, and expandable long text/errors without nested cards.

Query History fetches recent traces across all domains by default, supports
domain, text, and mode filters, paginates the result, and expands a row into its
answer and citations. Quality drilldown remains lazy so opening history is
cheap. `/traces` renders the same page for saved links while navigation uses
`/history`.

### Preserve the current product visual register

This is a dense internal operations tool used during debugging and corpus
review. The existing neutral dark palette, typography, controls, and sidebar
remain. New screens prioritize table hierarchy, standard filters, visible
states, keyboard operation, responsive overflow, and reduced motion rather
than introducing a redesign.

## Risks / Trade-offs

- **Access is not configured when code ships** → the guard fails closed with a
  setup-focused error; deployment docs list the required audience, team domain,
  and secrets.
- **The `pages.dev` hostname bypasses a custom-domain Access policy** → protect
  both hostnames or disable the fallback before release; JWT validation in the
  Function still prevents API proxy use without a valid token.
- **Remote JWK retrieval is temporarily unavailable** → `jose` caches the JWK
  set in the isolate; failures return 401/503 without forwarding upstream.
- **Large corpora exceed one response window** → list endpoints use bounded
  limits and the UI discloses the loaded window; durable cursor pagination can
  be added later if corpus size requires it.
- **A proxy broadens the dashboard's API reach** → only `/v1/*` is forwarded,
  upstream authority is fixed by configuration, and unsafe headers are rebuilt.

## Migration Plan

1. Land and validate the Worker chunk route and dashboard Pages Functions.
2. Configure `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` as Pages variables and
   `RAG_SERVICE_URL` plus `RAG_SERVICE_KEY` as server-side Pages configuration.
3. Protect the dashboard hostnames with a Cloudflare Access allow policy for
   the operator identity.
4. Deploy the Worker first, then the Pages dashboard.
5. Verify session identity, corpus data, query history, and a proxied query.
6. Roll back the Pages deployment if Access or proxy verification fails; the
   Worker's service-key API remains unchanged.

## Open Questions

- Whether the live `pages.dev` hostname should be disabled or protected with a
  second Access application is a release decision.
- Cursor-based server pagination remains deferred until loaded-window limits
  are insufficient in real operator use.
