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
  notes: ['Indexed material, operator state, protected routes and retrieval access are private. Knowledge Base is internal infrastructure, not a public document-chat or self-serve RAG product. Connect only through an approved project scope.', 'Do not use this public origin as a retrieval endpoint.', '[Agent catalog](https://knowledgebase.sassmaker.com/.well-known/ai-catalog.json)'],
  excludedPaths: ['/admin', '/auth', '/dashboard', '/api', '/search', '/documents', '/settings'],
};
const manifest = createAgentSurfaceManifest({ ...markdownIdentity, pages: { '/': homeMarkdown } });
export const markdownRoutes = listMarkdownRoutes(manifest);
export const markdownHandler = createAgentSurfaceHandler({ manifest, listMarkdownRoutes: () => markdownRoutes });
