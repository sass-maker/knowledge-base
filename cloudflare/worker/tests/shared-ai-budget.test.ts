import { describe, expect, it, vi } from 'vitest';
import {
  denyVectorizeStorageGrowth,
  reserveModelCall,
  reserveVectorizeDimensions,
  reserveVectorizeStorage,
  reserveWorkersAiNeurons,
} from '../src/shared-ai-budget';
import type { Env } from '../src/types';

const VECTORIZE_CAP = 45_000_000;
const VECTORIZE_STORED_CAP = 200_000_000;
const NEURON_CAP = 9_500;

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    allowed: true,
    baselineVerified: true,
    monthKey: new Date().toISOString().slice(0, 7),
    retryAfter: 0,
    used: 768,
    remaining: VECTORIZE_CAP - 768,
    storedCap: VECTORIZE_STORED_CAP,
    storedUsed: 768,
    storedRemaining: VECTORIZE_STORED_CAP - 768,
    ...overrides,
  };
}

function testEnv(fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const aiRun = vi.fn();
  const env = {
    AI: { run: aiRun },
    NEURON_BUDGET: {
      idFromName: vi.fn(() => 'global-budget'),
      get: vi.fn(() => ({ fetch })),
    },
  } as unknown as Env;
  return { env, aiRun };
}

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

async function expectAdmissionFailure(promise: Promise<void>, kind: string, reason: string) {
  const error = await promise.then(
    () => undefined,
    (failure: unknown) => failure as { status?: number; message?: string },
  );
  expect(error).toMatchObject({
    status: 503,
    message: expect.stringContaining(`[budget_admission kind=${kind} reason=${reason}]`),
  });
  return error as { status: number; message: string };
}

describe('shared AI budget admission diagnostics', () => {
  it('distinguishes vector storage and neuron denials without leaking response data or calling AI', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/try-debit-vectorize-storage')) return Response.json({ allowed: false, monthKey: receipt().monthKey });
      return Response.json({ allowed: false, dayKey: new Date().toISOString().slice(0, 10) });
    });
    const { env, aiRun } = testEnv(fetch);

    await expectAdmissionFailure(reserveVectorizeStorage(env, 768), 'vectorize_storage', 'denied_receipt');
    await expectAdmissionFailure(reserveWorkersAiNeurons(env, 10), 'neurons', 'denied_receipt');

    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      'https://internal.local/try-debit-vectorize-storage',
      'https://internal.local/try-debit',
    ]);
    expect(aiRun).not.toHaveBeenCalled();
  });

  it('accepts a valid current storage receipt', async () => {
    const fetch = vi.fn(async () => Response.json(receipt()));
    const { env, aiRun } = testEnv(fetch);

    await expect(reserveVectorizeStorage(env, 768)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(aiRun).not.toHaveBeenCalled();
  });

  it('preserves current neuron and queried-Vectorize positive reservations', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, number>;
      if (url.endsWith('/try-debit')) {
        const neurons = body.neurons ?? 0;
        return Response.json({
          allowed: true,
          dayKey: new Date().toISOString().slice(0, 10),
          retryAfter: 0,
          used: neurons,
          remaining: NEURON_CAP - neurons,
        });
      }
      const dimensions = body.dimensions ?? 0;
      return Response.json({
        allowed: true,
        monthKey: new Date().toISOString().slice(0, 7),
        baselineVerified: true,
        retryAfter: 0,
        used: dimensions,
        remaining: VECTORIZE_CAP - dimensions,
      });
    });
    const { env, aiRun } = testEnv(fetch);

    await reserveWorkersAiNeurons(env, 100);
    await reserveVectorizeDimensions(env, 768);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(aiRun).not.toHaveBeenCalled();
  });

  it('preserves model pricing and rejects unpriced models and invalid output limits', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { neurons = 0 } = JSON.parse(String(init?.body)) as { neurons?: number };
      return Response.json({
        allowed: true,
        dayKey: new Date().toISOString().slice(0, 10),
        retryAfter: 0,
        used: neurons,
        remaining: NEURON_CAP - neurons,
      });
    });
    const { env, aiRun } = testEnv(fetch);

    await reserveModelCall(env, '@cf/baai/bge-base-en-v1.5', { text: ['é'] });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expectAdmissionFailure(reserveModelCall(env, '@cf/unknown/model', { text: ['query'] }), 'neurons', 'invalid_request');
    await expectAdmissionFailure(reserveModelCall(env, '@cf/meta/llama-3.1-8b-instruct', { messages: [] }, 0), 'neurons', 'invalid_request');
    await expectAdmissionFailure(reserveModelCall(env, '@cf/meta/llama-3.1-8b-instruct', { messages: [] }, 8_193), 'neurons', 'invalid_request');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(aiRun).not.toHaveBeenCalled();
  });

  it('keeps storage growth disabled independently of shared budget admission', () => {
    expect(denyVectorizeStorageGrowth).toThrowError(/storage growth is disabled/);
  });

  it('reports a missing budget binding separately', async () => {
    const env = { AI: { run: vi.fn() } } as unknown as Env;

    await expectAdmissionFailure(reserveVectorizeStorage(env, 768), 'vectorize_storage', 'missing_binding');
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('reports transport failures without including exception details', async () => {
    const { env, aiRun } = testEnv(async () => {
      throw new Error('sensitive transport detail');
    });

    const error = await expectAdmissionFailure(reserveVectorizeStorage(env, 768), 'vectorize_storage', 'transport_error');
    expect(error.message).not.toContain('sensitive transport detail');
    expect(aiRun).not.toHaveBeenCalled();
  });

  it('reports a non-200 response without including its body', async () => {
    const privateBody = 'sensitive response body';
    const { env, aiRun } = testEnv(async () => Response.json({ error: privateBody }, { status: 503 }));

    const error = await expectAdmissionFailure(reserveVectorizeStorage(env, 768), 'vectorize_storage', 'http_status_503');
    expect(error.message).not.toContain(privateBody);
    expect(aiRun).not.toHaveBeenCalled();
  });

  it.each([
    {
      kind: 'vectorize_dimensions',
      operation: (env: Env) => reserveVectorizeDimensions(env, 768),
      body: { error: 'Verified monthly Vectorize baseline unavailable' },
      reason: 'monthly_baseline_unavailable',
    },
    {
      kind: 'vectorize_storage',
      operation: (env: Env) => reserveVectorizeStorage(env, 768),
      body: { error: 'Verified monthly Vectorize baseline unavailable' },
      reason: 'monthly_baseline_unavailable',
    },
    {
      kind: 'vectorize_storage',
      operation: (env: Env) => reserveVectorizeStorage(env, 768),
      body: { error: 'Verified storage baseline unavailable' },
      reason: 'storage_baseline_unavailable',
    },
  ])('maps allowlisted 503 failure for $kind to $reason', async ({ kind, operation, body, reason }) => {
    const { env, aiRun } = testEnv(async () => Response.json(body, { status: 503 }));

    await expectAdmissionFailure(operation(env), kind, reason);
    expect(aiRun).not.toHaveBeenCalled();
  });

  it('reports malformed JSON without including the response text', async () => {
    const { env, aiRun } = testEnv(async () => new Response('sensitive invalid json', { status: 200 }));

    await expectAdmissionFailure(reserveVectorizeStorage(env, 768), 'vectorize_storage', 'malformed_json');
    expect(aiRun).not.toHaveBeenCalled();
  });

  it('rejects unsafe requests before contacting the budget binding', async () => {
    const fetch = vi.fn(async () => Response.json(receipt()));
    const { env, aiRun } = testEnv(fetch);

    await expectAdmissionFailure(reserveVectorizeStorage(env, 0), 'vectorize_storage', 'invalid_request');
    await expectAdmissionFailure(reserveWorkersAiNeurons(env, NEURON_CAP + 1), 'neurons', 'invalid_request');

    expect(fetch).not.toHaveBeenCalled();
    expect(aiRun).not.toHaveBeenCalled();
  });

  it('classifies an invalid calendar day as a malformed neuron receipt', async () => {
    const { env, aiRun } = testEnv(async () =>
      Response.json({
        allowed: true,
        dayKey: '2026-02-30',
        retryAfter: 0,
        used: 1,
        remaining: NEURON_CAP - 1,
      }),
    );

    await expectAdmissionFailure(reserveWorkersAiNeurons(env, 1), 'neurons', 'malformed_receipt');
    expect(aiRun).not.toHaveBeenCalled();
  });

  it.each([
    { receipt: receipt({ monthKey: '2000-01' }), reason: 'stale_period' },
    { receipt: receipt({ monthKey: '2026-13' }), reason: 'malformed_receipt' },
    { receipt: receipt({ baselineVerified: false }), reason: 'unverified_baseline' },
    { receipt: receipt({ allowed: false }), reason: 'denied_receipt' },
    { receipt: receipt({ storedRemaining: 0 }), reason: 'invalid_arithmetic' },
    { receipt: receipt({ used: -1 }), reason: 'malformed_receipt' },
    { receipt: receipt({ storedCap: 1 }), reason: 'storage_cap' },
    { receipt: [], reason: 'malformed_receipt' },
    { receipt: { allowed: true }, reason: 'malformed_receipt' },
    { receipt: receipt({ monthKey: 202610 }), reason: 'malformed_receipt' },
    { receipt: receipt({ baselineVerified: 'true' }), reason: 'malformed_receipt' },
    { receipt: receipt({ storedCap: '200000000' }), reason: 'malformed_receipt' },
  ])('classifies storage receipt failure as $reason', async ({ receipt: result, reason }) => {
    const { env, aiRun } = testEnv(async () => Response.json(result));

    await expectAdmissionFailure(reserveVectorizeStorage(env, 768), 'vectorize_storage', reason);
    expect(aiRun).not.toHaveBeenCalled();
  });
});

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
