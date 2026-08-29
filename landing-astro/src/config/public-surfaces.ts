export const SITE_ORIGIN = import.meta.env.PUBLIC_SITE_ORIGIN ?? 'https://knowledgebase.sassmaker.com';

export interface PublicSurface {
  id: string;
  path: string;
  markdownPath: string;
  kind: 'product';
  title: string;
  description: string;
}

export const publicSurfaces: PublicSurface[] = [
  {
    id: 'home',
    path: '/',
    markdownPath: '/index.md',
    kind: 'product',
    title: 'Knowledge Base — Private cited retrieval for Fleet agents',
    description: 'A maintained retrieval layer that gives approved Fleet products and agents cited answers from private, specialized corpora.',
  },
];

export function absoluteURL(path: string): string {
  return new URL(path, SITE_ORIGIN).toString();
}

export function publicSurfaceCatalog() {
  return publicSurfaces.map((surface) => ({
    id: surface.id,
    url: absoluteURL(surface.path),
    md: absoluteURL(surface.markdownPath),
    kind: surface.kind,
    title: surface.title,
    description: surface.description,
  }));
}

export const homeMarkdown = `---
title: "Knowledge Base — Private cited retrieval for Fleet agents"
description: "A maintained retrieval layer that gives approved Fleet products and agents cited answers from private, specialized corpora."
canonical: "${SITE_ORIGIN}/"
last_updated: "2026-08-27"
---

# Knowledge Base — Private cited retrieval for Fleet agents

> Canonical page: ${SITE_ORIGIN}/

Knowledge Base is the shared retrieval layer behind approved Fleet products and
agents. It searches private, specialized corpora by exact terms or meaning,
ranks the evidence, and returns answers tied to a file, page, and excerpt.

Current consumers include Karte, Research Papers, and Starboard. This is
maintained internal infrastructure, not a public document-chat product or a
self-serve RAG service.

## What it does

- Limits each consumer to its approved project and domain.
- Supports lexical, semantic, and hybrid retrieval over controlled sources.
- Returns ranked citations, provenance, confidence, and trace data.
- Keeps operator workspaces, indexed material, and retrieval access private.

## Operating rule

Knowledge Base already serves real Fleet consumers. Change it for a concrete
consumer need, a retrieval regression, or a new corpus—not to expand the
infrastructure for its own sake.

## Product boundaries

This public landing contains product documentation only. It does not expose
indexed documents, search history, operator settings, private dashboard routes,
or retrieval access. There is no public signup, checkout, or permanent pricing
promise.

The operator workspace is separately protected at https://search.sassmaker.com.

## Project

Source and roadmap: https://github.com/sass-maker/knowledge-base

Agent contract: https://github.com/sass-maker/knowledge-base/blob/main/docs/product/agent-tool-contract.md
`;
