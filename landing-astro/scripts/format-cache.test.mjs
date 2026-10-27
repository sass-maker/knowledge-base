import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import worker from '../public/_worker.js/index.js';

// URL-only keys intentionally ignore Vary, matching the Cloudflare failure.
class UrlCache {
  entries = new Map();
  async match(key) {
    return this.entries.get(key.url)?.clone();
  }
  async put(key, response) {
    this.entries.set(key.url, response.clone());
  }
}
let assetReads = 0;
const env = (generation = 'a'.repeat(64), status = 200, headers = {}) => ({
  ASSETS: {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/public-cache-generation.txt') return new Response(generation);
      if (path === '/api/md/_identity')
        return Response.json({ name: 'Knowledge Base', url: 'https://knowledgebase.sassmaker.com', summary: 'Public fixture', trainingAllowed: true });
      if (path === '/api/md/_catalog') return Response.json([{ path: '/', title: 'Knowledge Base', description: 'Public fixture', assetPath: '/index.md' }]);
      assetReads++;
      const markdown = path.endsWith('.md');
      return new Response(markdown ? '# public brief' : '<html>public home</html>', {
        status,
        headers: { 'content-type': markdown ? 'text/markdown' : 'text/html', ...headers },
      });
    },
  },
});
const respond = (accept = 'text/html', options = {}, path = '/', bindings = env()) =>
  worker.fetch(new Request(`https://knowledgebase.sassmaker.com${path}`, { ...options, headers: { accept, ...options.headers } }), bindings);
afterEach(() => {
  delete globalThis.caches;
  assetReads = 0;
});
for (const order of [
  ['text/html', 'text/markdown'],
  ['text/markdown', 'text/html'],
]) {
  test(`cold/warm formats: ${order.join(' then ')}`, async () => {
    const cache = new UrlCache();
    globalThis.caches = { default: cache };
    for (const accept of [...order, ...order]) {
      const response = await respond(accept);
      assert.equal(response.status, 200);
      assert.ok(response.headers.get('content-type').includes(accept));
      assert.ok(response.headers.get('vary').includes('Accept'));
      assert.ok(response.headers.get('cache-control').includes('no-store'));
      assert.equal(response.headers.get('cloudflare-cdn-cache-control'), 'no-store');
      assert.ok((await response.text()).includes(accept === 'text/html' ? '<html>' : '# public'));
    }
    assert.equal(cache.entries.size, 2);
    assert.equal(assetReads, 2);
  });
}
test('cold HEAD warms full representation; warm HEAD has GET headers and no body', async () => {
  const cache = new UrlCache();
  globalThis.caches = { default: cache };
  for (const accept of ['text/html', 'text/markdown']) {
    const head = await respond(accept, { method: 'HEAD' });
    assert.equal(head.body, null);
    const get = await respond(accept);
    assert.equal(get.headers.get('content-type'), head.headers.get('content-type'));
    assert.ok(await get.text());
    assert.equal((await respond(accept, { method: 'HEAD' })).body, null);
  }
  assert.equal(assetReads, 2);
});
test('new build marker isolates cache; absent or malformed markers bypass it', async () => {
  const cache = new UrlCache();
  globalThis.caches = { default: cache };
  await respond();
  await respond('text/html', {}, '/', env('b'.repeat(64)));
  assert.equal(cache.entries.size, 2);
  for (const generation of ['', '<html>SPA fallback</html>']) {
    await respond('text/html', {}, '/', env(generation));
    await respond('text/html', {}, '/', env(generation));
  }
  assert.equal(assetReads, 6);
  assert.equal(cache.entries.size, 2);
});
for (const headers of [
  { cookie: 'session=fixture' },
  { authorization: 'Bearer fixture' },
  { 'cf-access-jwt-assertion': 'fixture' },
  { range: 'bytes=0-1' },
  { 'if-none-match': 'fixture' },
  { 'cache-control': 'no-cache' },
]) {
  test(`bypasses warm cache with ${Object.keys(headers)[0]}`, async () => {
    const cache = new UrlCache();
    globalThis.caches = { default: cache };
    await respond();
    await respond('text/html', { headers });
    await respond('text/html', { headers });
    assert.equal(assetReads, 3);
    assert.equal(cache.entries.size, 1);
  });
}
for (const headers of [
  { 'set-cookie': 'session=fixture; HttpOnly' },
  { 'cache-control': 'private' },
  { 'cdn-cache-control': 'no-store' },
  { 'cloudflare-cdn-cache-control': 'private' },
  { 'content-encoding': 'gzip' },
  { 'cache-control': 'no-store' },
  { 'cache-control': 'no-cache' },
  { 'cache-control': 'public, s-maxage=0' },
  { vary: 'Cookie' },
  { vary: '*' },
  { 'content-type': 'application/json' },
]) {
  test(`does not cache response ${JSON.stringify(headers)}`, async () => {
    const cache = new UrlCache();
    globalThis.caches = { default: cache };
    await respond('text/html', {}, '/', env('a'.repeat(64), 200, headers));
    assert.equal(cache.entries.size, 0);
  });
}
for (const status of [401, 403, 404, 429, 500]) {
  test(`does not cache ${status}`, async () => {
    const cache = new UrlCache();
    globalThis.caches = { default: cache };
    assert.equal((await respond('text/html', {}, '/', env('a'.repeat(64), status))).status, status);
    assert.equal(cache.entries.size, 0);
  });
}
test('operator routes, APIs, static formats, queries and mutations bypass the home cache', async () => {
  const cache = new UrlCache();
  globalThis.caches = { default: cache };
  for (const path of ['/dashboard', '/api/auth/verify', '/index.md', '/api/ai', '/llms.txt', '/?preview=1']) {
    await respond('text/html', {}, path);
    await respond('text/markdown', { method: 'HEAD' }, path);
  }
  await respond('text/html', { method: 'POST' });
  assert.equal(cache.entries.size, 0);
});
test('cache failures do not prevent serving', async () => {
  globalThis.caches = {
    default: {
      match() {
        throw Error('unavailable');
      },
      put() {
        throw Error('unavailable');
      },
    },
  };
  assert.equal((await respond()).status, 200);
});

for (const accept of ['text/markdown;q=0', 'text/markdown;q=0.5,text/html;q=1', 'text/markdown,text/html', '*/*']) {
  test(`HTML cache selection respects Accept quality: ${accept}`, async () => {
    globalThis.caches = { default: new UrlCache() };
    const response = await respond(accept);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.ok([...globalThis.caches.default.entries.keys()][0].endsWith('/html'));
  });
}

test('HTML homepage retains JSON catalog and sitemap HTTP discovery', async () => {
  const response = await respond();
  const links = response.headers.get('link');
  assert.match(links, /rel="ai-catalog"/);
  assert.match(links, /api\/ai/);
  assert.match(links, /sitemap.xml/);
});
