import type { APIRoute } from 'astro';
import { SITE_ORIGIN } from '../config/public-surfaces';
import { markdownHandler } from '../config/markdown-documents';
export const GET: APIRoute = async () => (await markdownHandler(new Request(`${SITE_ORIGIN}/ai.txt`)))!;
