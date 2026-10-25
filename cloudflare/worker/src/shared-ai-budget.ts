import { HTTPException } from 'hono/http-exception';

import type { Env } from './types';

const NEURON_CAP = 9_500;
const VECTORIZE_CAP = 45_000_000;
const VECTORIZE_STORED_CAP = 200_000_000;
interface StorageReceipt extends Record<string, unknown> {
  storedCap: number;
  storedUsed: number;
  storedRemaining: number;
}

type AdmissionKind = 'neurons' | 'vectorize_dimensions' | 'vectorize_storage';
type AdmissionReason =
  | 'invalid_request'
  | 'missing_binding'
  | 'transport_error'
  | `http_status_${number}`
  | 'monthly_baseline_unavailable'
  | 'storage_baseline_unavailable'
  | 'malformed_json'
  | 'malformed_receipt'
  | 'denied_receipt'
  | 'stale_period'
  | 'unverified_baseline'
  | 'invalid_arithmetic'
  | 'storage_cap';

function deny(kind: AdmissionKind, reason: AdmissionReason): never {
  throw new HTTPException(503, {
    message: `Shared AI budget is unavailable or exhausted. [budget_admission kind=${kind} reason=${reason}]`,
  });
}

function sharedBudgetStub(env: Env, kind: AdmissionKind) {
  const namespace = env.NEURON_BUDGET;
  if (!namespace) return deny(kind, 'missing_binding');
  try {
    return namespace.get(namespace.idFromName('global-budget'));
  } catch {
    return deny(kind, 'transport_error');
  }
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isUtcDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isSafeInteger(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function isUtcMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function utcMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

async function knownBudgetFailure(response: Response, kind: AdmissionKind): Promise<AdmissionReason | undefined> {
  if (kind === 'neurons') return undefined;
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 512) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
    const error = (payload as Record<string, unknown>).error;
    if (error === 'Verified monthly Vectorize baseline unavailable') return 'monthly_baseline_unavailable';
    if (kind === 'vectorize_storage' && error === 'Verified storage baseline unavailable') return 'storage_baseline_unavailable';
    return undefined;
  } catch {
    return undefined;
  }
}

async function postReservation(env: Env, kind: AdmissionKind, path: string, body: Record<string, number>): Promise<unknown> {
  const stub = sharedBudgetStub(env, kind);
  let response: Response;
  try {
    response = await stub.fetch(`https://internal.local/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return deny(kind, 'transport_error');
  }
  if (response.status !== 200) {
    if (response.status === 503) {
      const failure = await knownBudgetFailure(response, kind);
      if (failure) return deny(kind, failure);
    }
    return deny(kind, `http_status_${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    return deny(kind, 'malformed_json');
  }
}

export async function reserveWorkersAiNeurons(env: Env, neurons: number): Promise<void> {
  const kind = 'neurons';
  if (!Number.isSafeInteger(neurons) || neurons <= 0 || neurons > NEURON_CAP) return deny(kind, 'invalid_request');
  const payload = await postReservation(env, kind, 'try-debit', { neurons });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return deny(kind, 'malformed_receipt');
  const result = payload as Record<string, unknown>;
  if (result.allowed === false) return deny(kind, 'denied_receipt');
  if (
    typeof result.allowed !== 'boolean' ||
    !isUtcDayKey(result.dayKey) ||
    !isSafeInteger(result.retryAfter) ||
    !isSafeInteger(result.used) ||
    !isSafeInteger(result.remaining)
  )
    return deny(kind, 'malformed_receipt');
  if (result.dayKey !== utcDay()) return deny(kind, 'stale_period');
  if (result.used < neurons || result.used + result.remaining !== NEURON_CAP) return deny(kind, 'invalid_arithmetic');
  if (result.allowed !== true || result.retryAfter !== 0) return deny(kind, 'malformed_receipt');
}

export async function reserveVectorizeDimensions(env: Env, dimensions: number): Promise<void> {
  const kind = 'vectorize_dimensions';
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0 || dimensions > VECTORIZE_CAP) return deny(kind, 'invalid_request');
  const payload = await postReservation(env, kind, 'try-debit-vectorize', { dimensions });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return deny(kind, 'malformed_receipt');
  const result = payload as Record<string, unknown>;
  if (result.allowed === false) return deny(kind, 'denied_receipt');
  if (
    typeof result.allowed !== 'boolean' ||
    !isUtcMonthKey(result.monthKey) ||
    typeof result.baselineVerified !== 'boolean' ||
    !isSafeInteger(result.retryAfter) ||
    !isSafeInteger(result.used) ||
    !isSafeInteger(result.remaining)
  )
    return deny(kind, 'malformed_receipt');
  if (result.monthKey !== utcMonth()) return deny(kind, 'stale_period');
  if (result.baselineVerified !== true) return deny(kind, 'unverified_baseline');
  if (result.used < dimensions || result.used + result.remaining !== VECTORIZE_CAP) return deny(kind, 'invalid_arithmetic');
  if (result.allowed !== true || result.retryAfter !== 0) return deny(kind, 'malformed_receipt');
}

export async function reserveVectorizeStorage(env: Env, dimensions: number): Promise<void> {
  const kind = 'vectorize_storage';
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0 || dimensions > VECTORIZE_CAP) return deny(kind, 'invalid_request');
  const payload = await postReservation(env, kind, 'try-debit-vectorize-storage', { dimensions });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return deny(kind, 'malformed_receipt');
  const result = payload as Record<string, unknown>;
  validateStorageQueryReceipt(result, dimensions, kind);
  if (result.storedCap !== VECTORIZE_STORED_CAP) return deny(kind, 'storage_cap');
  if (result.storedUsed < dimensions || result.storedUsed + result.storedRemaining !== VECTORIZE_STORED_CAP) return deny(kind, 'invalid_arithmetic');
}

function validateStorageQueryReceipt(result: Record<string, unknown>, dimensions: number, kind: AdmissionKind): asserts result is StorageReceipt {
  if (result.allowed === false) deny(kind, 'denied_receipt');
  if (
    typeof result.allowed !== 'boolean' ||
    !isUtcMonthKey(result.monthKey) ||
    typeof result.baselineVerified !== 'boolean' ||
    !isSafeInteger(result.retryAfter) ||
    !isSafeInteger(result.used) ||
    !isSafeInteger(result.remaining) ||
    !isSafeInteger(result.storedCap) ||
    !isSafeInteger(result.storedUsed) ||
    !isSafeInteger(result.storedRemaining)
  )
    deny(kind, 'malformed_receipt');
  if (result.monthKey !== utcMonth()) deny(kind, 'stale_period');
  if (result.baselineVerified !== true) deny(kind, 'unverified_baseline');
  if (result.used < dimensions || result.used + result.remaining !== VECTORIZE_CAP) deny(kind, 'invalid_arithmetic');
  if (result.allowed !== true || result.retryAfter !== 0) deny(kind, 'malformed_receipt');
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
  if (!Number.isSafeInteger(outputTokens) || outputTokens < 0 || outputTokens > maximumOutputTokens) return deny('neurons', 'invalid_request');
  if (OUTPUT_NEURONS_PER_MILLION[model] && outputTokens === 0) return deny('neurons', 'invalid_request');
  const neurons = estimateModelNeurons(model, input, outputTokens);
  if (neurons <= 0) return deny('neurons', 'invalid_request');
  await reserveWorkersAiNeurons(env, neurons);
}

export function denyVectorizeStorageGrowth(): void {
  throw new HTTPException(503, { message: 'Vectorize storage growth is disabled until verified storage headroom is available.' });
}
