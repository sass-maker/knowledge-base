import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFreeAiEmbeddingCatalog, freeAiChatRaw, freeAiEmbed } from '../src/free-ai';
import type { Env } from '../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    FREE_AI_API_KEY: 'test-key',
    FREE_AI_BASE_URL: 'https://provider.example/v1',
    FREE_AI_EMBED_MODEL: 'gemini-embedding-001',
    FREE_AI_EMBED_PROVIDER: 'gemini',
    FREE_AI_EMBED_DIMENSIONS: '1536',
    FREE_AI_SYNTH_MODEL: 'gemini-2.5-flash',
    AI: {} as unknown as Ai,
    DB: {} as D1Database,
    VECTORIZE: {} as Env['VECTORIZE'],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function vec(length: number, fill = 0.1): number[] {
  return Array.from({ length }, () => fill);
}

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function captureFetch(handler: (req: CapturedRequest) => Response): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: { headers?: Record<string, string>; body?: string } = {}) => {
      const req: CapturedRequest = {
        url: String(url),
        headers: init.headers ?? {},
        body: JSON.parse(init.body ?? '{}') as Record<string, unknown>,
      };
      captured.push(req);
      return handler(req);
    }),
  );
  return captured;
}

function first(calls: CapturedRequest[]): CapturedRequest {
  const req = calls[0];
  if (!req) throw new Error('expected at least one captured request');
  return req;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('freeAiEmbed', () => {
  it('uses configured provider/model + 1536 dims when no caller model is supplied', async () => {
    const calls = captureFetch((req) =>
      jsonResponse({ data: (req.body.input as string[]).map((_, i) => ({ index: i, embedding: vec(1536) })) }),
    );
    const out = await freeAiEmbed(makeEnv(), ['alpha', 'beta']);

    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(1536);
    const req = first(calls);
    expect(req.url).toBe('https://provider.example/v1/embeddings');
    expect(req.headers.Authorization).toBe('Bearer test-key');
    expect(req.headers).not.toHaveProperty('x-gateway-force-provider');
    expect(req.headers).not.toHaveProperty('x-gateway-force-model');
    expect(req.body.dimensions).toBe(1536);
    expect(req.body.model).toBe('gemini-embedding-001');
    expect(req.body).not.toHaveProperty('project_id');
  });

  it('honors known caller model ids with catalog provider and dimensions', async () => {
    const calls = captureFetch((req) =>
      jsonResponse({ data: (req.body.input as string[]).map((_, i) => ({ index: i, embedding: vec(384) })) }),
    );
    const out = await freeAiEmbed(makeEnv(), ['x'], { model: '@cf/baai/bge-small-en-v1.5' });
    expect(first(calls).headers).not.toHaveProperty('x-gateway-force-provider');
    expect(first(calls).headers).not.toHaveProperty('x-gateway-force-model');
    expect(first(calls).body).not.toHaveProperty('dimensions');
    expect(first(calls).body.model).toBe('@cf/baai/bge-small-en-v1.5');
    expect(out[0]).toHaveLength(384);
  });

  it('preserves input order using the returned index field', async () => {
    captureFetch((req) =>
      jsonResponse({
        data: (req.body.input as string[]).map((text, i) => ({ index: i, embedding: vec(1536, text.length) })),
      }),
    );
    const out = await freeAiEmbed(makeEnv(), ['a', 'bbbb'], { model: 'base' });
    expect(out[0]?.[0]).toBe(1);
    expect(out[1]?.[0]).toBe(4);
  });

  it('fails closed when the provider returns a wrong-dimension vector', async () => {
    captureFetch((req) =>
      jsonResponse({ data: (req.body.input as string[]).map((_, i) => ({ index: i, embedding: vec(768) })) }),
    );
    await expect(freeAiEmbed(makeEnv(), ['x'], { model: 'base' })).rejects.toThrow(/dimension mismatch/);
  });

  it('fails closed on a count mismatch', async () => {
    captureFetch(() => jsonResponse({ data: [{ index: 0, embedding: vec(768) }] }));
    await expect(freeAiEmbed(makeEnv(), ['a', 'b'], {})).rejects.toThrow(/count mismatch/);
  });

  it('throws when FREE_AI_API_KEY is missing', async () => {
    captureFetch(() => jsonResponse({ data: [] }));
    const env = makeEnv();
    delete (env as { FREE_AI_API_KEY?: string }).FREE_AI_API_KEY;
    await expect(freeAiEmbed(env, ['a'], {})).rejects.toThrow(/FREE_AI_API_KEY/);
  });

  it('surfaces provider HTTP errors', async () => {
    captureFetch(() => new Response('boom', { status: 502 }));
    await expect(freeAiEmbed(makeEnv(), ['a'], {})).rejects.toThrow(/free-ai embeddings failed 502/);
  });

  it('retries on a 429 and then succeeds', async () => {
    let attempts = 0;
    captureFetch((req) => {
      attempts += 1;
      if (attempts === 1) return jsonResponse({ error: { message: 'rate' } }, 429);
      return jsonResponse({ data: (req.body.input as string[]).map((_, i) => ({ index: i, embedding: vec(1536) })) });
    });
    const out = await freeAiEmbed(makeEnv(), ['a'], {});
    expect(attempts).toBe(2);
    expect(out[0]).toHaveLength(1536);
  });

  it('uses the injected HTTP transport when present instead of global fetch', async () => {
    const globalCalls = captureFetch(() => jsonResponse({ data: [] }));
    let bindingUsed = false;
    const env = makeEnv({
      AI_HTTP: {
        fetch: async (_url: unknown, init: { body?: string } = {}) => {
          bindingUsed = true;
          const body = JSON.parse(init.body ?? '{}') as { input: string[] };
          return jsonResponse({ data: body.input.map((_, i) => ({ index: i, embedding: vec(1536) })) });
        },
      } as unknown as Fetcher,
    });
    const out = await freeAiEmbed(env, ['x'], {});
    expect(bindingUsed).toBe(true);
    expect(globalCalls).toHaveLength(0);
    expect(out[0]).toHaveLength(1536);
  });

  it('returns empty for empty input without calling the provider', async () => {
    const calls = captureFetch(() => jsonResponse({ data: [] }));
    expect(await freeAiEmbed(makeEnv(), [], {})).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('freeAiChatRaw', () => {
  it('uses the configured direct synthesis model', async () => {
    const calls = captureFetch(() =>
      jsonResponse({ choices: [{ message: { content: 'answer' } }] }),
    );
    const out = await freeAiChatRaw(
      makeEnv({
        FREE_AI_SYNTH_MODEL: 'command-code-mimo-v2-5',
        FREE_AI_SYNTH_PROVIDER: 'command_code',
      }),
      'command-code-mimo-v2-5',
      { messages: [{ role: 'user', content: 'question' }], max_tokens: 64 },
    );

    expect(out.response).toBe('answer');
    expect(first(calls)).toMatchObject({
      url: 'https://provider.example/v1/chat/completions',
      headers: {
        authorization: 'Bearer test-key',
      },
      body: {
        model: 'command-code-mimo-v2-5',
        max_tokens: 64,
      },
    });
  });
});

describe('fetchFreeAiEmbeddingCatalog', () => {
  it('requires live free-ai model rows to include embedding entries', async () => {
    captureFetch(() => jsonResponse({ data: [{ id: 'gemini-2.5-flash', type: 'chat', provider: 'gemini' }] }));

    await expect(fetchFreeAiEmbeddingCatalog(makeEnv())).rejects.toThrow(/no embedding models/);
  });

  it('returns embedding rows with dimensions and availability', async () => {
    captureFetch(() =>
      jsonResponse({
        data: [{
          id: 'gemini-embedding-001',
          type: 'embedding',
          provider: 'gemini',
          dimensions: 1536,
          enabled: true,
          aliases: ['text-embedding-3-small'],
        }],
      }),
    );

    await expect(fetchFreeAiEmbeddingCatalog(makeEnv())).resolves.toEqual([
      expect.objectContaining({
        id: 'gemini-embedding-001',
        provider: 'gemini',
        dimensions: 1536,
        enabled: true,
        aliases: ['text-embedding-3-small'],
      }),
    ]);
  });
});

describe('freeAiChatRaw', () => {
  it('extracts direct provider message content', async () => {
    const calls = captureFetch(() =>
      jsonResponse({ choices: [{ message: { content: '{"status":"supported"}' } }] }),
    );
    const out = await freeAiChatRaw(makeEnv(), 'gemini-2.5-flash', {
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 64,
      response_format: { type: 'json_schema', json_schema: { type: 'object' } },
    });

    expect(out.response).toBe('{"status":"supported"}');
    const req = first(calls);
    expect(req.url).toBe('https://provider.example/v1/chat/completions');
    expect(req.body).not.toHaveProperty('response_format');
    expect(req.body.model).toBe('gemini-2.5-flash');
    expect(req.body).not.toHaveProperty('project_id');
  });

  it('surfaces chat HTTP errors', async () => {
    captureFetch(() => new Response('nope', { status: 500 }));
    await expect(freeAiChatRaw(makeEnv(), 'm', { messages: [{ role: 'user', content: 'x' }] })).rejects.toBeDefined();
  });
});
