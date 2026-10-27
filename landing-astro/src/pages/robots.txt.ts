import type { APIRoute } from 'astro';
import { SITE_ORIGIN } from '../config/public-surfaces';
import { markdownIdentity } from '../config/markdown-documents';

// Keep crawler permissions aligned with ai.txt: all public pages are allowed.
const agents = [
  '*',
  'OAI-SearchBot',
  'ChatGPT-User',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'GPTBot',
  'ClaudeBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
];
const content =
  agents
    .map((agent) =>
      [`User-agent: ${agent}`, 'Allow: /', ...markdownIdentity.excludedPaths.map((path) => `Disallow: ${path}`), 'Allow: /api/ai$', 'Allow: /api/md', ''].join(
        '\n',
      ),
    )
    .join('\n') + `\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
export const GET: APIRoute = () => new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
