import type { APIRoute } from 'astro';
import { SITE_ORIGIN, publicSurfaceCatalog } from '../../config/public-surfaces';

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        name: 'Knowledge Base',
        version: '1',
        url: SITE_ORIGIN,
        llms: `${SITE_ORIGIN}/llms.txt`,
        llmsFull: `${SITE_ORIGIN}/llms-full.txt`,
        sitemap: `${SITE_ORIGIN}/sitemap.xml`,
        robots: `${SITE_ORIGIN}/robots.txt`,
        aiCatalog: `${SITE_ORIGIN}/.well-known/ai-catalog.json`,
        markdown: {
          suffix: '.md',
          negotiation: false,
        },
        surfaces: publicSurfaceCatalog(),
        auth: {
          public: true,
          notes:
            'This catalog covers the public product explanation only. Indexed material, operator state, the protected dashboard, and retrieval access remain private.',
        },
      },
      null,
      2,
    ),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
    },
  );
