## Why

The operator dashboard is a fully client-rendered shell that calls the separate
RAG Worker directly, so its Next.js/OpenNext runtime adds deployment and
maintenance cost without providing server rendering, route handlers, or server
actions. Moving the dashboard to the fleet-standard Vite stack keeps the
existing product behavior while making the surface a static Cloudflare Pages
application.

## What Changes

- Replace the dashboard's Next.js App Router and OpenNext build with Vite and
  React.
- Preserve the existing guest shell, operator configuration flow, dashboard
  routes, Worker API contract, local-storage behavior, and public agent assets.
- Emit a static `dist/` artifact with SPA route fallback support for Cloudflare
  Pages.
- Remove Next.js/OpenNext-only dependencies, configuration, and source files.
- Update the repository's stack documentation and validation commands.

## Capabilities

### New Capabilities

- `static-dashboard-delivery`: Defines the dashboard's static build, client
  routing, direct Worker API integration, and deep-link behavior.

### Modified Capabilities

None.

## Impact

The change is limited to `app/`, its package lock, and stack references in the
repository documentation and status. The RAG Worker, API schema, authentication
model, stored operator configuration, landing site, production data, and
production deployment remain unchanged. Vite and its React/Tailwind plugins
replace Next.js and OpenNext development dependencies.
