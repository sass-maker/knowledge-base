import { HTTPException } from 'hono/http-exception';

import type { Env } from './types';

const NEURON_CAP = 9_500;
const VECTORIZE_CAP = 45_000_000;

function deny(): never {
  throw new HTTPException(503, { message: 'Shared AI budget is unavailable or exhausted.' });
}

function sharedBudgetStub(env: Env) {
  const namespace = env.NEURON_BUDGET;
  if (!namespace) return deny();
  return namespace.get(namespace.idFromName('global-budget'));
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function utcMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

async function postReservation(env: Env, path: string, body: Record<string, number>): Promise<unknown> {
  let response: Response;
  try {
    response = await sharedBudgetStub(env).fetch(`https://internal.local/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return deny();
  }
  if (response.status !== 200) return deny();
  try {
    return await response.json();
  } catch {
    return deny();
  }
}

export async function reserveWorkersAiNeurons(env: Env, neurons: number): Promise<void> {
  if (!Number.isSafeInteger(neurons) || neurons <= 0 || neurons > NEURON_CAP) return deny();
  const payload = await postReservation(env, 'try-debit', { neurons });
  if (!payload || typeof payload !== 'object') return deny();
  const result = payload as Record<string, unknown>;
  if (
    result.allowed !== true ||
    result.dayKey !== utcDay() ||
    result.retryAfter !== 0 ||
    !isSafeInteger(result.used) ||
    result.used < neurons ||
    !isSafeInteger(result.remaining) ||
    result.used + result.remaining !== NEURON_CAP
  ) return deny();
}

export async function reserveVectorizeDimensions(env: Env, dimensions: number): Promise<void> {
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0 || dimensions > VECTORIZE_CAP) return deny();
  const payload = await postReservation(env, 'try-debit-vectorize', { dimensions });
  if (!payload || typeof payload !== 'object') return deny();
  const result = payload as Record<string, unknown>;
  if (
    result.allowed !== true ||
    result.monthKey !== utcMonth() ||
    result.baselineVerified !== true ||
    result.retryAfter !== 0 ||
    !isSafeInteger(result.used) ||
    result.used < dimensions ||
    !isSafeInteger(result.remaining) ||
    result.used + result.remaining !== VECTORIZE_CAP
  ) return deny();
}

const INPUT_NEURONS_PER_MILLION: Record<string, number> = {
  '@cf/baai/bge-base-en-v1.5': 6_058,
  '@cf/baai/bge-small-en-v1.5': 1_841,
  '@cf/baai/bge-large-en-v1.5': 18_582,
  '@cf/baai/bge-reranker-base': 283,
  '@cf/meta/llama-3.1-8b-instruct': 25_608,
};
const OUTPUT_NEURONS_PER_MILLION: Record<string, number> = {
  '@cf/meta/llama-3.1-8b-instruct': 75_147,
};

function estimateModelNeurons(model: string, input: unknown, outputTokens = 0): number {
  const inputRate = INPUT_NEURONS_PER_MILLION[model];
  if (!inputRate) return 0;
  const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  const inputTokensWithHeadroom = Math.ceil(bytes * 1.2);
  const outputRate = OUTPUT_NEURONS_PER_MILLION[model];
  if (outputTokens > 0 && !outputRate) return 0;
  const total = Math.ceil((inputTokensWithHeadroom * inputRate + outputTokens * (outputRate ?? 0)) / 1_000_000);
  return Math.max(total, 1);
}

export async function reserveModelCall(env: Env, model: string, input: unknown, outputTokens = 0): Promise<void> {
  const maximumOutputTokens = 8_192;
  if (!Number.isSafeInteger(outputTokens) || outputTokens < 0 || outputTokens > maximumOutputTokens) return deny();
  if (OUTPUT_NEURONS_PER_MILLION[model] && outputTokens === 0) return deny();
  const neurons = estimateModelNeurons(model, input, outputTokens);
  if (neurons <= 0) return deny();
  await reserveWorkersAiNeurons(env, neurons);
}

export function denyVectorizeStorageGrowth(): void {
  throw new HTTPException(503, { message: 'Vectorize storage growth is disabled until verified storage headroom is available.' });
}
