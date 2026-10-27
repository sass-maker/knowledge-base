import content from '../content/home.json';
import { SITE_ORIGIN, homeMarkdown } from './public-surfaces';
import { createAgentSurfaceManifest } from '../../public/_worker.js/agent-surfaces/manifest.mjs';
import { createAgentSurfaceHandler } from '../../public/_worker.js/agent-surfaces/handler.mjs';
import { listMarkdownRoutes } from '../../public/_worker.js/agent-surfaces/documents.mjs';

export const markdownIdentity = {
  name: content.product,
  url: SITE_ORIGIN,
  summary: content.page.description,
  contact: 'https://github.com/sass-maker/knowledge-base/issues',
  trainingAllowed: true,
  excludedPaths: ['/admin', '/auth', '/dashboard', '/api', '/search', '/documents', '/settings'],
};
const manifest = createAgentSurfaceManifest({ ...markdownIdentity, pages: { '/': homeMarkdown } });
export const markdownRoutes = listMarkdownRoutes(manifest);
export const markdownHandler = createAgentSurfaceHandler({ manifest, listMarkdownRoutes: () => markdownRoutes });
