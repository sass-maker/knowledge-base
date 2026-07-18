import { defineConfig } from "blume";

// Blume is the PRESENTATION layer only. The committed Markdown under docs/ is
// the source of truth. Do not add Blume-specific frontmatter that the docs
// depend on to make sense — plain Markdown must read correctly on its own.
// See docs/maintenance.md.
export default defineConfig({
  title: "Knowledgebase",
  description:
    "Private Agent Search — cited RAG over private, specialized corpora. Product, architecture, operations, and durable learnings for the knowledgebase fleet RAG service.",

  content: {
    // Markdown source of truth.
    root: "docs",
    // Exclude non-markdown assets from being treated as pages (Blume already
    // defaults to **/*.{md,mdx}; this is explicit).
    include: ["**/*.md", "**/*.mdx"],
  },

  search: {
    // Local, no hosted service. Archive snapshots are searchable too so
    // historical context is reachable, but each archive page carries a banner
    // pointing to its current successor.
    provider: "orama",
  },

  ai: {
    // Emit llms.txt so the docs site is agent-indexable.
    llmsTxt: true,
  },

  seo: {
    sitemap: true,
    robots: true,
  },

  deployment: {
    output: "static",
    // Update this to the real docs domain when publishing. Left configurable
    // so the repo is not coupled to a specific host.
    site: "https://docs.sassmaker.com",
  },
});
