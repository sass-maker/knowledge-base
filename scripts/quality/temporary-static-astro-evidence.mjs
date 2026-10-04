import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fileSetDigest,
  qualifyStaticOutput,
  qualifyStaticSource,
  sha256,
  TEMPORARY_STATIC_ASTRO_ADVISORY,
  verifyStaticBuildEvidence,
} from './temporary-static-astro-qualification.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const landingRoot = join(repoRoot, 'landing-astro');
const evidenceEnv = 'KNOWLEDGE_BASE_STATIC_ASTRO_EVIDENCE';

function runGit(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd();
}

function isEnvironmentPath(path) {
  return path.split('/').some((part) => /^\.env(?:$|\.)/u.test(part) || part === '.dev.vars');
}

function trackedInputs() {
  const paths = runGit(['ls-files', '-z', '--', 'landing-astro']).split('\0').filter(Boolean);
  if (paths.length === 0) throw new Error('No tracked landing Astro build inputs were found.');
  const inputHashes = {};
  const sourceFiles = {};
  const buffers = {};
  for (const path of paths) {
    if (isEnvironmentPath(path)) throw new Error(`Environment file is outside the qualification boundary: ${path}`);
    const absolute = join(repoRoot, path);
    const info = lstatSync(absolute);
    if (!info.isFile()) throw new Error(`Non-regular tracked build input is outside the qualification boundary: ${path}`);
    const bytes = readFileSync(absolute);
    const committed = Buffer.from(execFileSync('git', ['show', `HEAD:${path}`], { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 }));
    if (!bytes.equals(committed)) throw new Error(`Landing build input differs from checked-out commit ${runGit(['rev-parse', 'HEAD'])}: ${path}`);
    buffers[path] = bytes;
    inputHashes[path] = sha256(bytes);
    if (path.startsWith('landing-astro/src/') && /\.(?:astro|[cm]?[jt]sx?|css|json)$/iu.test(path)) {
      sourceFiles[path] = bytes.toString('utf8');
    }
  }
  return { buffers, inputHashes, sourceFiles };
}

function outputFiles(directory, root = directory, files = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const info = lstatSync(absolute);
    if (info.isSymbolicLink()) throw new Error(`Symbolic link in generated landing output: ${relative(root, absolute)}`);
    if (info.isDirectory()) {
      outputFiles(absolute, root, files);
      continue;
    }
    if (!info.isFile()) throw new Error(`Unsupported generated landing output: ${relative(root, absolute)}`);
    const bytes = readFileSync(absolute);
    const path = relative(root, absolute).split(sep).join('/');
    files[path] = { sha256: sha256(bytes), text: bytes.toString('utf8') };
  }
  return files;
}

function buildArtifacts() {
  const { buffers, inputHashes, sourceFiles } = trackedInputs();
  const dist = join(landingRoot, 'dist');
  if (!existsSync(dist)) throw new Error('landing-astro/dist is missing; run the checked Astro build first.');
  const generated = outputFiles(dist);
  return { buffers, inputHashes, sourceFiles, generated };
}

function currentBuild() {
  const { buffers, inputHashes, sourceFiles, generated } = buildArtifacts();
  const packageJson = JSON.parse(buffers['landing-astro/package.json']?.toString('utf8') ?? 'null');
  const astroConfig = buffers['landing-astro/astro.config.mjs']?.toString('utf8') ?? '';
  const lockText = buffers['landing-astro/pnpm-lock.yaml']?.toString('utf8') ?? '';
  const workerText = buffers['landing-astro/public/_worker.js']?.toString('utf8') ?? '';
  const headersText = buffers['landing-astro/public/_headers']?.toString('utf8') ?? '';
  const outputHashes = Object.fromEntries(Object.entries(generated).map(([path, file]) => [path, file.sha256]));
  return {
    commit: runGit(['rev-parse', 'HEAD']),
    lockSha256: sha256(buffers['landing-astro/pnpm-lock.yaml'] ?? Buffer.alloc(0)),
    inputHashes,
    outputHashes,
    outputFiles: generated,
    packageJson,
    astroConfig,
    lockText,
    sourceFiles,
    workerText,
    headersText,
    workerOutputSha256: generated['_worker.js']?.sha256,
    headersOutputSha256: generated['_headers']?.sha256,
  };
}

function qualifiedCurrentBuild(current) {
  const source = qualifyStaticSource(current);
  if (!source.qualified) return source;
  return qualifyStaticOutput(current.outputFiles);
}

function assertExternalReceiptPath(path) {
  const absolute = resolve(path);
  const withinRepo = relative(repoRoot, absolute);
  if (!isAbsolute(path) || (withinRepo !== '..' && !withinRepo.startsWith(`..${sep}`))) {
    throw new Error('Qualification receipt must be written outside the repository.');
  }
  return absolute;
}

export function captureStaticAstroEvidence(path, now = new Date()) {
  if (now.getTime() >= Date.parse(TEMPORARY_STATIC_ASTRO_ADVISORY.expiresAt)) {
    throw new Error('Temporary static Astro qualification has expired.');
  }
  const current = currentBuild();
  const staticResult = qualifiedCurrentBuild(current);
  if (!staticResult.qualified) throw new Error(staticResult.reason);
  const evidence = {
    schemaVersion: 1,
    advisoryId: TEMPORARY_STATIC_ASTRO_ADVISORY.id,
    expiresAt: TEMPORARY_STATIC_ASTRO_ADVISORY.expiresAt,
    commit: current.commit,
    capturedAt: now.toISOString(),
    lockSha256: current.lockSha256,
    inputDigest: fileSetDigest(current.inputHashes),
    outputDigest: fileSetDigest(current.outputHashes),
  };
  const target = assertExternalReceiptPath(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  return {
    qualified: true,
    reason: staticResult.reason,
    commit: current.commit,
    inputCount: Object.keys(current.inputHashes).length,
    outputCount: Object.keys(current.outputHashes).length,
  };
}

export function verifyStaticAstroEvidence(path = process.env[evidenceEnv], now = Date.now()) {
  if (!path) return { qualified: false, reason: `${evidenceEnv} does not point to a same-run receipt` };
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { qualified: false, reason: 'same-run static Astro qualification receipt is missing or unreadable' };
  }
  try {
    const current = currentBuild();
    return verifyStaticBuildEvidence(evidence, current, now);
  } catch (error) {
    return { qualified: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, path] = process.argv.slice(2);
    if (mode !== 'capture' || !path || process.argv.length !== 4) {
      throw new Error(`Usage: node scripts/quality/temporary-static-astro-evidence.mjs capture <absolute-path-under-${tmpdir()}>`);
    }
    const result = captureStaticAstroEvidence(path);
    console.log(`Temporary static Astro qualification evidence captured for ${result.commit} (${result.inputCount} inputs, ${result.outputCount} outputs).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
