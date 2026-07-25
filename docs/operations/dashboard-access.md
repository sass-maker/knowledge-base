---
title: Internal dashboard access
description: Cloudflare Access and Pages Function configuration for the private Knowledgebase operator dashboard.
---

# Internal dashboard access

The dashboard at `search.sassmaker.com` is the canonical human operator
surface. Operators authenticate with Cloudflare Access. Browser requests stay
same-origin under `/api`; a Pages Function verifies the Access JWT and adds the
Worker service key server-side.

The Worker service-key contract remains unchanged for fleet agents and backend
integrations.

## Trust boundary

```text
operator browser
  -> Cloudflare Access
  -> Pages dashboard + /api Function
       verifies JWT signature, issuer, audience, expiry
       injects server-side RAG_SERVICE_KEY
  -> Knowledgebase Worker /v1/*
```

The browser must never receive or store `RAG_SERVICE_KEY`. Do not add it to a
`VITE_*` variable: Vite variables are bundled into public JavaScript.

## Required Pages configuration

Configure these on the `knowledgebase-app` Pages project:

| Binding | Kind | Purpose |
| --- | --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | variable | `https://<team>.cloudflareaccess.com` issuer and JWK host |
| `CF_ACCESS_AUD` | variable | Access application audience tag |
| `RAG_SERVICE_URL` | variable | Knowledgebase Worker origin |
| `RAG_SERVICE_KEY` | secret | Tenant-scoped Worker credential used only by the Function |

Do not commit real values. The Function fails closed with `503` when required
configuration is absent.

## Access application

1. Create a self-hosted Access application for the dashboard hostname.
2. Add an allow policy for the intended operator identity.
3. Protect the production custom domain.
4. Protect or disable the fallback `pages.dev` hostname so it cannot bypass the
   intended entry policy.
5. If `llms.txt`, `llms-full.txt`, `index.md`, or other checked-in agent assets
   must remain public, add narrow bypass policies for those exact static paths.
   The `/api/*` Functions still require a valid JWT.

The Function validates the `Cf-Access-Jwt-Assertion` cryptographically with the
team's remote JWK set. It does not trust `Cf-Access-Authenticated-User-Email`
by itself.

## Local preview

The full dashboard requires Pages Functions, so use `pnpm preview:cf` for
end-to-end local work. `pnpm dev` remains useful for shell-only Vite styling,
but `/api` calls will not resolve there.

For local Pages preview only, create an ignored `app/.dev.vars` with:

```text
CF_ACCESS_DEV_EMAIL=<your-email>
RAG_SERVICE_URL=<local-or-deployed-worker-url>
RAG_SERVICE_KEY=<tenant-scoped-key>
```

`CF_ACCESS_DEV_EMAIL` is accepted only when the request hostname is
`localhost` or `127.0.0.1`. Never configure it on the deployed Pages project.

## Release order

1. Deploy the Worker chunk-list route.
2. Configure the Pages variables, secret, and Access application.
3. Deploy the dashboard.
4. Verify `/api/session`, Overview, Data, Query History, and one cited query.
5. Confirm browser storage and requests contain no Worker service key.

Rollback the Pages deployment if identity or proxy checks fail. The Worker
service-key API remains compatible with existing consumers.
