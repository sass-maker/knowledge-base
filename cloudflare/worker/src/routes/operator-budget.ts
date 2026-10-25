import type { Hono } from 'hono';
import type { Variables } from '../auth';
import type { Env } from '../types';

type App = Hono<{ Bindings: Env; Variables: Variables }>;

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
      if (!namespace) throw new Error('Shared budget binding unavailable');
      const response = await namespace.get(namespace.idFromName('global-budget')).fetch('https://internal.local/vectorize-usage', {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error('Shared budget read failed');
      const body = (await response.json()) as Record<string, unknown>;
      if (body.monthKey !== new Date().toISOString().slice(0, 7)) throw new Error('Stale budget status');
      return c.json({
        monthKey: body.monthKey,
        query: ledgerStatus(body.query, 45_000_000),
        storage: ledgerStatus(body.storage, 200_000_000),
      });
    } catch {
      return c.json({ error: 'Shared Vectorize budget status is unavailable' }, 503);
    }
  });
}

function ledgerStatus(value: unknown, cap: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ledger');
  const row = value as Record<string, unknown>;
  const states = ['available', 'uninitialized', 'stale', 'invalid', 'baseline_unavailable'];
  const sources = ['ledger', 'verified_monthly_baseline', null];
  if (!states.includes(String(row.state)) || !sources.includes(row.source as string | null) || row.cap !== cap) throw new Error('Invalid ledger');
  if (typeof row.initialized !== 'boolean' || typeof row.baselineVerified !== 'boolean') throw new Error('Invalid ledger');
  if (row.state === 'available') {
    if (
      !Number.isSafeInteger(row.used) ||
      !Number.isSafeInteger(row.remaining) ||
      (row.used as number) < 0 ||
      (row.remaining as number) < 0 ||
      (row.used as number) + (row.remaining as number) !== cap ||
      row.source === null ||
      row.baselineVerified !== true
    )
      throw new Error('Invalid ledger');
  } else if (row.used !== null || row.remaining !== null || row.source !== null || row.baselineVerified !== false) {
    throw new Error('Invalid unavailable ledger');
  }
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
