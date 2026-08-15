import type { APIRoute } from 'astro';
import { SITE_ORIGIN } from '../config/public-surfaces';

const content = `# Knowledgebase

> Private agent search with cited, inspectable answers.

## Public product surface

- [Product landing](${SITE_ORIGIN}/)
- [Product landing as Markdown](${SITE_ORIGIN}/index.md)
- [Complete agent catalog](${SITE_ORIGIN}/api/ai)
- [Sitemap](${SITE_ORIGIN}/sitemap.xml)

## Boundary

Only public product information is indexed here. Indexed material, operator
state, authenticated application routes, and retrieval services are private and
are not part of this catalog.
`;

export const GET: APIRoute = () =>
  new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
