import type { Hono } from 'hono';
import type { Variables } from '../auth';
import type { Env } from '../types';

type App = Hono<{ Bindings: Env; Variables: Variables }>;
class BudgetStatusError extends Error {}

// This uses the same private binding as reservations, but only reads its ledger.
// Keep fleet-wide counters restricted to the existing operator credential.
export function registerOperatorBudgetRoutes(app: App): void {
  app.get('/v1/kb/operator/budget/vectorize', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (c.get('credentialKind') !== 'dashboard') {
      return c.json({ error: 'Dashboard credential required' }, 403);
    }
    try {
      const namespace = c.env.NEURON_BUDGET;
      if (!namespace) throw new BudgetStatusError('missing_binding');
      const response = await namespace.get(namespace.idFromName('global-budget')).fetch('https://internal.local/vectorize-usage', {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new BudgetStatusError('upstream_status');
      const payload: unknown = await response.json().catch(() => {
        throw new BudgetStatusError('invalid_payload');
      });
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BudgetStatusError('invalid_payload');
      const body = payload as Record<string, unknown>;
      if (body.monthKey !== new Date().toISOString().slice(0, 7)) throw new BudgetStatusError('stale_period');
      return c.json({
        monthKey: body.monthKey,
        query: ledgerStatus(body.query, 45_000_000),
        storage: ledgerStatus(body.storage, 200_000_000),
      });
    } catch (error) {
      console.error('knowledgebase shared Vectorize status unavailable', {
        reason: error instanceof BudgetStatusError ? error.message : 'upstream_unavailable',
      });
      return c.json({ error: 'Shared Vectorize budget status is unavailable' }, 503);
    }
  });
}

function ledgerStatus(value: unknown, cap: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BudgetStatusError('invalid_ledger');
  const row = value as Record<string, unknown>;
  const states = ['available', 'uninitialized', 'stale', 'invalid', 'baseline_unavailable'];
  const sources = ['ledger', 'verified_monthly_baseline', null];
  if (!states.includes(String(row.state)) || !sources.includes(row.source as string | null) || row.cap !== cap) throw new BudgetStatusError('invalid_ledger');
  if (typeof row.initialized !== 'boolean' || typeof row.baselineVerified !== 'boolean') throw new BudgetStatusError('invalid_ledger');
  validateAmounts(row, cap);
  return {
    state: row.state,
    initialized: row.initialized,
    source: row.source,
    used: row.used,
    cap,
    remaining: row.remaining,
    baselineVerified: row.baselineVerified,
  };
}

function validateAmounts(row: Record<string, unknown>, cap: number): void {
  if (row.state !== 'available') {
    if (row.used !== null || row.remaining !== null || row.source !== null || row.baselineVerified !== false) throw new BudgetStatusError('invalid_ledger');
    return;
  }
  if (
    !isBudgetAmount(row.used, cap) ||
    !isBudgetAmount(row.remaining, cap) ||
    row.used + row.remaining !== cap ||
    row.source === null ||
    row.baselineVerified !== true
  )
    throw new BudgetStatusError('invalid_ledger');
}

function isBudgetAmount(value: unknown, cap: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= cap;
}
