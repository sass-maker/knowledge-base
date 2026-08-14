import type { APIRoute } from 'astro';
import { SITE_ORIGIN, publicSurfaceCatalog } from '../../config/public-surfaces';

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        name: 'Knowledgebase',
        version: '1',
        url: SITE_ORIGIN,
        llms: `${SITE_ORIGIN}/llms.txt`,
        llmsFull: `${SITE_ORIGIN}/llms-full.txt`,
        sitemap: `${SITE_ORIGIN}/sitemap.xml`,
        robots: `${SITE_ORIGIN}/robots.txt`,
        markdown: {
          suffix: '.md',
          negotiation: false,
        },
        surfaces: publicSurfaceCatalog(),
        auth: {
          public: true,
          notes:
            'The catalog covers only the public product landing. Indexed material, operator state, the authenticated dashboard, and retrieval services are excluded.',
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
