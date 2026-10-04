import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pagesWorker from '../../landing-astro/public/_worker.js';
import {
  fileSetDigest,
  qualifyStaticOutput,
  qualifyStaticSource,
  qualifyTemporaryAdvisory,
  sha256,
  TEMPORARY_STATIC_ASTRO_ADVISORY,
  TRUSTED_PAGES_HEADERS_SHA256,
  TRUSTED_PAGES_WRAPPER_SHA256,
  verifyStaticBuildEvidence,
} from './temporary-static-astro-qualification.mjs';
import { verifyStaticAstroEvidence } from './temporary-static-astro-evidence.mjs';

const root = new URL('../../', import.meta.url);
const wrapperText = readFileSync(new URL('landing-astro/public/_worker.js', root), 'utf8');
const headersText = readFileSync(new URL('landing-astro/public/_headers', root), 'utf8');
const astroConfigText = readFileSync(new URL('landing-astro/astro.config.mjs', root), 'utf8');
const now = Date.parse('2026-10-04T14:00:00.000Z');

function auditAdvisory() {
  return {
    github_advisory_id: TEMPORARY_STATIC_ASTRO_ADVISORY.id,
    url: TEMPORARY_STATIC_ASTRO_ADVISORY.url,
    module_name: TEMPORARY_STATIC_ASTRO_ADVISORY.moduleName,
    severity: TEMPORARY_STATIC_ASTRO_ADVISORY.severity,
    vulnerable_versions: TEMPORARY_STATIC_ASTRO_ADVISORY.vulnerableVersions,
    patched_versions: TEMPORARY_STATIC_ASTRO_ADVISORY.patchedVersions,
    findings: [{ version: TEMPORARY_STATIC_ASTRO_ADVISORY.version, paths: [TEMPORARY_STATIC_ASTRO_ADVISORY.path] }],
  };
}

function currentBuild() {
  const outputFiles = Object.fromEntries(
    ['404.html', 'api/ai', 'index.html', 'index.md', 'llms-full.txt', 'llms.txt', 'robots.txt', 'sitemap.xml', '_headers', '_worker.js'].map((path) => [
      path,
      {
        sha256: path === '_worker.js' ? sha256(wrapperText) : path === '_headers' ? sha256(headersText) : sha256(path),
        text: path === '_worker.js' ? wrapperText : path === '_headers' ? headersText : '<html>static output</html>',
      },
    ]),
  );
  const outputHashes = Object.fromEntries(Object.entries(outputFiles).map(([path, file]) => [path, file.sha256]));
  const inputHashes = { 'landing-astro/src/pages/index.astro': sha256('<main>Landing</main>') };
  return {
    commit: 'commit-a',
    lockSha256: sha256('landing-lock'),
    inputHashes,
    outputHashes,
    outputFiles,
    packageJson: { devDependencies: { astro: '7.2.8' }, dependencies: {} },
    astroConfig: astroConfigText,
    lockText: 'astro@7.2.8\nhttp-cache-semantics@4.2.0',
    sourceFiles: { 'landing-astro/src/pages/index.astro': '<main>Landing</main>' },
    workerText: wrapperText,
    headersText,
    workerOutputSha256: outputFiles['_worker.js'].sha256,
    headersOutputSha256: outputFiles['_headers'].sha256,
  };
}

function evidenceFor(current, capturedAt = '2026-10-04T13:45:00.000Z') {
  return {
    schemaVersion: 1,
    advisoryId: TEMPORARY_STATIC_ASTRO_ADVISORY.id,
    expiresAt: TEMPORARY_STATIC_ASTRO_ADVISORY.expiresAt,
    commit: current.commit,
    capturedAt,
    lockSha256: current.lockSha256,
    inputDigest: fileSetDigest(current.inputHashes),
    outputDigest: fileSetDigest(current.outputHashes),
  };
}

test('only the exact unpatched high advisory, version, graph path and expiry qualify', () => {
  assert.equal(qualifyTemporaryAdvisory(auditAdvisory(), now).qualified, true);
  const changes = [
    { severity: 'critical' },
    { patched_versions: '>=4.2.1' },
    { vulnerable_versions: '<4.2.0' },
    { module_name: 'other-package' },
    { url: 'https://example.test/advisory' },
    { findings: [{ version: '4.2.1', paths: [TEMPORARY_STATIC_ASTRO_ADVISORY.path] }] },
    { findings: [{ version: '4.2.0', paths: ['.>other>http-cache-semantics'] }] },
    {
      findings: [
        { version: '4.2.0', paths: [TEMPORARY_STATIC_ASTRO_ADVISORY.path] },
        { version: '4.2.0', paths: [TEMPORARY_STATIC_ASTRO_ADVISORY.path] },
      ],
    },
  ];
  for (const change of changes) assert.equal(qualifyTemporaryAdvisory({ ...auditAdvisory(), ...change }, now).qualified, false);
  assert.equal(qualifyTemporaryAdvisory(auditAdvisory(), Date.parse(TEMPORARY_STATIC_ASTRO_ADVISORY.expiresAt)).qualified, false);
});

test('static source and output qualification reject route opt-outs, adapters and unexpected runtime artifacts', () => {
  const current = currentBuild();
  assert.equal(qualifyStaticSource(current).qualified, true);
  assert.equal(qualifyStaticOutput(current.outputFiles).qualified, true);
  for (const change of [
    { astroConfig: `defineConfig({ output: 'server' })` },
    { astroConfig: `defineConfig({ output: 'static', adapter: cloudflare() })` },
    { astroConfig: `// output: 'static'\nexport default defineConfig({ ...dynamicConfig });` },
    { sourceFiles: { 'landing-astro/src/pages/api/ai.ts': 'export const prerender = false;' } },
    { sourceFiles: { 'landing-astro/src/cache.ts': 'new CachePolicy(request, response)' } },
    { workerText: `${current.workerText}\n// changed wrapper` },
    { workerOutputSha256: sha256('changed Worker output') },
    { headersText: `${current.headersText}\n/*\n  Set-Cookie: session=private\n` },
    { headersOutputSha256: sha256('changed header output') },
  ]) {
    assert.equal(qualifyStaticSource({ ...current, ...change }).qualified, false);
  }
  const wrongRoutes = { ...current.outputFiles };
  delete wrongRoutes['api/ai'];
  assert.equal(qualifyStaticOutput(wrongRoutes).qualified, false);
  const serverBundle = { ...current.outputFiles, 'functions/api/handler.js': { text: '', sha256: sha256('') } };
  assert.equal(qualifyStaticOutput(serverBundle).qualified, false);
  const cacheBundle = { ...current.outputFiles, 'assets/site.js': { text: 'CachePolicy', sha256: sha256('CachePolicy') } };
  assert.equal(qualifyStaticOutput(cacheBundle).qualified, false);
  const inlineCacheScript = { ...current.outputFiles, 'index.html': { text: '<script>new CachePolicy()</script>', sha256: sha256('inline-cache-script') } };
  assert.equal(qualifyStaticOutput(inlineCacheScript).qualified, false);
});

test('fresh evidence is bound to the current commit, lock, inputs and complete output set', () => {
  const current = currentBuild();
  const evidence = evidenceFor(current);
  assert.equal(verifyStaticAstroEvidence('').qualified, false);
  assert.equal(verifyStaticBuildEvidence(evidence, current, now).qualified, true);
  assert.equal(verifyStaticBuildEvidence(null, current, now).qualified, false);
  assert.equal(verifyStaticBuildEvidence(evidenceFor(current, '2026-10-04T13:00:00.000Z'), current, now).qualified, false);
  assert.equal(verifyStaticBuildEvidence({ ...evidence, commit: 'different' }, current, now).qualified, false);
  assert.equal(verifyStaticBuildEvidence({ ...evidence, lockSha256: sha256('other lock') }, current, now).qualified, false);
  assert.equal(verifyStaticBuildEvidence({ ...evidence, inputDigest: sha256('changed source') }, current, now).qualified, false);
  assert.equal(verifyStaticBuildEvidence({ ...evidence, outputDigest: sha256('changed build') }, current, now).qualified, false);
  assert.equal(verifyStaticBuildEvidence(evidence, current, Date.parse(evidence.expiresAt)).qualified, false);
});

test('the shipped Pages wrapper forwards requests to static assets without a shared cache or cookie state', async () => {
  const calls = [];
  const assets = {
    async fetch(request) {
      calls.push(request);
      const pathname = new URL(request.url).pathname;
      if (pathname === '/missing') return new Response(null, { status: 404 });
      const requestSentinel = request.headers.get('cookie') ?? 'anonymous';
      return new Response(`static:${pathname}:sentinel=${requestSentinel}`, { headers: { 'Content-Type': 'text/plain' } });
    },
  };
  const first = await pagesWorker.fetch(
    new Request('https://knowledgebase.sassmaker.com/api/ai', { headers: { Cookie: 'session=sentinel-alpha', 'Cache-Control': 'max-stale=600' } }),
    { ASSETS: assets },
  );
  const second = await pagesWorker.fetch(
    new Request('https://knowledgebase.sassmaker.com/api/ai', { headers: { Cookie: 'session=sentinel-beta', 'Cache-Control': 'max-stale=600' } }),
    { ASSETS: assets },
  );
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).pathname, '/api/ai');
  assert.equal(calls[0].headers.get('cookie'), 'session=sentinel-alpha');
  assert.equal(calls[1].headers.get('cookie'), 'session=sentinel-beta');
  const firstBody = await first.text();
  const secondBody = await second.text();
  assert.match(firstBody, /sentinel-alpha/u);
  assert.doesNotMatch(firstBody, /sentinel-beta/u);
  assert.match(secondBody, /sentinel-beta/u);
  assert.doesNotMatch(secondBody, /sentinel-alpha/u);
  assert.equal(first.headers.has('Set-Cookie'), false);
  assert.equal(second.headers.has('Set-Cookie'), false);

  const markdown = await pagesWorker.fetch(
    new Request('https://knowledgebase.sassmaker.com/', {
      headers: { Accept: 'text/markdown', Cookie: 'session=sentinel-gamma', 'Cache-Control': 'max-stale=600' },
    }),
    { ASSETS: assets },
  );
  assert.equal(new URL(calls[2].url).pathname, '/index.md');
  assert.match(await markdown.text(), /static:\/index\.md:sentinel=session=sentinel-gamma/u);
  assert.match(markdown.headers.get('Vary') ?? '', /Accept/);
  assert.equal(markdown.headers.has('Set-Cookie'), false);

  const missing = await pagesWorker.fetch(
    new Request('https://knowledgebase.sassmaker.com/missing', {
      headers: { Accept: 'text/markdown', Cookie: 'session=four', 'Cache-Control': 'max-stale=600' },
    }),
    { ASSETS: assets },
  );
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Page not found/u);
  assert.equal(missing.headers.has('Set-Cookie'), false);
  assert.equal(calls.length, 4);
});
