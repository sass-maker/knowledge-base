// Regression: Pages middleware must let /api/v1* fall through to the
// Access-verified Worker proxy in functions/api/[[path]].ts. Previously the
// middleware returned a JSON 404 for every GET/HEAD /api/* except /api/ai and
// /api/session, which broke the signed-in project inventory
// (GET /api/v1/kb/operator/projects).

import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest as middleware } from '../../functions/_middleware';
import { onRequest as proxy } from '../../functions/api/[[path]]';

const ACCESS_ENV = {
  CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  CF_ACCESS_AUD: 'test-audience',
};

function viaProxy(request: Request, env: Parameters<typeof proxy>[0]['env'] = ACCESS_ENV): { next: () => Promise<Response>; reached: () => boolean } {
  let called = false;
  return {
    reached: () => called,
    next: () => {
      called = true;
      const segments = new URL(request.url).pathname
        .replace(/^\/api\/?/, '')
        .split('/')
        .filter(Boolean);
      return proxy({ request, env, params: { path: segments } });
    },
  };
}

async function run(request: Request, env: Parameters<typeof proxy>[0]['env'] = ACCESS_ENV): Promise<{ res: Response; reachedProxy: boolean }> {
  const { next, reached } = viaProxy(request, env);
  const res = await middleware({ request, next });
  return { res, reachedProxy: reached() };
}

afterEach(() => vi.unstubAllGlobals());

describe('Pages /api routing', () => {
  it('forwards an Access-verified inventory GET to the configured Worker', async () => {
    const team = 'https://routing-test.cloudflareaccess.com';
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'routing-test', alg: 'RS256' };
    const token = await new SignJWT({ email: 'operator@example.test' })
      .setProtectedHeader({ alg: 'RS256', kid: 'routing-test' })
      .setIssuer(team)
      .setAudience('test-audience')
      .setSubject('test-operator')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    const inventory = { projects: [{ id: 'test-project' }] };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `${team}/cdn-cgi/access/certs`) {
        return Response.json({ keys: [jwk] });
      }
      expect(url).toBe('https://worker.example.test/v1/kb/operator/projects?limit=1');
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer test-service-key');
      expect(headers.has('Cf-Access-Jwt-Assertion')).toBe(false);
      return Response.json(inventory, { headers: { 'cache-control': 'no-store' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { res, reachedProxy } = await run(
      new Request('https://search.sassmaker.com/api/v1/kb/operator/projects?limit=1', { headers: { 'Cf-Access-Jwt-Assertion': token } }),
      {
        CF_ACCESS_TEAM_DOMAIN: team,
        CF_ACCESS_AUD: 'test-audience',
        RAG_SERVICE_URL: 'https://worker.example.test',
        RAG_SERVICE_KEY: 'test-service-key',
      },
    );
    expect(reachedProxy).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(inventory);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid Access assertion before any upstream request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { res, reachedProxy } = await run(
      new Request('https://search.sassmaker.com/api/v1/kb/operator/projects', { headers: { 'Cf-Access-Jwt-Assertion': 'invalid-test-assertion' } }),
    );
    expect(reachedProxy).toBe(true);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('GET /api/v1/kb/operator/projects reaches the proxy and rejects anonymous with 401, not 404', async () => {
    const { res, reachedProxy } = await run(new Request('https://search.sassmaker.com/api/v1/kb/operator/projects'));
    expect(reachedProxy).toBe(true);
    expect(res.status).toBe(401);
  });

  it('HEAD /api/v1/kb/operator/projects reaches the proxy', async () => {
    const { res, reachedProxy } = await run(new Request('https://search.sassmaker.com/api/v1/kb/operator/projects', { method: 'HEAD' }));
    expect(reachedProxy).toBe(true);
    expect(res.status).toBe(401);
  });

  it('POST /api/v1/kb/query still reaches the proxy', async () => {
    const { res, reachedProxy } = await run(new Request('https://search.sassmaker.com/api/v1/kb/query', { method: 'POST', body: '{}' }));
    expect(reachedProxy).toBe(true);
    expect(res.status).toBe(401);
  });

  it('bare /api/v1 reaches the proxy', async () => {
    const { res, reachedProxy } = await run(new Request('https://search.sassmaker.com/api/v1'));
    expect(reachedProxy).toBe(true);
    expect(res.status).toBe(401);
  });

  it('unknown non-v1 /api path still gets the middleware JSON 404', async () => {
    const { res, reachedProxy } = await run(new Request('https://search.sassmaker.com/api/nope'));
    expect(reachedProxy).toBe(false);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('/api/session and /api/ai still pass through unchanged', async () => {
    for (const path of ['/api/session', '/api/ai']) {
      let called = false;
      await middleware({
        request: new Request(`https://search.sassmaker.com${path}`),
        next: () => {
          called = true;
          return Promise.resolve(new Response(null, { status: 200 }));
        },
      });
      expect(called).toBe(true);
    }
  });
});
