import { describe, expect, it, vi } from 'vitest';

import { denyVectorizeStorageGrowth, reserveModelCall, reserveVectorizeDimensions, reserveWorkersAiNeurons } from '../src/shared-ai-budget';
import type { Env } from '../src/types';

function makeEnv(response: unknown, status = 200) {
  const requests: Array<{ url: string; body: unknown }> = [];
  const namespace = {
    idFromName: vi.fn((name: string) => name),
    get: vi.fn(() => ({
      fetch: vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init.body)) });
        return Response.json(response, { status });
      }),
    })),
  };
  return { env: { NEURON_BUDGET: namespace } as unknown as Env, requests, namespace };
}

describe('shared AI budget reservations', () => {
  it('requires a complete current-day neuron reservation before admitting a call', async () => {
    const { env, requests, namespace } = makeEnv({
      allowed: true,
      used: 100,
      remaining: 9_400,
      retryAfter: 0,
      dayKey: new Date().toISOString().slice(0, 10),
    });
    await reserveWorkersAiNeurons(env, 100);
    expect(requests).toEqual([{ url: 'https://internal.local/try-debit', body: { neurons: 100 } }]);
    expect(namespace.idFromName).toHaveBeenCalledWith('global-budget');
  });

  it('fails closed when the neuron budget response is malformed or stale', async () => {
    const { env } = makeEnv({ allowed: true, used: 100, remaining: 9_400, retryAfter: 0, dayKey: '2000-01-01' });
    await expect(reserveWorkersAiNeurons(env, 100)).rejects.toMatchObject({ status: 503 });
  });

  it('requires an explicitly verified current-month baseline for Vectorize', async () => {
    const { env, requests } = makeEnv({
      allowed: true,
      used: 20_000_000,
      remaining: 25_000_000,
      retryAfter: 0,
      monthKey: new Date().toISOString().slice(0, 7),
      baselineVerified: true,
    });
    await reserveVectorizeDimensions(env, 768);
    expect(requests[0]).toEqual({
      url: 'https://internal.local/try-debit-vectorize',
      body: { dimensions: 768 },
    });
  });

  it('blocks Vectorize when baseline, cap arithmetic, or binding is unverified', async () => {
    const { env } = makeEnv({
      allowed: true,
      used: 20_000_768,
      remaining: 24_999_232,
      retryAfter: 0,
      monthKey: new Date().toISOString().slice(0, 7),
      baselineVerified: false,
    });
    await expect(reserveVectorizeDimensions(env, 768)).rejects.toMatchObject({ status: 503 });
    await expect(reserveModelCall({} as Env, '@cf/baai/bge-base-en-v1.5', { text: ['query'] })).rejects.toMatchObject({ status: 503 });
  });

  it('reserves model-priced neurons from serialized UTF-8 input and rejects unpriced models', async () => {
    const { env, requests } = makeEnv({
      allowed: true,
      used: 1,
      remaining: 9_499,
      retryAfter: 0,
      dayKey: new Date().toISOString().slice(0, 10),
    });
    await reserveModelCall(env, '@cf/baai/bge-base-en-v1.5', { text: ['é'] });
    expect(requests[0]?.body).toEqual({ neurons: 1 });
    await expect(reserveModelCall(env, '@cf/unknown/model', { text: ['query'] })).rejects.toMatchObject({ status: 503 });
  });

  it('fails closed on non-200 reservations', async () => {
    const { env } = makeEnv({}, 503);
    await expect(reserveVectorizeDimensions(env, 768)).rejects.toMatchObject({ status: 503 });
  });

  it('blocks Vectorize storage growth independently of the query budget', () => {
    expect(denyVectorizeStorageGrowth).toThrowError(/storage growth is disabled/);
  });

  it('rejects unbounded text output before spending neurons', async () => {
    const { env, requests } = makeEnv({
      allowed: true,
      used: 10,
      remaining: 9_490,
      retryAfter: 0,
      dayKey: new Date().toISOString().slice(0, 10),
    });
    await expect(reserveModelCall(env, '@cf/meta/llama-3.1-8b-instruct', { messages: [] }, 0)).rejects.toMatchObject({ status: 503 });
    await expect(reserveModelCall(env, '@cf/meta/llama-3.1-8b-instruct', { messages: [] }, 8_193)).rejects.toMatchObject({ status: 503 });
    expect(requests).toEqual([]);
  });
});
