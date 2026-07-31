## Why

`knowledgebase.sassmaker.com` is the public explanation of Knowledge Base, but
the repository no longer contains an independently deployable source for that
Pages target. Its discovery routes currently fall through to application HTML,
while the tracked `app/` package is the private operator dashboard at
`search.sassmaker.com` and must remain behind Cloudflare Access.

## What Changes

- Add a small independently built public landing package owned by the
  `knowledgebase-landing` Pages target.
- Publish truthful `/llms.txt`, `/llms-full.txt`, `/api/ai`, `/index.md`,
  `robots.txt`, and an HTML-only sitemap from the same public route registry.
- Keep private dashboard routes, collections, corpus contents, citations,
  service credentials, and RAG APIs out of every public discovery surface.
- Add local build and agent-readiness checks without deploying or changing
  production configuration.

## Capabilities

### New Capabilities

- `public-landing-discovery`: A public, independently deployable product
  explanation with complete search and agent discovery surfaces.

### Modified Capabilities

- None. The private operator dashboard and RAG Worker contracts remain
  unchanged.

## Impact

- New source package for the existing `knowledgebase-landing` Pages project.
- Fleet project metadata can point the landing deploy target at its owning
  source directory.
- Production deployment and Pages configuration remain separately authorized
  release work.

Closes #28.
