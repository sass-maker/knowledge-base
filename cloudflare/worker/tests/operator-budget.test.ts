import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index';
import type { Env } from '../src/types';

function setup(payload: unknown = status(), upstreamStatus = 200) {
  const fetch = vi.fn(async () => Response.json(payload, { status: upstreamStatus }));
  const idFromName = vi.fn((name: string) => name);
  const env = {
    RAG_SERVICE_DASHBOARD_KEYS: JSON.stringify({ 'operator-test': 'default' }),
    RAG_SERVICE_KEYS: JSON.stringify({ 'consumer-test': 'consumer' }),
    RAG_SERVICE_KEYS_APPEND: JSON.stringify({ 'append-test': 'consumer' }),
    RAG_SERVICE_PROOF_KEYS: JSON.stringify({ 'proof-test': 'consumer' }),
    NEURON_BUDGET: { idFromName, get: vi.fn(() => ({ fetch })) },
  } as unknown as Env;
  return { app: createApp(), env, fetch, idFromName };
}

function status() {
  return {
    monthKey: new Date().toISOString().slice(0, 7),
    query: { state: 'available', initialized: true, source: 'ledger', used: 35_000_000, cap: 45_000_000, remaining: 10_000_000, baselineVerified: true },
    storage: {
      state: 'available',
      initialized: false,
      source: 'verified_monthly_baseline',
      used: 30_000_000,
      cap: 200_000_000,
      remaining: 170_000_000,
      baselineVerified: true,
    },
  };
}

const path = '/v1/kb/operator/budget/vectorize';
const auth = (key = 'operator-test') => ({ headers: { Authorization: `Bearer ${key}` } });

describe('operator shared Vectorize budget read', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(['', 'consumer-test', 'append-test', 'proof-test'])('rejects non-operator access before reading the ledger: %s', async (key) => {
    const { app, env, fetch } = setup();
    const res = await app.request(path, auth(key), env);
    expect(res.status).toBe(key ? 403 : 401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses only a GET on the existing global ledger and strips unrecognized fields', async () => {
    const payload = { ...status(), unwanted: 'not forwarded' };
    const { app, env, fetch, idFromName } = setup(payload);
    const res = await app.request(path, auth(), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(status());
    expect(idFromName).toHaveBeenCalledExactlyOnceWith('global-budget');
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://internal.local/vectorize-usage',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    );
  });

  it('preserves unavailable storage as unknown rather than zero headroom', async () => {
    const payload = {
      ...status(),
      storage: { state: 'stale', initialized: false, source: null, used: null, cap: 200_000_000, remaining: null, baselineVerified: false },
    };
    const { app, env } = setup(payload);
    const res = await app.request(path, auth(), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it.each([
    [{ ...status(), monthKey: '2000-01' }, 'stale_period'],
    [{ ...status(), query: { ...status().query, remaining: 1 } }, 'invalid_ledger'],
    [{ ...status(), storage: { ...status().storage, baselineVerified: false } }, 'invalid_ledger'],
    [null, 'invalid_payload'],
  ])('fails closed for malformed or stale upstream state', async (payload, reason) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, env } = setup(payload);
    const res = await app.request(path, auth(), env);
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(log).toHaveBeenCalledExactlyOnceWith('knowledgebase shared Vectorize status unavailable', { reason });
  });

  it('returns a no-store failure when the binding or upstream is unavailable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, env } = setup({}, 503);
    for (const candidate of [env, { ...env, NEURON_BUDGET: undefined } as unknown as Env]) {
      const res = await app.request(path, auth(), candidate);
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(log.mock.calls).toEqual([
      ['knowledgebase shared Vectorize status unavailable', { reason: 'upstream_status' }],
      ['knowledgebase shared Vectorize status unavailable', { reason: 'missing_binding' }],
    ]);
  });

  it('classifies an HTTP 200 non-JSON response as invalid payload', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, env, fetch } = setup();
    fetch.mockResolvedValueOnce(new Response('not-json'));
    const res = await app.request(path, auth(), env);
    expect(res.status).toBe(503);
    expect(log).toHaveBeenCalledExactlyOnceWith('knowledgebase shared Vectorize status unavailable', { reason: 'invalid_payload' });
  });

  it('logs a bounded reason without exposing unexpected upstream error details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, env, fetch } = setup();
    fetch.mockRejectedValueOnce(new Error('private-upstream-detail'));
    const res = await app.request(path, auth(), env);
    expect(res.status).toBe(503);
    expect(log).toHaveBeenCalledExactlyOnceWith('knowledgebase shared Vectorize status unavailable', { reason: 'upstream_unavailable' });
    expect(JSON.stringify(await res.json())).not.toContain('private-upstream-detail');
  });
});
