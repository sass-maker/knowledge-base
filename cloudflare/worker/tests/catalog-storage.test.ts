import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfiguredVectorizeProfile } from '../src/app-types';
import { vectorMetadata } from '../src/app-utils';
import { prepareVectorizeUpsert, reserveCatalogStorage, upsertCatalogVectors } from '../src/catalog-storage';
import { reserveVectorizeStorage } from '../src/shared-ai-budget';
import { catalogFixture, sourceChunk, sourceDocument } from './catalog-fixture';

function profile(binding: ConfiguredVectorizeProfile['binding'], dimensions = 768): ConfiguredVectorizeProfile {
  return { key: dimensions === 768 ? 'base' : 'small', semanticModel: dimensions === 768 ? 'base' : 'small', dimensions, binding, bindingName: 'LOCAL' };
}
afterEach(() => vi.useRealTimers());

describe('catalog storage admission', () => {
  it('atomically reserves exact base plus small dimensions and consumes each token once', async () => {
    const { env, binding, debits, sqlite, upsert } = catalogFixture();
    const base = profile(binding);
    const smallUpsert = vi.fn(async () => ({}));
    const small = profile({ ...binding, upsert: smallUpsert }, 384);
    const chunks = [sourceChunk(sourceDocument('one')), sourceChunk(sourceDocument('two'))];
    const tokens = await reserveCatalogStorage(env, { tenant: 'tenant-a', indexId: 'catalog', chunkIds: chunks.map((chunk) => chunk.id) }, [base, small]);
    expect(debits).toEqual([2 * (768 + 384)]);
    await upsertCatalogVectors(
      env,
      tokens.get(base),
      base,
      chunks,
      chunks.map(() => Array(768).fill(0.1)),
    );
    await upsertCatalogVectors(
      env,
      tokens.get(small),
      small,
      chunks,
      chunks.map(() => Array(384).fill(0.1)),
    );
    await expect(
      upsertCatalogVectors(
        env,
        tokens.get(base),
        base,
        chunks,
        chunks.map(() => Array(768).fill(0.1)),
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(smallUpsert).toHaveBeenCalledTimes(1);
    sqlite.close();
  });

  it('charges the reservation-time profile snapshot and rejects a profile mutated during reserve', async () => {
    const { env, binding, sqlite, upsert } = catalogFixture();
    const base = profile(binding);
    const chunk = sourceChunk(sourceDocument('source'));
    const scope = { tenant: 'tenant-a', indexId: 'catalog', chunkIds: [chunk.id] };
    let signalStarted!: () => void;
    let releaseReservation!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const reservationGate = new Promise<void>((resolve) => { releaseReservation = resolve; });
    const chargedDimensions: number[] = [];
    env.NEURON_BUDGET = {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (_url: string, init: RequestInit) => {
          const { dimensions } = JSON.parse(String(init.body)) as { dimensions: number };
          chargedDimensions.push(dimensions);
          signalStarted();
          await reservationGate;
          return Response.json({
            allowed: true,
            baselineVerified: true,
            monthKey: new Date().toISOString().slice(0, 7),
            retryAfter: 0,
            used: dimensions,
            remaining: 45_000_000 - dimensions,
            storedCap: 200_000_000,
            storedUsed: dimensions,
            storedRemaining: 200_000_000 - dimensions,
          });
        },
      }),
    } as unknown as NonNullable<typeof env.NEURON_BUDGET>;

    const pendingAdmission = reserveCatalogStorage(env, scope, [base]);
    await started;
    scope.chunkIds[0] = 'mutated-chunk-id';
    base.key = 'small';
    base.dimensions = 384;
    base.binding = { ...binding };
    releaseReservation();
    const tokens = await pendingAdmission;

    expect(chargedDimensions).toEqual([768]);
    await expect(upsertCatalogVectors(env, tokens.get(base), base, [chunk], [Array(384).fill(0.1)])).rejects.toMatchObject({ status: 503 });
    expect(upsert).not.toHaveBeenCalled();
    sqlite.close();
  });

  it.each(['forged', 'expired', 'wrong tenant', 'wrong index', 'wrong binding', 'wrong dimensions'])('rejects %s admission without uploading', async (failure) => {
    const { env, binding, sqlite, upsert } = catalogFixture();
    const base = profile(binding);
    const chunk = sourceChunk(sourceDocument('source'));
    const tokens = await reserveCatalogStorage(env, { tenant: 'tenant-a', indexId: 'catalog', chunkIds: [chunk.id] }, [base]);
    if (failure === 'expired') {
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 300001);
    }
    const token = failure === 'forged' ? ({} as Parameters<typeof upsertCatalogVectors>[1]) : tokens.get(base);
    const target = failure === 'wrong binding' ? { ...base, binding: { ...binding } } : failure === 'wrong dimensions' ? { ...base, dimensions: 384 } : base;
    const chunks = failure === 'wrong tenant' ? [{ ...chunk, tenant: 'tenant-b' }] : failure === 'wrong index' ? [{ ...chunk, indexId: 'other-index' }] : [chunk];
    await expect(upsertCatalogVectors(env, token, target, chunks, [Array(768).fill(0.1)])).rejects.toMatchObject({ status: 503 });
    expect(upsert).not.toHaveBeenCalled();
    sqlite.close();
  });

  it('allows a prepared vector dispatch only once', async () => {
    const { env, binding, sqlite, upsert } = catalogFixture();
    const base = profile(binding);
    const chunk = sourceChunk(sourceDocument('source'));
    const tokens = await reserveCatalogStorage(env, { tenant: 'tenant-a', indexId: 'catalog', chunkIds: [chunk.id] }, [base]);
    const prepared = prepareVectorizeUpsert(env, tokens.get(base), base, [chunk], [Array(768).fill(0.1)]);

    await prepared.dispatch();
    await expect(prepared.dispatch()).rejects.toMatchObject({ status: 503 });
    expect(upsert).toHaveBeenCalledTimes(1);
    sqlite.close();
  });

  it('rechecks admission expiry at dispatch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T00:00:00.000Z'));
    const { env, binding, sqlite, upsert } = catalogFixture();
    const base = profile(binding);
    const chunk = sourceChunk(sourceDocument('source'));
    const tokens = await reserveCatalogStorage(env, { tenant: 'tenant-a', indexId: 'catalog', chunkIds: [chunk.id] }, [base]);
    const prepared = prepareVectorizeUpsert(env, tokens.get(base), base, [chunk], [Array(768).fill(0.1)]);
    vi.setSystemTime(new Date('2026-10-25T00:05:01.000Z'));

    expect(() => prepared.validateBeforeDispatch()).toThrowError(/admission/i);
    await expect(prepared.dispatch()).rejects.toMatchObject({ status: 503 });
    expect(upsert).not.toHaveBeenCalled();
    sqlite.close();
  });

  it('uses the captured binding and vector values after preparation', async () => {
    const { env, binding, sqlite } = catalogFixture();
    const base = profile(binding);
    const chunk = sourceChunk(sourceDocument('source'));
    const tokens = await reserveCatalogStorage(env, { tenant: 'tenant-a', indexId: 'catalog', chunkIds: [chunk.id] }, [base]);
    const values = [Array(768).fill(0.1)];
    const prepared = prepareVectorizeUpsert(env, tokens.get(base), base, [chunk], values);
    const dispatchedUpsert = vi.spyOn(binding, 'upsert');
    const replacementUpsert = vi.fn(async () => ({}));
    base.binding = { ...binding, upsert: replacementUpsert };
    values[0]![0] = 0.9;

    await prepared.dispatch();

    expect(dispatchedUpsert).toHaveBeenCalledTimes(1);
    expect(dispatchedUpsert.mock.calls[0]?.[0]?.[0]?.values[0]).toBe(0.1);
    expect(replacementUpsert).not.toHaveBeenCalled();
    sqlite.close();
  });

  it('rejects a prepared admission when the UTC month changes before dispatch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T23:59:59.000Z'));
    const { env, binding, sqlite, upsert } = catalogFixture();
    const base = profile(binding);
    const chunk = sourceChunk(sourceDocument('source'));
    const tokens = await reserveCatalogStorage(env, { tenant: 'tenant-a', indexId: 'catalog', chunkIds: [chunk.id] }, [base]);
    const prepared = prepareVectorizeUpsert(env, tokens.get(base), base, [chunk], [Array(768).fill(0.1)]);
    vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));

    expect(() => prepared.validateBeforeDispatch()).toThrowError(/admission/i);
    await expect(prepared.dispatch()).rejects.toMatchObject({ status: 503 });
    expect(upsert).not.toHaveBeenCalled();
    sqlite.close();
  });

  it('consumes ambiguous failed writes and never reuses or refunds their credit', async () => {
    const { env, binding, sqlite, upsert, debits } = catalogFixture();
    const base = profile(binding);
    const chunk = sourceChunk(sourceDocument('source'));
    const tokens = await reserveCatalogStorage(env, { tenant: 'tenant-a', indexId: 'catalog', chunkIds: [chunk.id] }, [base]);
    upsert.mockRejectedValueOnce(new Error('Ambiguous transport failure'));
    await expect(upsertCatalogVectors(env, tokens.get(base), base, [chunk], [Array(768).fill(0.1)])).rejects.toThrow(/Ambiguous/);
    await expect(upsertCatalogVectors(env, tokens.get(base), base, [chunk], [Array(768).fill(0.1)])).rejects.toMatchObject({ status: 503 });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(debits).toEqual([768]);
    sqlite.close();
  });

  it.each([
    { storedCap: 1 },
    { storedRemaining: 0 },
    { baselineVerified: false },
    { monthKey: '2000-01' },
    { used: -1 },
    { storedUsed: 0 },
    { allowed: false },
  ])('rejects malformed receipt %j', async (override) => {
    const { env, sqlite, budgetFetch } = catalogFixture();
    budgetFetch.mockResolvedValueOnce(
      Response.json({
        allowed: true,
        baselineVerified: true,
        monthKey: new Date().toISOString().slice(0, 7),
        retryAfter: 0,
        used: 768,
        remaining: 45000000 - 768,
        storedCap: 200000000,
        storedUsed: 768,
        storedRemaining: 200000000 - 768,
        ...override,
      }),
    );
    await expect(reserveVectorizeStorage(env, 768)).rejects.toMatchObject({ status: 503 });
    sqlite.close();
  });

  it('keeps catalog filtering available when large canonical metadata requires hydration', () => {
    const metadata = vectorMetadata('tenant-a', 'catalog', 'document', 0, 'source', {
      kind: 'catalog_profile',
      visibility: 'public',
      repo_id: 7,
      facts: 'evidence'.repeat(10000),
    });
    expect(new TextEncoder().encode(JSON.stringify(metadata)).byteLength).toBeLessThan(9500);
    expect(metadata).toMatchObject({ metadata_hydrate: true, kind: 'catalog_profile', repo_id: 7 });
  });
});
