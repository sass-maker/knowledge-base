import { HTTPException } from 'hono/http-exception';
import type { ConfiguredVectorizeProfile } from './app-types';
import { vectorMetadata, vectorNamespace } from './app-utils';
import type { CreateChunkInput } from './repository';
import { reserveVectorizeStorage } from './shared-ai-budget';
import type { Env, VectorizeVector } from './types';

export interface VectorizeStorageScope {
  tenant: string;
  indexId: string;
  chunkIds: string[];
}
export interface VectorizeStorageAdmission {
  readonly kind: 'vectorize_storage_admission';
}
export class VectorizeStorageAdmissionError extends HTTPException {
  constructor() {
    super(503, { message: 'Vectorize storage admission is invalid, expired, or already consumed.' });
  }
}
export interface PreparedVectorizeUpsert {
  validateBeforeDispatch(): void;
  providerCallStarted(): boolean;
  dispatch(): Promise<unknown>;
}
interface AdmissionState {
  env: Env;
  scope: VectorizeStorageScope;
  profile: ConfiguredVectorizeProfile;
  month: string;
  expiresAt: number;
}
// Object identity makes serialized, forged, cross-request, and reused receipts invalid.
const admissions = new WeakMap<VectorizeStorageAdmission, AdmissionState>();

function denyAdmission(): never {
  throw new VectorizeStorageAdmissionError();
}

export async function reserveVectorizeStorageAdmissions(env: Env, scope: VectorizeStorageScope, profiles: ConfiguredVectorizeProfile[]) {
  const scoped = { ...scope, chunkIds: [...scope.chunkIds] };
  const requestedProfiles = profiles.map((profile) => ({ requested: profile, snapshot: { ...profile } }));
  const profileSnapshots = requestedProfiles.map(({ snapshot }) => snapshot);
  if (!scoped.tenant || !scoped.indexId || !scoped.chunkIds.length || new Set(scoped.chunkIds).size !== scoped.chunkIds.length) denyAdmission();
  if (!profileSnapshots.length || profileSnapshots.length > 2 || new Set(profileSnapshots.map((profile) => profile.binding)).size !== profileSnapshots.length)
    denyAdmission();
  if (profileSnapshots.some((profile) => !Number.isSafeInteger(profile.dimensions) || profile.dimensions <= 0)) denyAdmission();
  const dimensions = scoped.chunkIds.length * profileSnapshots.reduce((total, profile) => total + profile.dimensions, 0);
  const month = new Date().toISOString().slice(0, 7);
  await reserveVectorizeStorage(env, dimensions);
  if (month !== new Date().toISOString().slice(0, 7)) denyAdmission();
  const tokens = new Map<ConfiguredVectorizeProfile, VectorizeStorageAdmission>();
  for (const { requested, snapshot } of requestedProfiles) {
    const token: VectorizeStorageAdmission = Object.freeze({ kind: 'vectorize_storage_admission' });
    admissions.set(token, {
      env,
      scope: scoped,
      profile: snapshot,
      month,
      expiresAt: Date.now() + 300000,
    });
    tokens.set(requested, token);
  }
  return tokens;
}

function consumeAdmission(
  env: Env,
  token: VectorizeStorageAdmission | undefined,
  profile: ConfiguredVectorizeProfile,
  chunks: CreateChunkInput[],
): AdmissionState {
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

export function prepareVectorizeUpsert(
  env: Env,
  token: VectorizeStorageAdmission | undefined,
  profile: ConfiguredVectorizeProfile,
  chunks: CreateChunkInput[],
  vectors: number[][],
): PreparedVectorizeUpsert {
  const state = consumeAdmission(env, token, profile, chunks);
  if (vectors.length !== chunks.length || vectors.some((vector) => vector.length !== profile.dimensions || vector.some((value) => !Number.isFinite(value))))
    denyAdmission();
  const binding = state.profile.binding;
  const rows: VectorizeVector[] = chunks.map((chunk, i) => ({
    id: chunk.id,
    values: [...(vectors[i] ?? [])],
    namespace: vectorNamespace(state.scope.tenant, state.scope.indexId),
    metadata: vectorMetadata(state.scope.tenant, state.scope.indexId, chunk.documentId, chunk.chunkIndex, chunk.content, chunk.metadata),
  }));
  let dispatched = false;
  let providerCallStarted = false;
  const validateBeforeDispatch = () => {
    if (state.expiresAt <= Date.now() || state.month !== new Date().toISOString().slice(0, 7)) denyAdmission();
  };
  return {
    validateBeforeDispatch,
    providerCallStarted: () => providerCallStarted,
    dispatch: async () => {
      if (dispatched) denyAdmission();
      dispatched = true;
      validateBeforeDispatch();
      providerCallStarted = true;
      return binding.upsert(rows);
    },
  };
}

export async function upsertVectorizeVectors(
  env: Env,
  token: VectorizeStorageAdmission | undefined,
  profile: ConfiguredVectorizeProfile,
  chunks: CreateChunkInput[],
  vectors: number[][],
): Promise<void> {
  await prepareVectorizeUpsert(env, token, profile, chunks, vectors).dispatch();
}

// Keep the catalog names as narrow wrappers while sharing the storage capability
// with ordinary ingestion paths that use the same global admission policy.
export const reserveCatalogStorage = reserveVectorizeStorageAdmissions;
export const upsertCatalogVectors = upsertVectorizeVectors;
