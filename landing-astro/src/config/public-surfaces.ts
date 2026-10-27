import content from '../content/home.json';
import { absoluteMarkdownLinks } from '../../public/_worker.js/agent-surfaces/format.mjs';
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
    title: content.page.title,
    description: content.page.description,
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

// Workbench source fields in the same order as the public template. Chrome and
// private corpus data are deliberately absent; unsupported block kinds fail build.
function action(link: { label: string; href: string }) {
  return `[${link.label}](${absoluteURL(link.href)})`;
}
const lines = [
  `# ${content.page.title}`,
  '',
  `> ${content.page.description}`,
  '',
  `Canonical: ${absoluteURL('/')}`,
  '',
  `## ${content.hero.title}`,
  '',
  content.hero.eyebrow,
  '',
  content.hero.lede,
  '',
  action(content.hero.primary),
  '',
  action(content.hero.secondary),
  '',
  content.hero.note,
  '',
  `![${content.hero.window.alt}](${absoluteURL(content.hero.window.src)})`,
  '',
  content.hero.caption,
  '',
];
for (const section of content.sections) {
  for (const block of section.blocks) {
    if (block.type === 'statement' && 'points' in block) {
      lines.push(`## ${block.title}`, '', block.eyebrow ?? '', '');
      for (const point of block.points ?? []) lines.push(`### ${point.title}`, '', point.body, '');
    } else if (block.type === 'cta' && 'primary' in block) {
      lines.push(`## ${block.title}`, '', block.lede ?? '', '');
      if (block.primary) lines.push(action(block.primary), '');
      if (block.secondary) lines.push(action(block.secondary), '');
    } else throw new Error(`Unmapped public Workbench block: ${block.type}`);
  }
}
export const homeMarkdown = absoluteMarkdownLinks(lines.join('\n'), absoluteURL('/'));
