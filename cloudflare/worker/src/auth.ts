import type { Context, Next } from 'hono';
import type { Env } from './types';

export interface Variables {
  tenant: string;
  credentialKind: CredentialKind;
}

type CredentialKind = 'service' | 'append' | 'dashboard' | 'proof';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  const len = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function readPresentedKey(c: AppContext): string {
  const xKey = c.req.header('X-RAG-Key');
  if (xKey) return xKey.trim();
  const auth = c.req.header('Authorization') ?? '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function parseKeyMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, tenant] of Object.entries(parsed)) {
      if (typeof key === 'string' && typeof tenant === 'string' && key && tenant) {
        out[key] = tenant;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function requireServiceKey(c: AppContext, next: Next): Promise<Response | void> {
  const presented = readPresentedKey(c);
  const sources: Array<{ kind: CredentialKind; keys: Record<string, string> }> = [
    { kind: 'proof', keys: parseKeyMap(c.env.RAG_SERVICE_PROOF_KEYS) },
    { kind: 'dashboard', keys: parseKeyMap(c.env.RAG_SERVICE_DASHBOARD_KEYS) },
    { kind: 'append', keys: parseKeyMap(c.env.RAG_SERVICE_KEYS_APPEND) },
    { kind: 'service', keys: parseKeyMap(c.env.RAG_SERVICE_KEYS) },
  ];
  for (const source of sources) {
    for (const [candidate, configuredTenant] of Object.entries(source.keys)) {
      if (!presented || !constantTimeEqual(presented, candidate)) continue;
      const requestedProject = c.req.header('X-KB-Project')?.trim() ?? '';
      if (requestedProject && source.kind !== 'dashboard') {
        return c.json({ error: 'Project override requires a dashboard credential' }, 403);
      }
      if (requestedProject && !PROJECT_ID_PATTERN.test(requestedProject)) {
        return c.json({ error: 'Invalid project identifier' }, 400);
      }
      c.set('tenant', requestedProject || configuredTenant);
      c.set('credentialKind', source.kind);
      await next();
      return undefined;
    }
  }
  return c.json({ error: 'Unauthorized' }, 401);
}
