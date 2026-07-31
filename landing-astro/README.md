# Knowledgebase public landing

This package owns the static public product explanation for
`knowledgebase.sassmaker.com`. It is intentionally separate from the
Cloudflare Access-protected operator dashboard in `../app/` and from the RAG
Worker in `../cloudflare/worker/`.

```bash
pnpm install
pnpm run check
```

The expected Pages build root is `landing-astro` and the build output is
`dist`. Updating the Pages project or deploying this output is separate,
manually authorized release work.
