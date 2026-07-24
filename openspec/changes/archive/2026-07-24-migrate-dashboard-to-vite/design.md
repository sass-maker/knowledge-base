## Context

The dashboard is deployed as a Next.js/OpenNext Worker, but every product page
is a client component. Authentication configuration is entered by the operator
and retained in browser localStorage, while all product requests go directly to
the independently deployed RAG Worker. The migration must preserve deep links
and public agent assets without introducing another router dependency.

## Goals / Non-Goals

**Goals:**

- Produce the dashboard with Vite, React, Tailwind v4, and Lightning CSS.
- Preserve all existing paths and direct Worker API behavior.
- Keep configuration state and service-key handling entirely client-side.
- Deploy the generated `dist/` directory as a static Cloudflare Pages site.

**Non-Goals:**

- Change the RAG Worker, its API, authentication, storage, or deployment.
- Redesign dashboard screens or change operator workflows.
- Deploy the migrated dashboard or move the production custom domain.

## Decisions

### Use a small route table instead of adding React Router

The dashboard has eight fixed routes and no nested dynamic parameters. A typed
route table, History API navigation helper, and `popstate` listener preserve
client navigation without adding a production dependency. Cloudflare Pages
receives a `_redirects` fallback so direct deep links return `index.html`.

Alternative considered: add `react-router-dom`. It provides more routing
features than this fixed operator shell needs and would increase the production
dependency surface.

### Keep direct browser-to-Worker requests

The existing `api.ts` contract remains authoritative. Only its public build-time
environment lookup changes from `NEXT_PUBLIC_RAG_SERVICE_URL` to
`VITE_RAG_SERVICE_URL`, with the current public Worker origin as a fallback.
Service keys remain in localStorage and are never included in build output.

### Replace OpenNext with a Pages artifact

Vite emits `dist/`, Wrangler previews that directory, and deployment uses
`wrangler pages deploy`. Existing public text/JSON assets remain in `public/`.
No production deployment is part of this change.

## Risks / Trade-offs

- [A direct deep link could return 404] → Ship and build-test the Pages
  `_redirects` fallback.
- [Next-specific imports could survive] → Search the app source and run
  typecheck/build gates after migration.
- [A route could lose active-navigation state] → Centralize pathname matching
  in the route table and preserve the current sidebar paths.
- [The production domain currently targets a Worker] → Do not deploy in this
  change; require an explicit guarded Pages cutover and rollback plan later.

## Migration Plan

1. Add the Vite entrypoint, route table, and static Pages configuration.
2. Move page modules out of the Next App Router layout and replace Next
   navigation helpers with the local navigation layer.
3. Remove Next/OpenNext configuration and dependencies.
4. Regenerate the lockfile and run typecheck, lint, and production build.
5. Update stack documentation and status.
6. In a separately approved release, create or reuse the intended Pages
   project, verify a preview, move the custom domain, and retain the prior
   Worker version for rollback.

## Open Questions

None for local implementation. Production Pages provisioning and domain cutover
remain explicit release work.
