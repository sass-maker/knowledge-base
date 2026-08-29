import type { APIRoute } from 'astro';
import { SITE_ORIGIN } from '../config/public-surfaces';

const content = `# Knowledge Base

> The maintained private retrieval layer behind approved Fleet products and agents.

## Public product surface

- [Product landing](${SITE_ORIGIN}/)
- [Product landing as Markdown](${SITE_ORIGIN}/index.md)
- [Complete agent catalog](${SITE_ORIGIN}/api/ai)
- [AI resource catalog](${SITE_ORIGIN}/.well-known/ai-catalog.json)
- [Sitemap](${SITE_ORIGIN}/sitemap.xml)

## Boundary

Only the public product explanation is indexed here. Indexed material, operator
state, protected application routes, and retrieval access are private and are
not part of this catalog. Knowledge Base is internal Fleet infrastructure, not
a public document-chat or self-serve RAG product.

## When to use Knowledge Base

Use Knowledge Base when an approved Fleet product needs grounded answers from
a controlled private corpus and must preserve citations. Do not use this public
origin as a retrieval endpoint. Read the public integration contract in the
source repository, then connect only through an approved project scope.
`;

export const GET: APIRoute = () =>
  new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
