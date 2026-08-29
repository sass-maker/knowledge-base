const SITE_ORIGIN = 'https://knowledgebase.sassmaker.com';
const DISCOVERY_LINKS = [
  `<${SITE_ORIGIN}/index.md>; rel="alternate"; type="text/markdown"`,
  `<${SITE_ORIGIN}/api/ai>; rel="alternate"; type="application/json"`,
  `<${SITE_ORIGIN}/.well-known/ai-catalog.json>; rel="ai-catalog"; type="application/json"`,
  `<${SITE_ORIGIN}/sitemap.xml>; rel="sitemap"; type="application/xml"`,
].join(', ');

const markdownNotFound = `---
title: "Page not found | Knowledge Base"
canonical: "${SITE_ORIGIN}/"
---

# Page not found

This route is outside the public Knowledge Base boundary. Start with the
[public product brief](${SITE_ORIGIN}/index.md), [agent catalog](${SITE_ORIGIN}/api/ai),
or [sitemap](${SITE_ORIGIN}/sitemap.xml).
`;

function responseHeaders(response, pathname) {
  const headers = new Headers(response.headers);
  const vary = new Set(
    (headers.get('Vary') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  vary.add('Accept');
  headers.set('Vary', [...vary].join(', '));
  headers.set('X-Content-Type-Options', 'nosniff');

  if (pathname === '/') headers.set('Link', DISCOVERY_LINKS);
  if (pathname === '/api/ai' || pathname === '/.well-known/ai-catalog.json') {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  return headers;
}

function withPublicHeaders(response, pathname) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response, pathname),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const wantsMarkdown = request.headers.get('Accept')?.includes('text/markdown') ?? false;

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/' && wantsMarkdown) {
      const markdownUrl = new URL('/index.md', url);
      const response = await env.ASSETS.fetch(new Request(markdownUrl, request));
      return withPublicHeaders(response, '/index.md');
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status === 404 && wantsMarkdown) {
      return new Response(request.method === 'HEAD' ? null : markdownNotFound, {
        status: 404,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          Vary: 'Accept',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    return withPublicHeaders(response, url.pathname);
  },
};
