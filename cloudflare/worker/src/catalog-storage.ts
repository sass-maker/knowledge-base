import { HTTPException } from 'hono/http-exception';
import type { ConfiguredVectorizeProfile } from './app-types';
import { vectorMetadata, vectorNamespace } from './app-utils';
import type { CreateChunkInput } from './repository';
import { reserveVectorizeStorage } from './shared-ai-budget';
import type { Env, VectorizeVector } from './types';

interface CatalogStorageScope {
  tenant: string;
  indexId: string;
  chunkIds: string[];
}
interface StorageAdmission {
  readonly kind: 'catalog_storage_admission';
}
interface AdmissionState {
  env: Env;
  scope: CatalogStorageScope;
  profile: ConfiguredVectorizeProfile;
  month: string;
  expiresAt: number;
}
// Object identity makes serialized, forged, cross-request, and reused receipts invalid.
const admissions = new WeakMap<StorageAdmission, AdmissionState>();

function denyAdmission(): never {
  throw new HTTPException(503, { message: 'Catalog storage admission is invalid, expired, or already consumed.' });
}

export async function reserveCatalogStorage(env: Env, scope: CatalogStorageScope, profiles: ConfiguredVectorizeProfile[]) {
  if (!scope.tenant || !scope.indexId || !scope.chunkIds.length || new Set(scope.chunkIds).size !== scope.chunkIds.length) denyAdmission();
  if (!profiles.length || profiles.length > 2 || new Set(profiles.map((profile) => profile.binding)).size !== profiles.length) denyAdmission();
  if (profiles.some((profile) => !Number.isSafeInteger(profile.dimensions) || profile.dimensions <= 0)) denyAdmission();
  const dimensions = scope.chunkIds.length * profiles.reduce((total, profile) => total + profile.dimensions, 0);
  const month = new Date().toISOString().slice(0, 7);
  await reserveVectorizeStorage(env, dimensions);
  if (month !== new Date().toISOString().slice(0, 7)) denyAdmission();
  const tokens = new Map<ConfiguredVectorizeProfile, StorageAdmission>();
  for (const profile of profiles) {
    const token: StorageAdmission = Object.freeze({ kind: 'catalog_storage_admission' });
    admissions.set(token, {
      env,
      scope: { ...scope, chunkIds: [...scope.chunkIds] },
      profile: { ...profile },
      month,
      expiresAt: Date.now() + 300000,
    });
    tokens.set(profile, token);
  }
  return tokens;
}

function consumeAdmission(env: Env, token: StorageAdmission | undefined, profile: ConfiguredVectorizeProfile, chunks: CreateChunkInput[]): AdmissionState {
  if (!token) return denyAdmission();
  const state = admissions.get(token);
  admissions.delete(token); // Failures consume credit too; no refunds or retry reuse.
  if (!state || state.env !== env || state.expiresAt <= Date.now() || state.month !== new Date().toISOString().slice(0, 7)) return denyAdmission();
  if (state.profile.binding !== profile.binding || state.profile.dimensions !== profile.dimensions || state.profile.key !== profile.key) return denyAdmission();
  if (
    state.scope.chunkIds.length !== chunks.length ||
    chunks.some((chunk, i) => chunk.id !== state.scope.chunkIds[i] || chunk.tenant !== state.scope.tenant || chunk.indexId !== state.scope.indexId)
  )
    return denyAdmission();
  return state;
}

export async function upsertCatalogVectors(
  env: Env,
  token: StorageAdmission | undefined,
  profile: ConfiguredVectorizeProfile,
  chunks: CreateChunkInput[],
  vectors: number[][],
): Promise<void> {
  const state = consumeAdmission(env, token, profile, chunks);
  if (vectors.length !== chunks.length || vectors.some((vector) => vector.length !== profile.dimensions || vector.some((value) => !Number.isFinite(value))))
    denyAdmission();
  const rows: VectorizeVector[] = chunks.map((chunk, i) => ({
    id: chunk.id,
    values: vectors[i] ?? [],
    namespace: vectorNamespace(state.scope.tenant, state.scope.indexId),
    metadata: vectorMetadata(state.scope.tenant, state.scope.indexId, chunk.documentId, chunk.chunkIndex, chunk.content, chunk.metadata),
  }));
  await profile.binding.upsert(rows);
}
