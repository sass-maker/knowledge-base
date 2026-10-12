import { describe, expect, it, vi } from 'vitest';
import { enrichCatalog } from '../src/catalog-enrichment';
import type { Repository } from '../src/repository';
import type { ChunkRecord, DocumentRecord, Env } from '../src/types';

function fixture(input: Array<{ id: string; path: string; texts: string[] }>) {
 const documents = input.map((row) => ({ id: row.id, index_id: 'catalog', tenant: 'tenant', external_id: null, created_at: '', content: row.texts.join('\n\n'), metadata: { source_path: row.path, source_revision: 'sha', scope_path: 'apps/tool' } })) as DocumentRecord[];
 const chunks = input.flatMap((row) => row.texts.map((content, i) => ({ id: `${row.id}-${i}`, document_id: row.id, content, index_id: 'catalog', tenant: 'tenant', metadata: {}, chunk_index: i }))) as ChunkRecord[];
 const repo = { getDocument: async (_tenant: string, id: string) => documents.find((document) => document.id === id), getChunkIdsForDocument: async (_tenant: string, id: string) => chunks.filter((chunk) => chunk.document_id === id).map((chunk) => chunk.id), getChunksByIds: async (_tenant: string, ids: string[]) => chunks.filter((chunk) => ids.includes(chunk.id)) } as unknown as Repository;
 let request: any;
 const fetch = vi.fn(async (http: Request) => {
  const body = await http.json() as any; request = JSON.parse(body.messages[1].content);
  const id = Object.keys(request.evidence_options ?? {})[0];
  const facts = id ? [{ field: 'capabilities', value: 'Find matching records.', evidence_ids: [id] }, { field: 'purpose', value: 'Record discovery.', evidence_ids: [id] }] : [{ field: 'purpose', value: 'Record discovery.', evidence: [{ document_id: request.chunks[0].document_id, chunk_id: request.chunks[0].chunk_id, excerpt: request.chunks[0].text }] }];
  return Response.json({ choices: [{ message: { content: JSON.stringify({ facts, needs: [], inferences: [] }) } }] });
 });
 const env = { FREE_AI: { fetch } } as unknown as Env;
 const run = (options = {}) => enrichCatalog(env, repo, 'tenant', 'catalog', { document_ids: documents.map((document) => document.id), subject_id: 'project', source_revision: 'sha', ...options });
 return { run, fetch, request: () => request, chunks };
}

describe('bounded source feature profiles', () => {
 it('keeps later documents when the first has more than thirty chunks', async () => {
  const f = fixture([{ id: 'contract', path: 'PRODUCT.md', texts: Array.from({ length: 40 }, (_, i) => `Contract evidence with behavior ${i}.`) }, { id: 'features', path: 'docs/product/features.md', texts: ['# Shipped features\n\nSearch public records with source attribution.'] }]);
  const result = await f.run();
  expect(f.request().chunks[1]).toMatchObject({ document_id: 'features', source_path: 'docs/product/features.md', scope_path: 'apps/tool' });
  expect(result.coverage).toEqual({ documents: 2, source_chunks: 41, selected_chunks: 30, omitted_chunks: 11 });
 });
 it('resolves selected IDs to literal published source quotations', async () => {
  const f = fixture([{ id: 'doc', path: 'README.md', texts: ['Find matching records and retain their source provenance.'] }]);
  const result = await f.run({ profile_mode: 'capabilities', subject_scope: 'apps/tool only' });
  expect(result.profile.capabilities).toEqual(['Find matching records.']);
  expect(result.facts[0]?.evidence[0]).toEqual({ document_id: 'doc', chunk_id: 'doc-0', excerpt: f.chunks[0]!.content });
  expect(f.request().subject_scope).toBe('apps/tool only');
  expect(f.request().chunks).toBeUndefined();
 });
 it('rejects an invented source option before publishing a profile', async () => {
  const f = fixture([{ id: 'doc', path: 'README.md', texts: ['Find matching records and retain their source provenance.'] }]);
  f.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({ facts: [{ field: 'purpose', value: 'Records.', evidence_ids: ['made-up'] }] }) } }] }));
  await expect(f.run({ profile_mode: 'capabilities' })).rejects.toThrow('supplied evidence IDs');
 });
 it('rejects a current capability supported only by future goals', async () => {
  const f = fixture([{ id: 'doc', path: 'PRODUCT.md', texts: ['# Product\n\n## North star\n\nBuild a workflow experiment runner next year.'] }]);
  await expect(f.run({ profile_mode: 'capabilities' })).rejects.toThrow('No source evidence');
 });
 it('rejects empty capability extraction in capability mode', async () => {
  const f = fixture([{ id: 'doc', path: 'README.md', texts: ['Find matching records and retain their source provenance.'] }]);
  f.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({ facts: [{ field: 'purpose', value: 'Records.', evidence_ids: ['s1'] }], needs: [] }) } }] }));
  await expect(f.run({ profile_mode: 'capabilities' })).rejects.toThrow('no implemented features');
 });
 it.each([{ subject_scope: '' }, { subject_scope: 3 }, { profile_mode: 'unchecked' }])('rejects malformed scope/mode before inference: %j', async (input) => {
  const f = fixture([{ id: 'doc', path: 'README.md', texts: ['Find matching records and retain their source provenance.'] }]);
  await expect(f.run(input)).rejects.toThrow('source documents are required');
  expect(f.fetch).not.toHaveBeenCalled();
 });
 it('preserves evidence from the end of a long implementation document', async () => {
  const f = fixture([{ id: 'doc', path: 'src/editor.ts', texts: Array.from({ length: 60 }, (_, i) => `Implemented operation number ${i} with a documented boundary.`) }]);
  await f.run({ profile_mode: 'capabilities' });
  expect(Object.values(f.request().evidence_options).some((value: any) => value.text.includes('operation number 59'))).toBe(true);
 });
 it('filters foreign ownership and a separate host edition while retaining shared public behavior', async () => {
  const f = fixture([{ id: 'doc', path: 'README.md', texts: ['# Tool\n\nTool owns the public caption editor.\n\nOther owns the unrelated browser history collector.\n\n## Website and Anna shared Studio\n\nPublic users edit caption text and export a PNG.\n\n## Anna edition\n\nAnna users upload identity photos through host storage.'] }]);
  await f.run({ profile_mode: 'capabilities', subject_id: 'acme/tool', subject_scope: 'Public website. Anna is a separate host edition.' });
  const values = Object.values(f.request().evidence_options).map((value: any) => value.text);
  expect(values.join(' ')).toContain('Public users edit caption text');
  expect(values.join(' ')).not.toContain('Other owns');
  expect(values.join(' ')).not.toContain('upload identity photos');
 });
 it('names the supported language variant instead of generalizing sibling implementations', async () => {
  const f = fixture([{ id: 'go', path: 'cli/go/src/main.go', texts: ['Creates missing directories recursively before saving JSON.'] }, { id: 'ts', path: 'cli/ts/src/main.ts', texts: ['Writes JSON to an existing parent directory only.'] }]);
  const result = await f.run({ profile_mode: 'capabilities' });
  expect(result.profile.capabilities).toEqual(['Go: Find matching records.']);
 });
 it('retains a bounded search abstraction alongside the literal feature references', async () => {
  const f = fixture([{ id: 'doc', path: 'README.md', texts: ['Edit captions on an image and export the result as PNG.'] }]);
  f.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({ purpose: { value: 'An image editor.', evidence_ids: ['s1'] }, capabilities: [{ value: 'Edit image captions.', search_query: 'Image caption editor', evidence_ids: ['s1'] }], needs: [] }) } }] }));
  const result = await f.run({ profile_mode: 'capabilities' });
  expect(result.facts.find((fact) => fact.field === 'capabilities')).toMatchObject({ search_query: 'Image caption editor', evidence: [{ excerpt: f.chunks[0]!.content }] });
 });
 it('rejects an unbounded feature search abstraction', async () => {
  const f = fixture([{ id: 'doc', path: 'README.md', texts: ['Edit captions on an image and export the result as PNG.'] }]);
  f.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({ facts: [{ field: 'purpose', value: 'Editor.', evidence_ids: ['s1'] }, { field: 'capabilities', value: 'Edit captions.', search_query: 'x'.repeat(65), evidence_ids: ['s1'] }] }) } }] }));
  await expect(f.run({ profile_mode: 'capabilities' })).rejects.toThrow('Invalid feature search query');
 });

 it('excludes an out-of-scope edition by implementation source path, even without prose labels', async () => {
  const f = fixture([{ id: 'web', path: 'worker/public/studio.js', texts: ['Renders editable text layers and exports an image.'] }, { id: 'host', path: 'anna/bundle/editor.mjs', texts: ['Uploads identity photos and stores personal image blobs.'] }]);
  await f.run({ profile_mode: 'capabilities', subject_scope: 'Public website. Anna is a separate host edition.' });
  const values = Object.values(f.request().evidence_options).map((value: any) => value.text).join(' ');
  expect(values).toContain('Renders editable text'); expect(values).not.toContain('Uploads identity photos');
 });

 it('allows a contract to establish purpose while restricting implemented-feature evidence', async () => {
  const f = fixture([{ id: 'contract', path: 'PRODUCT.md', texts: ['# Tool product contract\n\nHelps users edit image captions and export their own compositions.'] }, { id: 'source', path: 'src/editor.ts', texts: ['Renders caption text and exports a canvas image.'] }]);
  f.fetch.mockImplementationOnce(async (request: Request) => {
    const body = await request.json() as any; const source = JSON.parse(body.messages[1].content);
    const contractId = Object.keys(source.evidence_options).find((id) => source.evidence_options[id].source_path === 'PRODUCT.md');
    const implementationId = Object.keys(source.evidence_options).find((id) => source.evidence_options[id].source_path === 'src/editor.ts');
    expect(body.response_format.json_schema.schema.properties.purpose.properties.evidence_ids.items.enum).toContain(contractId);
    expect(body.response_format.json_schema.schema.properties.capabilities.items.properties.evidence_ids.items.enum).not.toContain(contractId);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ purpose: { value: 'A caption editor.', search_query: 'Image caption editor', evidence_ids: [contractId] }, capabilities: [{ value: 'Edit caption layers.', search_query: 'Editable image caption layers', evidence_ids: [implementationId] }], needs: [] }) } }] });
  });
  const result = await f.run({ profile_mode: 'capabilities' });
  expect(result.profile.purpose).toBe('A caption editor.'); expect(result.facts.find((fact) => fact.field === 'purpose')?.search_query).toBe('Image caption editor');
 });

 it('withholds inherited code from fork capability claims until the owning contract inventories it', async () => {
  const f = fixture([{ id: 'contract', path: 'PRODUCT.md', texts: ['# Tool product contract\n\nUpstream is the upstream implementation baseline.\n\n## Current evidence and remaining work\n\nThe owned session receiver lives in `src/current.ts` and reports linked conversations.'] }, { id: 'owned', path: 'src/current.ts', texts: ['Receives linked conversation activity and clears stale status.'] }, { id: 'inherited', path: 'src/upstream.ts', texts: ['Automatically rewrites all provider configuration on startup.'] }]);
  f.fetch.mockImplementationOnce(async (request: Request) => {
    const body = await request.json() as any; const source = JSON.parse(body.messages[1].content);
    const options = Object.entries(source.evidence_options) as Array<[string, any]>;
    expect(options.some(([, value]) => value.source_path === 'src/upstream.ts')).toBe(false);
    const [id] = options.find(([, value]) => value.source_path === 'src/current.ts')!;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ facts: [{ field: 'purpose', value: 'A session inbox.', evidence_ids: [id] }, { field: 'capabilities', value: 'Receive conversation activity.', evidence_ids: [id] }], needs: [] }) } }] });
  });
  expect((await f.run({ profile_mode: 'capabilities' })).profile.capabilities).toEqual(['Receive conversation activity.']);
 });

 it('retains code behavior after a long constructor preamble with bounded literal windows', async () => {
  const body = `function editor() { ${'const width = 10; '.repeat(80)} caption.addEventListener("input", updateCaption); canvas.toBlob(exportImage); }`;
  const f = fixture([{ id: 'code', path: 'src/editor.ts', texts: [body] }]);
  await f.run({ profile_mode: 'capabilities' });
  const windows = Object.values(f.request().evidence_options).map((value: any) => value.text);
  expect(windows.some((text) => text.includes('updateCaption'))).toBe(true);
  expect(windows.every((text) => text.length <= 1200 && body.includes(text))).toBe(true);
 });

});
