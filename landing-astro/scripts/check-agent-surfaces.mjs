import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '..', 'dist');

async function read(relativePath) {
  return fs.readFile(resolve(dist, relativePath), 'utf8');
}

const requiredFiles = [
  'index.html',
  'index.md',
  'llms.txt',
  'llms-full.txt',
  'robots.txt',
  'sitemap.xml',
  'api/ai',
  '.well-known/ai-catalog.json',
  '404.html',
  '_worker.js',
];

for (const requiredFile of requiredFiles) {
  await fs.access(resolve(dist, requiredFile));
}

const catalog = JSON.parse(await read('api/ai'));
const sitemap = await read('sitemap.xml');
const indexMarkdown = await read('index.md');
const aiCatalog = JSON.parse(await read('.well-known/ai-catalog.json'));

if (catalog.surfaces.length !== 1) {
  throw new Error(`expected exactly one public HTML surface, got ${catalog.surfaces.length}`);
}

const [surface] = catalog.surfaces;
if (surface.url !== 'https://knowledgebase.sassmaker.com/' || surface.md !== 'https://knowledgebase.sassmaker.com/index.md') {
  throw new Error('public catalog does not match the canonical landing route');
}

const sitemapLocations = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
if (sitemapLocations.length !== 1 || sitemapLocations[0] !== 'https://knowledgebase.sassmaker.com/') {
  throw new Error('sitemap must contain only the canonical public HTML landing');
}

if (!/^# Knowledge Base/m.test(indexMarkdown) || indexMarkdown.length < 800) {
  throw new Error('landing Markdown is not substantive');
}

if (!/^---\n[\s\S]*?\n---\n/u.test(indexMarkdown)) {
  throw new Error('landing Markdown must include YAML frontmatter');
}

if (aiCatalog.host?.identifier !== 'https://knowledgebase.sassmaker.com' || aiCatalog.entries?.length !== 1) {
  throw new Error('AI catalog must describe exactly the public Knowledge Base catalog');
}

const publicOutput = (await Promise.all(requiredFiles.map((requiredFile) => read(requiredFile)))).join('\n');
const forbiddenPatterns = [/workers\.dev/i, /\/v1\/kb\//i, /service[_ -]?key/i, /api[_ -]?key/i, /bearer\s+[a-z0-9]/i];
for (const forbiddenPattern of forbiddenPatterns) {
  if (forbiddenPattern.test(publicOutput)) {
    throw new Error(`private boundary leaked into public output: ${forbiddenPattern}`);
  }
}

if (!sitemap.includes('<lastmod>2026-08-31</lastmod>')) {
  throw new Error('sitemap must include a current lastmod value');
}

const notFound = await read('404.html');
if (!/Page not found/u.test(notFound) || !/noindex/u.test(notFound)) {
  throw new Error('404 page must be explicit and noindex');
}

const workerModule = await import(`${pathToFileURL(resolve(dist, '_worker.js')).href}?check=${Date.now()}`);
const assetBodies = new Map([
  ['/index.md', { body: indexMarkdown, contentType: 'text/markdown; charset=utf-8', status: 200 }],
  ['/', { body: await read('index.html'), contentType: 'text/html; charset=utf-8', status: 200 }],
]);
const env = {
  ASSETS: {
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname;
      const asset = assetBodies.get(pathname) ?? { body: 'not found', contentType: 'text/plain', status: 404 };
      return new Response(request.method === 'HEAD' ? null : asset.body, {
        status: asset.status,
        headers: { 'Content-Type': asset.contentType },
      });
    },
  },
};

const markdownHome = await workerModule.default.fetch(new Request('https://knowledgebase.sassmaker.com/', { headers: { Accept: 'text/markdown' } }), env);
if (markdownHome.status !== 200 || !markdownHome.headers.get('Vary')?.includes('Accept')) {
  throw new Error('edge worker must serve the homepage as cache-safe Markdown');
}

const markdownMissing = await workerModule.default.fetch(
  new Request('https://knowledgebase.sassmaker.com/missing', { headers: { Accept: 'text/markdown' } }),
  env,
);
if (markdownMissing.status !== 404 || !markdownMissing.headers.get('Content-Type')?.includes('text/markdown')) {
  throw new Error('edge worker must return a Markdown 404 to agents');
}

console.log('agent surfaces verified: 1 public HTML route, Markdown negotiation, 1 AI catalog, and HTML/Markdown 404s');
