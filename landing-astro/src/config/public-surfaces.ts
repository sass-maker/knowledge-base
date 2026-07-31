export const SITE_ORIGIN =
  import.meta.env.PUBLIC_SITE_ORIGIN ?? "https://knowledgebase.sassmaker.com";

export interface PublicSurface {
  id: string;
  path: string;
  markdownPath: string;
  kind: "product";
  title: string;
  description: string;
}

export const publicSurfaces: PublicSurface[] = [
  {
    id: "home",
    path: "/",
    markdownPath: "/index.md",
    kind: "product",
    title: "Knowledgebase — Private Agent Search",
    description:
      "Private search for teams and agents, with cited answers over the material an operator chooses to index.",
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

export const homeMarkdown = `# Knowledgebase — Private Agent Search

> Canonical page: ${SITE_ORIGIN}/

Knowledgebase gives operators and their agents cited answers over material the
operator chooses to index. It is built for private retrieval: the public site
explains the product, while indexed material and operator controls stay behind
the authenticated application boundary.

## What it does

- Accepts common document and structured-data formats.
- Supports exact retrieval and semantic retrieval.
- Returns answers with source citations so results can be checked.
- Keeps operator workspaces and indexed material out of the public website.

## Product boundaries

This public landing contains product documentation only. It does not expose
indexed documents, search history, operator settings, private dashboard routes,
or the retrieval service.

The operator application is separately authenticated at
https://search.sassmaker.com.

## Project

Source and roadmap: https://github.com/sass-maker/knowledge-base
`;
