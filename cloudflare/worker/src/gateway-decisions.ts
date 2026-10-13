import { jsonRecord } from './app-utils';
import { boundedJsonResponse, runDecisionEngine, validateDecisionAnswers } from './decision-engine';
import type { DecisionEngineResult, FrozenDecision } from './decision-types';
import type { Env, JsonRecord } from './types';

type Engine = 'free_ai' | 'jev';
interface GatewayInput {
  state: JsonRecord;
  questions: Array<{ id: string; type: 'choice'; prompt: string; options: string[] }>;
}

function questionPrompt(question: FrozenDecision['questions'][string]): string {
  const meanings = Object.entries(question.criteria).map(([option, meaning]) => [option, meaning].join(': '));
  return [question.instructions, ...meanings].join('\n');
}

function gatewayInput(frozen: FrozenDecision): GatewayInput {
  return {
    state: frozen.state,
    questions: Object.entries(frozen.questions).map(([id, question]) => ({
      id,
      type: 'choice',
      prompt: questionPrompt(question),
      options: Object.keys(question.criteria),
    })),
  };
}

function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error('Gateway state nesting exceeds limit');
  if (Array.isArray(value)) return ['[', value.map((item) => canonical(item, depth + 1)).join(','), ']'].join('');
  if (value && typeof value === 'object') {
    const row = value as JsonRecord;
    const fields = Object.keys(row)
      .sort()
      .map((key) => [JSON.stringify(key), canonical(row[key], depth + 1)].join(':'));
    return ['{', fields.join(','), '}'].join('');
  }
  const json = JSON.stringify(value);
  if (json === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Gateway state must contain finite JSON values');
  return json;
}

async function inputHash(input: GatewayInput): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(input));
  if (bytes.byteLength > 32768) throw new Error('Mapped decision exceeds gateway input budget');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function emptyResult(engine: Engine): DecisionEngineResult {
  return {
    status: 'error',
    requested_model: engine === 'jev' ? 'typesafe/jev' : 'auto',
    resolved_model: null,
    provider: null,
    latency_ms: 0,
    usage: null,
    raw: null,
    decision_backend: 'free_ai_decisions',
  };
}

async function gatewayRequest(env: Env, path: 'decide' | 'compare', input: GatewayInput, selector: JsonRecord): Promise<JsonRecord> {
  if (!env.FREE_AI) throw new Error('Free AI gateway binding is unavailable');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await env.FREE_AI!.fetch(
          new Request(`https://fleet-gateway.internal/v1/${path}`, {
            method: 'POST',
            signal: AbortSignal.timeout(30000),
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer service-binding', 'x-gateway-project-id': 'knowledge-base' },
            body: JSON.stringify({
              project_id: 'knowledge-base',
              ...input,
              ...selector,
              limits: { deadline_ms: 30000, max_output_tokens: 4096, max_cost_usd: 0 },
            }),
          }),
        );
        if (!response.ok) throw new Error(`Free AI typed decision request failed (${response.status})`);
        return boundedJsonResponse(response, path === 'compare' ? 270336 : 65536);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Free AI typed decision deadline exceeded (30 seconds)')), 30000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function gatewayAnswers(frozen: FrozenDecision, value: unknown): JsonRecord {
  if (!Array.isArray(value) || value.length !== Object.keys(frozen.questions).length)
    throw new Error('Gateway answer coverage does not match frozen questions');
  const answers: JsonRecord = {};
  for (const answer of value) {
    const row = jsonRecord(answer);
    if (typeof row.reason !== 'string' || !row.reason || row.reason.length > 2000) throw new Error('Invalid gateway answer reason');
    if (typeof row.id !== 'string' || !Object.hasOwn(frozen.questions, row.id) || Object.hasOwn(answers, row.id))
      throw new Error('Invalid or duplicate gateway answer id');
    if (row.status === 'abstained' && row.value === null) {
      answers[row.id] = { type: 'choice', choice: row.id.endsWith('_fit') || row.id.endsWith('_utility') ? 'reject' : 'none' };
    } else if (row.status === 'answered' && typeof row.value === 'string') answers[row.id] = { type: 'choice', choice: row.value };
    else throw new Error('Invalid gateway choice answer');
  }
  return answers;
}

function gatewayTelemetry(engine: Engine, hash: string, row: JsonRecord): DecisionEngineResult {
  const result = emptyResult(engine);
  if (row.engine !== engine || row.input_hash !== hash || row.requested_model !== result.requested_model)
    throw new Error('Gateway engine identity or input hash mismatch');
  if (!['ok', 'unavailable', 'error'].includes(String(row.status))) throw new Error('Invalid gateway engine status');
  if (typeof row.latency_ms !== 'number' || !Number.isFinite(row.latency_ms) || row.latency_ms < 0) throw new Error('Invalid gateway latency');
  if (row.usage !== null && (!row.usage || typeof row.usage !== 'object' || Array.isArray(row.usage))) throw new Error('Invalid gateway usage');
  result.raw = row;
  result.gateway_input_hash = hash;
  result.latency_ms = row.latency_ms;
  result.usage = row.usage as JsonRecord | null;
  result.resolved_model = typeof row.model === 'string' ? row.model : null;
  result.provider = typeof row.provider === 'string' ? row.provider : null;
  return result;
}

function scopedRaw(engine: Engine, hash: string, value: unknown): unknown {
  const row = jsonRecord(value);
  return row.engine === engine && row.input_hash === hash && row.requested_model === emptyResult(engine).requested_model ? value : null;
}

function gatewayResult(frozen: FrozenDecision, engine: Engine, hash: string, value: unknown): DecisionEngineResult {
  const row = jsonRecord(value);
  const result = gatewayTelemetry(engine, hash, row);
  if (row.status === 'ok') {
    if (!result.resolved_model || result.resolved_model === 'auto' || !result.provider)
      throw new Error('Gateway result lacks resolved model/provider attribution');
    if (engine === 'jev' && result.resolved_model !== 'typesafe/jev') throw new Error('Gateway Jev result resolved a different model');
    try {
      result.result = validateDecisionAnswers(frozen, gatewayAnswers(frozen, row.answers));
      result.status = 'ok';
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.error_code = 'decision_validation_error';
      console.error('knowledgebase gateway evidence validation failed', { engine, error: result.error });
    }
  } else {
    const error = jsonRecord(row.error);
    if (typeof error.code !== 'string' || typeof error.message !== 'string') throw new Error('Gateway result lacks explicit error');
    if (!Array.isArray(row.answers) || row.answers.length) throw new Error('Unavailable gateway result must not contain answers');
    result.status = row.status === 'unavailable' ? 'disabled' : 'error';
    result.error_code = error.code;
    result.error = error.message;
  }
  return result;
}

function failure(engine: Engine, error: unknown, started: number, raw: unknown = null): DecisionEngineResult {
  const message = error instanceof Error ? error.message : String(error);
  console.error('knowledgebase typed gateway decision failed', { engine, error: message });
  return { ...emptyResult(engine), raw, error: message, error_code: 'gateway_contract_error', latency_ms: Math.round(performance.now() - started) };
}

export async function runKnowledgeDecision(env: Env, frozen: FrozenDecision, engine: Engine): Promise<DecisionEngineResult> {
  if (env.RAG_GATEWAY_DECISIONS_ENABLED !== 'true') return runDecisionEngine(env, frozen, engine);
  const started = performance.now();
  let raw: JsonRecord | null = null;
  try {
    const input = gatewayInput(frozen);
    const hash = await inputHash(input);
    const received = await gatewayRequest(env, 'decide', input, { engine, ...(engine === 'free_ai' ? { model: 'auto' } : {}) });
    if (received.project_id !== 'knowledge-base') throw new Error('Gateway project attribution mismatch');
    raw = scopedRaw(engine, hash, received) as JsonRecord | null;
    return gatewayResult(frozen, engine, hash, received);
  } catch (error) {
    return failure(engine, error, started, raw);
  }
}

export async function compareKnowledgeDecisions(env: Env, frozen: FrozenDecision): Promise<Record<Engine, DecisionEngineResult>> {
  if (env.RAG_GATEWAY_DECISIONS_ENABLED !== 'true') {
    const [free_ai, jev] = await Promise.all([runDecisionEngine(env, frozen, 'free_ai'), runDecisionEngine(env, frozen, 'jev')]);
    return { free_ai, jev };
  }
  const started = performance.now();
  try {
    const input = gatewayInput(frozen);
    const hash = await inputHash(input);
    const raw = await gatewayRequest(env, 'compare', input, { engines: [{ engine: 'free_ai', model: 'auto' }, { engine: 'jev' }] });
    if (raw.project_id !== 'knowledge-base') throw new Error('Gateway project attribution mismatch');
    if (raw.input_hash !== hash || !Array.isArray(raw.results) || raw.results.length !== 2)
      throw new Error('Gateway comparison input hash or engine coverage mismatch');
    const rows = new Map(raw.results.map((value) => [jsonRecord(value).engine, value]));
    if (!rows.has('free_ai') || !rows.has('jev')) throw new Error('Gateway comparison engine identities mismatch');
    const engines = {} as Record<Engine, DecisionEngineResult>;
    for (const engine of ['free_ai', 'jev'] as const) {
      try {
        engines[engine] = gatewayResult(frozen, engine, hash, rows.get(engine));
      } catch (error) {
        engines[engine] = failure(engine, error, started, scopedRaw(engine, hash, rows.get(engine)));
      }
    }
    return engines;
  } catch (error) {
    return { free_ai: failure('free_ai', error, started), jev: failure('jev', error, started) };
  }
}
