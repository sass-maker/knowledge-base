import { createHash } from 'node:crypto';

// PostTrainLLM #190 is a technical precedent for a bounded build-tool qualification.
// This Knowledge Base exception remains repository-specific: upstream has no
// patched version, and the finding stays visible until the time-bound gate expires.
export const TEMPORARY_STATIC_ASTRO_ADVISORY = Object.freeze({
  id: 'GHSA-ch52-4w7c-c8xp',
  url: 'https://github.com/advisories/GHSA-ch52-4w7c-c8xp',
  moduleName: 'http-cache-semantics',
  severity: 'high',
  vulnerableVersions: '<=4.2.0',
  patchedVersions: '<0.0.0',
  version: '4.2.0',
  path: '.>astro>http-cache-semantics',
  expiresAt: '2026-10-18T00:00:00.000Z',
});

export const TRUSTED_PAGES_WRAPPER_SHA256 = 'b052da50a40c23fd99ddff2f15c14080e57cf2b20d131b158780fdf7c46266cd';
export const TRUSTED_PAGES_HEADERS_SHA256 = 'a5891634fe0bd1a780970e5b1a2d3b2d11c68319283f3dec7c152c76205771ac';
export const TRUSTED_ASTRO_CONFIG_SHA256 = '255047bd38df8f9629490f464597fb7ef8266fc96dc20f5e136c4187095a6460';

export const REQUIRED_STATIC_OUTPUTS = Object.freeze([
  '404.html',
  'api/ai',
  'index.html',
  'index.md',
  'llms-full.txt',
  'llms.txt',
  'robots.txt',
  'sitemap.xml',
]);

const MAX_EVIDENCE_AGE_MS = 30 * 60 * 1000;

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sortedEntries(value) {
  return Object.fromEntries(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)));
}

export function fileSetDigest(files) {
  return sha256(JSON.stringify(sortedEntries(files)));
}

function fail(reason) {
  return { qualified: false, reason };
}

export function qualifyTemporaryAdvisory(advisory, now = Date.now()) {
  const rule = TEMPORARY_STATIC_ASTRO_ADVISORY;
  if (now >= Date.parse(rule.expiresAt)) return fail('temporary advisory qualification expired');
  if (
    advisory?.github_advisory_id !== rule.id ||
    advisory?.url !== rule.url ||
    advisory?.module_name !== rule.moduleName ||
    advisory?.severity !== rule.severity ||
    advisory?.vulnerable_versions !== rule.vulnerableVersions ||
    advisory?.patched_versions !== rule.patchedVersions
  ) {
    return fail('advisory metadata differs from the repository-specific temporary finding');
  }
  const findings = advisory.findings ?? [];
  if (findings.length !== 1 || findings[0]?.version !== rule.version || JSON.stringify(findings[0]?.paths ?? []) !== JSON.stringify([rule.path])) {
    return fail('advisory dependency path or installed version differs from the qualified graph');
  }
  return { qualified: true, reason: 'exact unpatched Astro build-tool finding is temporarily eligible' };
}

export function qualifyStaticSource(current) {
  const { packageJson, astroConfig, lockText, sourceFiles, workerText, headersText, workerOutputSha256, headersOutputSha256 } = current;
  const packageCheck = checkAstroPackage(packageJson, lockText);
  if (!packageCheck.qualified) return packageCheck;
  const configCheck = checkAstroConfig(astroConfig);
  if (!configCheck.qualified) return configCheck;
  const sourceCheck = checkStaticSourceFiles(sourceFiles);
  if (!sourceCheck.qualified) return sourceCheck;
  const wrapperCheck = checkPagesWrapper(workerText, workerOutputSha256);
  if (!wrapperCheck.qualified) return wrapperCheck;
  const headersCheck = checkPagesHeaders(headersText, headersOutputSha256);
  if (!headersCheck.qualified) return headersCheck;
  return { qualified: true, reason: 'static Astro assets and the pinned stateless Pages wrapper are source-bound' };
}

function checkAstroPackage(packageJson, lockText) {
  if (packageJson?.devDependencies?.astro !== '7.2.8' || Object.hasOwn(packageJson?.dependencies ?? {}, 'astro')) {
    return fail('Astro is no longer the exact development-only dependency under review');
  }
  if (!lockText.includes('astro@7.2.8') || !lockText.includes('http-cache-semantics@4.2.0')) {
    return fail('landing lockfile no longer contains the exact audited dependency graph');
  }
  return { qualified: true };
}

function checkAstroConfig(astroConfig) {
  return sha256(astroConfig ?? '') === TRUSTED_ASTRO_CONFIG_SHA256
    ? { qualified: true }
    : fail('Astro config differs from the reviewed static output configuration');
}

function checkStaticSourceFiles(sourceFiles) {
  for (const [path, text] of Object.entries(sourceFiles ?? {})) {
    if (hasUnsupportedSourceMarker(text)) return fail(`unsupported dynamic, image, or cache source marker in ${path}`);
  }
  return { qualified: true };
}

function hasUnsupportedSourceMarker(text) {
  return /\bprerender\b|astro:assets|<(?:Image|Picture)\b|\bgetImage\s*\(|http-cache-semantics|\bCachePolicy\b|max-stale|shared(?:User)?Cache/i.test(text);
}

function checkPagesWrapper(workerText, outputHash) {
  return sha256(workerText ?? '') === TRUSTED_PAGES_WRAPPER_SHA256 && outputHash === TRUSTED_PAGES_WRAPPER_SHA256
    ? { qualified: true }
    : fail('Pages wrapper source or built copy differs from the reviewed stateless asset proxy');
}

function checkPagesHeaders(headersText, outputHash) {
  if (sha256(headersText ?? '') !== TRUSTED_PAGES_HEADERS_SHA256 || outputHash !== TRUSTED_PAGES_HEADERS_SHA256) {
    return fail('Pages header source or built copy differs from the reviewed static header policy');
  }
  if (/^\s*Set-Cookie\s*:/im.test(headersText)) return fail('Pages header policy sets cookies');
  return { qualified: true };
}

export function qualifyStaticOutput(outputFiles) {
  const paths = Object.keys(outputFiles ?? {}).sort();
  if (paths.length === 0) return fail('built landing output is missing');
  const missing = REQUIRED_STATIC_OUTPUTS.filter((path) => !Object.hasOwn(outputFiles, path));
  if (missing.length > 0) return fail(`expected static routes are missing: ${missing.join(', ')}`);
  for (const path of paths) {
    if (path === '_worker.js' || path === '_headers') continue;
    if (/(?:^|\/)(?:functions|server)(?:\/|$)|(?:^|\/)_routes\.json$|(?:^|\/)entry\.[cm]?js$/i.test(path)) {
      return fail(`unexpected server runtime artifact: ${path}`);
    }
    if (/\.(?:mjs|cjs)$/i.test(path)) return fail(`unexpected executable server artifact: ${path}`);
    if (/\.(?:html|js)$/i.test(path) && /http-cache-semantics|\bCachePolicy\b|max-stale/i.test(outputFiles[path].text ?? '')) {
      return fail(`audited cache package marker appears in shipped JavaScript: ${path}`);
    }
  }
  if (!Object.hasOwn(outputFiles, '_worker.js') || !Object.hasOwn(outputFiles, '_headers')) {
    return fail('the expected Pages wrapper or static header file is missing');
  }
  return { qualified: true, reason: 'all expected routes are static files with no Astro server bundle' };
}

export function verifyStaticBuildEvidence(evidence, current, now = Date.now()) {
  const staticSource = qualifyStaticSource(current);
  if (!staticSource.qualified) return staticSource;
  const staticOutput = qualifyStaticOutput(current.outputFiles);
  if (!staticOutput.qualified) return staticOutput;
  if (!evidence || evidence.schemaVersion !== 1) return fail('same-build qualification receipt is missing or unsupported');
  if (evidence.advisoryId !== TEMPORARY_STATIC_ASTRO_ADVISORY.id || evidence.expiresAt !== TEMPORARY_STATIC_ASTRO_ADVISORY.expiresAt) {
    return fail('qualification receipt targets a different advisory or expiry');
  }
  if (now >= Date.parse(evidence.expiresAt)) return fail('temporary advisory qualification expired');
  const capturedAt = Date.parse(evidence.capturedAt);
  if (!Number.isFinite(capturedAt) || capturedAt > now + 2 * 60 * 1000 || now - capturedAt > MAX_EVIDENCE_AGE_MS) {
    return fail('same-build qualification receipt is stale or has an invalid timestamp');
  }
  if (evidence.commit !== current.commit) return fail('qualification receipt belongs to a different checkout SHA');
  if (evidence.lockSha256 !== current.lockSha256 || evidence.inputDigest !== fileSetDigest(current.inputHashes)) {
    return fail('qualification receipt does not match the current lockfile or committed build inputs');
  }
  if (evidence.outputDigest !== fileSetDigest(current.outputHashes)) {
    return fail('qualification receipt does not match the current Astro build output');
  }
  return { qualified: true, reason: 'fresh receipt binds the audited static output to this commit and lockfile' };
}
