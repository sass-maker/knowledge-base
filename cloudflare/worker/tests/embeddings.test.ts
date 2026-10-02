import { describe, expect, it } from 'vitest';
import { embedTexts } from '../src/embeddings';
import type { Env } from '../src/types';

function makeEnv(calls: string[][], models: string[] = [], options: unknown[] = []): Env {
  return {
    EMBEDDING_MODEL: '@cf/baai/bge-base-en-v1.5',
    NEURON_BUDGET: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: async (_url: string, init: RequestInit) => {
        const { neurons } = JSON.parse(String(init.body)) as { neurons: number };
        return Response.json({ allowed: true, used: neurons, remaining: 9_500 - neurons, retryAfter: 0, dayKey: new Date().toISOString().slice(0, 10) });
      } }),
    } as unknown as DurableObjectNamespace,
    AI: {
      run: async (model: string, input: { text: string[] }, opts?: unknown) => {
        models.push(model);
        options.push(opts);
        calls.push(input.text);
        return { data: input.text.map((text) => [text.length]) };
      },
    } as unknown as Ai,
    DB: {} as D1Database,
    VECTORIZE: {} as Env['VECTORIZE'],
  };
}

describe('embedTexts', () => {
  it('returns an empty vector list without calling Workers AI for empty input', async () => {
    const calls: string[][] = [];
    const vectors = await embedTexts(makeEnv(calls), []);

    expect(vectors).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('batches Workers AI embedding calls in groups of 100', async () => {
    const calls: string[][] = [];
    const texts = Array.from({ length: 205 }, (_, i) => `text-${i}`);
    const vectors = await embedTexts(makeEnv(calls), texts);

    expect(calls.map((call) => call.length)).toEqual([100, 100, 5]);
    expect(vectors).toHaveLength(205);
    expect(vectors[0]).toEqual([6]);
    expect(vectors.at(-1)).toEqual([8]);
  });

  it('passes the explicit model directly to Workers AI', async () => {
    const calls: string[][] = [];
    const models: string[] = [];
    const options: unknown[] = [];
    await embedTexts(makeEnv(calls, models, options), ['alpha'], { model: '@cf/baai/bge-small-en-v1.5' });

    expect(models).toEqual(['@cf/baai/bge-small-en-v1.5']);
    expect(options).toEqual([undefined]);
  });

  it('does not invoke Workers AI when the shared neuron budget is absent', async () => {
    const calls: string[][] = [];
    const env = makeEnv(calls);
    delete env.NEURON_BUDGET;
    await expect(embedTexts(env, ['protected input'])).rejects.toMatchObject({ status: 503 });
    expect(calls).toEqual([]);
  });
});
