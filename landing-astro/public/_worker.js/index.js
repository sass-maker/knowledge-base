import { createStaticAssetHandler, advertiseMarkdown } from './agent-surfaces/adapters/static-assets.mjs';
import { wantsMarkdown, markdownResponse } from './agent-surfaces/http.mjs';

// Cloudflare ignores Vary: Accept in its ordinary URL cache. Use a private,
// representation-specific cache lookup URL, and forbid downstream URL caching.
// A deployment identity is mandatory: never reuse a shell naming old chunks.
async function publicHomeCache(request, env, resolve) {
  const url = new URL(request.url);
  const home = url.pathname === '/';
  const safe =
    home &&
    !url.search &&
    ['GET', 'HEAD'].includes(request.method) &&
    ![
      'authorization',
      'cookie',
      'range',
      'if-none-match',
      'if-modified-since',
      'if-match',
      'if-unmodified-since',
      'cache-control',
      'pragma',
      'cf-access-jwt-assertion',
    ].some((name) => request.headers.has(name));
  let generation = '';
  if (safe && env.ASSETS) {
    try {
      // The marker is emitted from this build's HTML/Markdown. A tiny binding
      // lookup avoids assuming build-time CF_PAGES_* variables exist at runtime.
      const marker = await env.ASSETS.fetch(new Request(new URL('/public-cache-generation.txt', url)));
      if (marker.status === 200) {
        const value = (await marker.text()).trim();
        if (/^[a-f0-9]{64}$/.test(value)) generation = value;
      }
    } catch {
      /* A missing/unavailable generation safely disables caching. */
    }
  }
  const cache = safe && generation && typeof caches !== 'undefined' ? caches.default : null;
  const format = wantsMarkdown(request) ? 'markdown' : 'html';
  const keyUrl = new URL(url);
  keyUrl.pathname = `/__public_home_cache_v1/${encodeURIComponent(generation || 'unbuilt')}/${format}`;
  const key = new Request(keyUrl, { method: 'GET' });
  const downstream = (response) => {
    const headers = new Headers(response.headers);
    if (home) {
      headers.set('cache-control', 'private, no-store');
      headers.set('cdn-cache-control', 'no-store');
      headers.set('cloudflare-cdn-cache-control', 'no-store');
      const vary = new Set(
        (headers.get('vary') || '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      );
      vary.add('Accept');
      vary.add('Accept-Encoding');
      headers.set('vary', [...vary].join(', '));
    }
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return downstream(hit);
    } catch {
      /* Cache availability must not affect serving. */
    }
  }
  const response = await resolve();
  const type = response.headers.get('content-type') || '';
  const policy = ['cache-control', 'cdn-cache-control', 'cloudflare-cdn-cache-control'].map((name) => response.headers.get(name) || '').join(', ');
  const vary = (response.headers.get('vary') || '')
    .toLowerCase()
    .split(',')
    .map((v) => v.trim());
  const expected = format === 'markdown' ? 'text/markdown' : 'text/html';
  if (
    cache &&
    response.status === 200 &&
    type.split(';')[0].trim().toLowerCase() === expected &&
    !response.headers.has('set-cookie') &&
    !response.headers.has('content-encoding') &&
    !/\b(private|no-store|no-cache)\b/i.test(policy) &&
    !/\b(?:s-maxage|max-age)\s*=\s*0\b/i.test(policy.replace(/max-age=0,?\s*must-revalidate/i, '')) &&
    vary.every((v) => !v || v === 'accept' || v === 'accept-encoding')
  ) {
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'public, max-age=60');
    headers.delete('cdn-cache-control');
    headers.delete('cloudflare-cdn-cache-control');
    // Vary is metadata for clients, never the representation key.
    headers.delete('vary');
    try {
      await cache.put(key, new Response(response.clone().body, { headers }));
    } catch {
      /* Serving succeeds even when a cache write fails. */
    }
  }
  return downstream(response);
}

const SITE_ORIGIN = 'https://knowledgebase.sassmaker.com';
const handleMarkdown = createStaticAssetHandler({});
async function resolveRequest(request, env) {
  const url = new URL(request.url);
  // This canonical public alias is cached only under the existing format key;
  // publicHomeCache supplies no-store on the original negotiated homepage.
  const markdownRequest = url.pathname === '/' && wantsMarkdown(request)
    ? new Request(new URL('/index.md', url), request)
    : request;
  const markdown = await handleMarkdown(markdownRequest, env.ASSETS);
  if (markdown) return markdown;
  const response = await env.ASSETS.fetch(request);
  if (response.status === 404 && wantsMarkdown(request)) {
    const missing = markdownResponse('# Not found\n\nNo public Markdown page exists at this path.\n', request, { 'Cache-Control': 'no-store' });
    return new Response(missing.body, { status: 404, headers: missing.headers });
  }
  const result = advertiseMarkdown(response, SITE_ORIGIN, url.pathname === '/' ? '/index.md' : undefined);
  result.headers.set('X-Content-Type-Options', 'nosniff');
  if (url.pathname === '/api/ai' || url.pathname === '/.well-known/ai-catalog.json') result.headers.set('Content-Type', 'application/json; charset=utf-8');
  return result;
}

export default {
  async fetch(request, env) {
    const getRequest = request.method === 'HEAD' ? new Request(request.url, { method: 'GET', headers: request.headers }) : request;
    return publicHomeCache(request, env, () => resolveRequest(getRequest, env));
  },
};
