import { HTTPException } from 'hono/http-exception';
import type { ConfiguredVectorizeProfile, IngestBody } from './app-types';
import {
  configuredVectorizeProfiles,
  embeddingModel,
  embeddingOptionsForProfile,
  embeddingProfileForIndex,
  jsonRecord,
  vectorizeProfileForIndex,
} from './app-utils';
import { reserveCatalogStorage, upsertCatalogVectors } from './catalog-storage';
import { chunkText } from './chunk';
import type { CreateChunkInput, Repository } from './repository';
import type { AppRuntime } from './runtime';
import { denyVectorizeStorageGrowth } from './shared-ai-budget';
import type { Env, IndexRecord, JsonRecord } from './types';

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

export async function contentHash(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonicalValue(value))));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateMetadata(content: string, value: unknown): JsonRecord {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value)))
    throw new HTTPException(400, { message: 'metadata must be an object' });
  const metadata = jsonRecord(value);
  if (Object.keys(metadata).some((key) => key.startsWith('_kb_'))) throw new HTTPException(400, { message: 'Reserved metadata field' });
  if (metadata.schema_version !== undefined && metadata.schema_version !== 1) throw new HTTPException(400, { message: 'Unsupported evidence schema version' });
  if (metadata.visibility !== undefined && !['public', 'private'].includes(String(metadata.visibility)))
    throw new HTTPException(400, { message: 'Invalid visibility' });
  for (const key of ['source_url', 'source_revision', 'source_path', 'source_excerpt']) {
    if (metadata[key] !== undefined && (typeof metadata[key] !== 'string' || String(metadata[key]).length > 4000))
      throw new HTTPException(400, { message: `Invalid ${key}` });
  }
  if (metadata.source_excerpt && !content.includes(String(metadata.source_excerpt)))
    throw new HTTPException(400, { message: 'Source excerpt must occur in document content' });
  return metadata;
}

function validateCatalogInput(input: NonNullable<IngestBody['documents']>[number]) {
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!content) throw new HTTPException(400, { message: 'document content is required' });
  if (content.length > 1_000_000) throw new HTTPException(413, { message: 'document content too large' });
  if (input.external_id !== undefined && typeof input.external_id !== 'string') throw new HTTPException(400, { message: 'external_id must be a string' });
  const externalId = input.external_id?.trim() || null;
  if (externalId && externalId.length > 256) throw new HTTPException(400, { message: 'external_id is too long' });
  const sourceMetadata = validateMetadata(content, input.metadata);
  return { content, externalId, sourceMetadata };
}

function validateChunking(chunking: IngestBody['chunking']): void {
  if (
    chunking !== undefined &&
    (!chunking ||
      typeof chunking !== 'object' ||
      Object.entries(chunking).some(([key, value]) => !['size', 'overlap'].includes(key) || typeof value !== 'number' || !Number.isFinite(value)))
  ) {
    throw new HTTPException(400, { message: 'Invalid chunking options' });
  }
}

export async function ingestCatalogDocument(
  env: Env,
  rt: AppRuntime,
  repo: Repository,
  index: IndexRecord,
  input: NonNullable<IngestBody['documents']>[number],
  chunking: IngestBody['chunking'],
) {
  const { content, externalId, sourceMetadata } = validateCatalogInput(input);
  validateChunking(chunking);
  if (!isCatalogSnapshot(externalId, sourceMetadata)) return ingestLegacyDocument(env, rt, repo, index, { content, externalId, sourceMetadata }, chunking);
  const fingerprint = await contentHash({ content, metadata: sourceMetadata, chunking: chunking ?? null });
  const previous = externalId && repo.getDocumentByExternalId ? await repo.getDocumentByExternalId(index.tenant, index.id, externalId) : null;
  if (previous?.metadata._kb_input_hash === fingerprint)
    return { document_id: previous.id, external_id: externalId, chunks_created: 0, idempotent: true, content_hash: fingerprint };
  if (externalId && (!repo.publishDocumentSnapshot || !repo.getDocumentByExternalId))
    throw new HTTPException(503, { message: 'Snapshot publication is unavailable' });
  await requireCatalogStorageReady(env, externalId, sourceMetadata);
  const profile = vectorizeProfileForIndex(env, index);
  const embedding = embeddingProfileForIndex(env, index, profile);
  const small = embedding.vectorizeProfile === 'base' ? configuredVectorizeProfiles(env).find((item) => item.key === 'small') : undefined;
  const id = crypto.randomUUID();
  const metadata = { ...snapshotMetadata(sourceMetadata, id, externalId), _kb_input_hash: fingerprint };
  const contents = chunkText(content, chunking);
  const chunks: CreateChunkInput[] = contents.map((text, i) => ({
    id: crypto.randomUUID(),
    tenant: index.tenant,
    indexId: index.id,
    documentId: id,
    content: text,
    chunkIndex: i,
    metadata,
  }));
  const admission = await reserveCatalogStorage(env, { tenant: index.tenant, indexId: index.id, chunkIds: chunks.map((chunk) => chunk.id) }, [
    profile,
    ...(small ? [small] : []),
  ]);
  const vectors = await rt.embed(env, contents, embeddingOptionsForProfile(embedding));
  const smallVectors = small ? await rt.embed(env, contents, { model: embeddingModel(env, 'small') }) : [];
  try {
    await upsertCatalogVectors(env, admission.get(profile), profile, chunks, vectors);
    if (small) await upsertCatalogVectors(env, admission.get(small), small, chunks, smallVectors);
    const document = { id, tenant: index.tenant, indexId: index.id, externalId, content, metadata };
    if (repo.publishDocumentSnapshot) await repo.publishDocumentSnapshot(document, chunks, previous?.id ?? null);
    else {
      await repo.createDocument(document);
      await repo.insertChunks(chunks);
    }
  } catch (error) {
    await Promise.allSettled([
      profile.binding.deleteByIds(chunks.map((chunk) => chunk.id)),
      ...(small ? [small.binding.deleteByIds(chunks.map((chunk) => chunk.id))] : []),
    ]);
    console.error('knowledgebase snapshot publication failed', { index_id: index.id, external_id: externalId, error: String(error) });
    throw error;
  }
  if (previous) await cleanPreviousVectors(repo, index.tenant, previous.id, profile, small);
  return { document_id: id, external_id: externalId, chunks_created: chunks.length, idempotent: false, content_hash: fingerprint };
}

async function ingestLegacyDocument(
  env: Env,
  rt: AppRuntime,
  repo: Repository,
  index: IndexRecord,
  input: ReturnType<typeof validateCatalogInput>,
  chunking: IngestBody['chunking'],
) {
  const [legacy] = await rt.ingestDocumentsToIndex(
    env,
    repo,
    index.tenant,
    index.id,
    [{ external_id: input.externalId ?? '', content: input.content, metadata: input.sourceMetadata }],
    chunking,
  );
  if (!legacy) throw new Error('Legacy ingestion produced no document');
  return { document_id: legacy.document_id, external_id: input.externalId, chunks_created: legacy.chunks.length, idempotent: false };
}

async function requireCatalogStorageReady(env: Env, externalId: string | null, metadata: JsonRecord): Promise<void> {
  if (!isCatalogSnapshot(externalId, metadata)) denyVectorizeStorageGrowth();
  if (!(await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_document_current_external'").first()))
    throw new HTTPException(503, { message: 'Catalog snapshot migration 0011 is required before storage reservation' });
}

function isCatalogSnapshot(externalId: string | null, metadata: JsonRecord): boolean {
  return !!externalId && typeof metadata.kind === 'string' && !!metadata.kind.trim() && ['public', 'private'].includes(String(metadata.visibility));
}

function snapshotMetadata(sourceMetadata: JsonRecord, id: string, externalId: string | null): JsonRecord {
  return {
    ...sourceMetadata,
    file_id: id,
    filename: sourceMetadata.source_path ?? sourceMetadata.source_url ?? externalId ?? id,
    page_start: 1,
    page_end: 1,
    _kb_snapshot_state: 'current',
  };
}

async function cleanPreviousVectors(
  repo: Repository,
  tenant: string,
  documentId: string,
  profile: ConfiguredVectorizeProfile,
  small: ConfiguredVectorizeProfile | undefined,
): Promise<void> {
  const oldIds = await repo.getChunkIdsForDocument(tenant, documentId);
  const cleanup = await Promise.allSettled([profile.binding.deleteByIds(oldIds), ...(small ? [small.binding.deleteByIds(oldIds)] : [])]);
  if (cleanup.some((result) => result.status === 'rejected')) console.error('knowledgebase stale vector cleanup pending', { document_id: documentId });
}
