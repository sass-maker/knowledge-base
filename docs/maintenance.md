---
title: Maintaining this docs system
description: How to edit the knowledgebase docs tree, validate links, and build with Blume. Markdown is the source of truth; Blume is only the presentation layer.
---

# Maintaining this docs system

> Rules: Markdown in `docs/` is the source of truth. Blume only renders it.
> Code and executable config (`wrangler.jsonc`, `package.json`, migrations)
> remain authoritative for implementation details and schedules.

## Where things live

See [`index.md`](index.md) for the full map. Canonical homes:

- **Product framing** → `docs/product/`
- **Architecture + durable decisions** → `docs/architecture/` (and
  `docs/architecture/decisions.md` for the why)
- **Dev workflow + testing gates** → `docs/development/`
- **Operations + runbooks + jobs** → `docs/operations/`
- **Durable learnings + failed approaches** → `docs/knowledge/`
- **Snapshots (Python era, submission brief, external review, old status)** →
  `docs/knowledge/archive/`
- **Live status** → `STATUS.md` (repo root, short)
- **Agent bootloader** → `AGENTS.md` (repo root, concise)

## Editing rules

1. **One fact, one home.** If a fact lives in code, link to the code instead of
   restating it. If a fact already has a canonical doc, edit that doc — do not
   add a second home.
2. **Do not duplicate easily-discoverable facts.** Route lists, script names,
   binding config, and migration contents belong in code/`package.json`/
   `wrangler.jsonc`; docs link to them.
3. **Do not invent information.** Mark unresolved questions explicitly in
   `STATUS.md` → "Unresolved questions".
4. **Preserve snapshots.** `docs/knowledge/archive/` files are snapshots. Do
   not rewrite their bodies to "update" them — update the current doc that
   supersedes them and let the archive stay a snapshot. Each archive file
   carries a banner pointing to its current successor.
5. **Keep pages focused.** Target 150–300 lines per markdown file. Split
   catch-all docs into per-topic pages.
6. **Prefer `git mv`** when reorganizing so rename history is preserved.
7. **Do not create empty folders or placeholder docs.** Every doc must have
   useful content.

## Linking

- Use relative links between docs (`../architecture/decisions.md`, not
  `docs/architecture/decisions.md` from a doc inside `docs/`).
- Link to code with repo-relative paths (`cloudflare/worker/src/index.ts`) in
   backticks for code references, or as links for files worth opening.
- The link checker validates relative `.md`/image links and anchors. It does
  not fetch external URLs (no network in CI).

## Validation

```bash
# From repo root — check internal markdown links + frontmatter
node scripts/docs-check-links.mjs

# Build the docs site with Blume (presentation layer only)
pnpm install --frozen-lockfile   # installs blume + link checker deps
pnpm run docs:check              # link check
pnpm run docs:build              # blume build → dist/
pnpm run docs:preview            # blume preview
```

CI (`.github/workflows/docs.yml`) runs `docs:check` and `docs:build` on PRs
touching `docs/`, `STATUS.md`, `AGENTS.md`, `blume.config.ts`, or
`scripts/docs-check-links.mjs`.

## Blume

`blume.config.ts` at the repo root points Blume at `docs/` as the content
root. Blume generates a static site into `dist/` (gitignored). The committed
Markdown is the source of truth; Blume is only the presentation and search
layer. Do not add Blume-specific frontmatter that the source-of-truth docs
depend on to make sense — plain Markdown must read correctly on its own.

`docs/knowledge/archive/` is included in the Blume build so historical
snapshots are reachable, but each archive page carries a banner that points to
its current successor.

## When the deploy fingerprint changes

Update the "Deploy fingerprint" line in `STATUS.md`, then move the old
detailed status snapshot into `docs/knowledge/archive/` with a dated filename
(e.g. `project-status-YYYY-MM-DD.md`) and a banner. Do not let
deploy-version-specific text accumulate in `STATUS.md`.
