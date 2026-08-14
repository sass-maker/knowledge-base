import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '..', 'dist');

async function read(relativePath) {
  return fs.readFile(resolve(dist, relativePath), 'utf8');
}

const requiredFiles = ['index.html', 'index.md', 'llms.txt', 'llms-full.txt', 'robots.txt', 'sitemap.xml', 'api/ai'];

for (const requiredFile of requiredFiles) {
  await fs.access(resolve(dist, requiredFile));
}

const catalog = JSON.parse(await read('api/ai'));
const sitemap = await read('sitemap.xml');
const indexMarkdown = await read('index.md');

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

if (!/^# Knowledgebase/m.test(indexMarkdown) || indexMarkdown.length < 500) {
  throw new Error('landing Markdown is not substantive');
}

const publicOutput = (await Promise.all(requiredFiles.map((requiredFile) => read(requiredFile)))).join('\n');
const forbiddenPatterns = [/workers\.dev/i, /\/v1\/kb\//i, /service[_ -]?key/i, /api[_ -]?key/i, /bearer\s+[a-z0-9]/i];
for (const forbiddenPattern of forbiddenPatterns) {
  if (forbiddenPattern.test(publicOutput)) {
    throw new Error(`private boundary leaked into public output: ${forbiddenPattern}`);
  }
}

console.log('agent surfaces verified: 1 public HTML route, 1 Markdown counterpart');
