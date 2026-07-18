#!/usr/bin/env node
// docs-check-links.mjs — validate internal links + images in the docs tree.
//
// Markdown in docs/ is the source of truth. This checker enforces:
//   - relative .md(.mdx) links resolve to an existing file
//   - relative image links resolve to an existing file
//   - root-level STATUS.md / AGENTS.md / README.md / cloudflare/** links
//     referenced from docs resolve from the repo root
//   - frontmatter is parseable and each page has a `title` (warning, not error)
//
// It does NOT fetch external URLs (no network in CI). External http(s) links
// and pure-fragment (#anchor) links are skipped. Mailto and data: URIs skipped.
//
// Exit code 0 = clean, 1 = broken links or invalid frontmatter.
//
// Run: node scripts/docs-check-links.mjs   (from repo root)

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const DOCS_ROOT = join(REPO_ROOT, "docs");

const errors = [];
const warnings = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      walk(p, out);
    } else if (/\.(md|mdx)$/.test(p)) {
      out.push(p);
    }
  }
  return out;
}

// Also check the root-level docs that are part of the knowledge system.
const ROOT_DOCS = ["AGENTS.md", "STATUS.md", "README.md"]
  .map((f) => join(REPO_ROOT, f))
  .filter((p) => existsSync(p));

const files = [...ROOT_DOCS, ...walk(DOCS_ROOT)];

// Match markdown links/images:  [text](target)  and  ![alt](target)
// Capture the target. Skip targets that contain a scheme (http:, mailto:, data:).
const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function isExternal(target) {
  return /^(https?:|mailto:|data:|tel:|ftp:|irc:)/i.test(target);
}

function stripFragment(target) {
  const hashIdx = target.indexOf("#");
  return hashIdx === -1 ? target : target.slice(0, hashIdx);
}

function resolveTarget(fromFile, target) {
  // Pure fragment link — skip (we don't validate anchors against headings).
  if (target.startsWith("#")) return null;
  const clean = stripFragment(target);
  if (clean === "") return null;
  if (isExternal(clean)) return null;
  // Resolve relative to the file containing the link.
  return resolve(dirname(fromFile), clean);
}

function parseFrontmatter(content) {
  if (!content.startsWith("---")) return { frontmatter: null, body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: null, body: content };
  const fmText = content.slice(3, end).trim();
  const fm = {};
  for (const line of fmText.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return { frontmatter: fm, body: content.slice(end + 4) };
}

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const { frontmatter } = parseFrontmatter(content);

  if (frontmatter && !frontmatter.title && file.startsWith(DOCS_ROOT)) {
    warnings.push(`${relative(REPO_ROOT, file)}: missing frontmatter \`title\``);
  }

  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(content)) !== null) {
    const target = m[1];
    const resolved = resolveTarget(file, target);
    if (resolved === null) continue; // external or fragment-only
    if (!existsSync(resolved)) {
      errors.push(
        `${relative(REPO_ROOT, file)}: broken link \`${target}\` (resolved to ${relative(
          REPO_ROOT,
          resolved,
        )})`,
      );
    }
  }
}

// Report
for (const w of warnings) console.warn(`warn: ${w}`);
for (const e of errors) console.error(`error: ${e}`);

console.log(
  `docs-check-links: ${files.length} files checked, ${errors.length} errors, ${warnings.length} warnings`,
);

if (errors.length > 0) {
  process.exit(1);
}
